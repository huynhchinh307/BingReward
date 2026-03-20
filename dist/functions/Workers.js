"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Workers = void 0;
class Workers {
    constructor(bot) {
        this.bot = bot;
    }
    async doDailySet(data, page) {
        const todayKey = this.bot.utils.getFormattedDate();
        const todayData = data.dailySetPromotions[todayKey];
        const activitiesUncompleted = todayData?.filter(x => !x?.complete && x.pointProgressMax > 0) ?? [];
        if (!activitiesUncompleted.length) {
            this.bot.logger.info(this.bot.isMobile, 'DAILY-SET', 'All "Daily Set" items have already been completed');
            return;
        }
        this.bot.logger.info(this.bot.isMobile, 'DAILY-SET', 'Started solving "Daily Set" items');
        await this.solveActivities(activitiesUncompleted, page);
        this.bot.logger.info(this.bot.isMobile, 'DAILY-SET', 'All "Daily Set" items have been completed');
    }
    async doMorePromotions(data, page) {
        const morePromotions = [
            ...new Map([...(data.morePromotions ?? []), ...(data.morePromotionsWithoutPromotionalItems ?? [])]
                .filter(Boolean)
                .map(p => [p.offerId, p])).values()
        ];
        const activitiesUncompleted = morePromotions?.filter(x => {
            if (x.complete)
                return false;
            if (x.pointProgressMax <= 0)
                return false;
            if (x.exclusiveLockedFeatureStatus === 'locked')
                return false;
            if (!x.promotionType)
                return false;
            return true;
        }) ?? [];
        if (!activitiesUncompleted.length) {
            this.bot.logger.info(this.bot.isMobile, 'MORE-PROMOTIONS', 'All "More Promotion" items have already been completed');
            return;
        }
        this.bot.logger.info(this.bot.isMobile, 'MORE-PROMOTIONS', `Started solving ${activitiesUncompleted.length} "More Promotions" items`);
        await this.solveActivities(activitiesUncompleted, page);
        this.bot.logger.info(this.bot.isMobile, 'MORE-PROMOTIONS', 'All "More Promotion" items have been completed');
    }
    async doAppPromotions(data) {
        const appRewards = data.response.promotions.filter(x => {
            if (x.attributes['complete']?.toLowerCase() !== 'false')
                return false;
            if (!x.attributes['offerid'])
                return false;
            if (!x.attributes['type'])
                return false;
            if (x.attributes['type'] !== 'sapphire')
                return false;
            return true;
        });
        if (!appRewards.length) {
            this.bot.logger.info(this.bot.isMobile, 'APP-PROMOTIONS', 'All "App Promotions" items have already been completed');
            return;
        }
        for (const reward of appRewards) {
            await this.bot.activities.doAppReward(reward);
            // A delay between completing each activity
            await this.bot.utils.wait(this.bot.utils.randomDelay(5000, 15000));
        }
        this.bot.logger.info(this.bot.isMobile, 'APP-PROMOTIONS', 'All "App Promotions" items have been completed');
    }
    async doSpecialPromotions(data) {
        const specialPromotions = [
            ...new Map([...(data.promotionalItems ?? [])]
                .filter(Boolean)
                .map(p => [p.offerId, p])).values()
        ];
        const supportedPromotions = ['ww_banner_optin_2x'];
        const specialPromotionsUncompleted = specialPromotions?.filter(x => {
            if (x.complete)
                return false;
            if (x.exclusiveLockedFeatureStatus === 'locked')
                return false;
            if (!x.promotionType)
                return false;
            const offerId = (x.offerId ?? '').toLowerCase();
            return supportedPromotions.some(s => offerId.includes(s));
        }) ?? [];
        for (const activity of specialPromotionsUncompleted) {
            try {
                const type = activity.promotionType?.toLowerCase() ?? '';
                const name = activity.name?.toLowerCase() ?? '';
                const offerId = activity.offerId;
                this.bot.logger.debug(this.bot.isMobile, 'SPECIAL-ACTIVITY', `Processing activity | title="${activity.title}" | offerId=${offerId} | type=${type}"`);
                switch (type) {
                    // UrlReward
                    case 'urlreward': {
                        // Special "Double Search Points" activation
                        if (name.includes('ww_banner_optin_2x')) {
                            this.bot.logger.info(this.bot.isMobile, 'ACTIVITY', `Found activity type "Double Search Points" | title="${activity.title}" | offerId=${offerId}`);
                            await this.bot.activities.doDoubleSearchPoints(activity);
                        }
                        break;
                    }
                    // Unsupported types
                    default: {
                        this.bot.logger.warn(this.bot.isMobile, 'SPECIAL-ACTIVITY', `Skipped activity "${activity.title}" | offerId=${offerId} | Reason: Unsupported type "${activity.promotionType}"`);
                        break;
                    }
                }
            }
            catch (error) {
                this.bot.logger.error(this.bot.isMobile, 'SPECIAL-ACTIVITY', `Error while solving activity "${activity.title}" | message=${error instanceof Error ? error.message : String(error)}`);
            }
        }
        this.bot.logger.info(this.bot.isMobile, 'SPECIAL-ACTIVITY', 'All "Special Activites" items have been completed');
    }
    async solveActivities(activities, page, punchCard) {
        for (const activity of activities) {
            try {
                const type = activity.promotionType?.toLowerCase() ?? '';
                const name = activity.name?.toLowerCase() ?? '';
                const offerId = activity.offerId;
                const destinationUrl = activity.destinationUrl?.toLowerCase() ?? '';
                this.bot.logger.debug(this.bot.isMobile, 'ACTIVITY', `Processing activity | title="${activity.title}" | offerId=${offerId} | type=${type} | punchCard="${punchCard?.parentPromotion?.title ?? 'none'}"`);
                switch (type) {
                    // Quiz-like activities (Poll / regular quiz variants)
                    case 'quiz': {
                        const basePromotion = activity;
                        // Poll (usually 10 points, pollscenarioid in URL)
                        if (activity.pointProgressMax === 10 && destinationUrl.includes('pollscenarioid')) {
                            this.bot.logger.info(this.bot.isMobile, 'ACTIVITY', `Found activity type "Poll" | title="${activity.title}" | offerId=${offerId}`);
                            //await this.bot.activities.doPoll(basePromotion)
                            break;
                        }
                        // All other quizzes handled via Quiz API
                        this.bot.logger.info(this.bot.isMobile, 'ACTIVITY', `Found activity type "Quiz" | title="${activity.title}" | offerId=${offerId}`);
                        await this.bot.activities.doQuiz(basePromotion);
                        break;
                    }
                    // UrlReward
                    case 'urlreward': {
                        const basePromotion = activity;
                        // Search on Bing are subtypes of "urlreward"
                        if (name.includes('exploreonbing')) {
                            this.bot.logger.info(this.bot.isMobile, 'ACTIVITY', `Found activity type "SearchOnBing" | title="${activity.title}" | offerId=${offerId}`);
                            await this.bot.activities.doSearchOnBing(basePromotion, page);
                        }
                        else {
                            this.bot.logger.info(this.bot.isMobile, 'ACTIVITY', `Found activity type "UrlReward" | title="${activity.title}" | offerId=${offerId}`);
                            await this.bot.activities.doUrlReward(basePromotion);
                        }
                        break;
                    }
                    // Find Clippy specific promotion type
                    case 'findclippy': {
                        const clippyPromotion = activity;
                        this.bot.logger.info(this.bot.isMobile, 'ACTIVITY', `Found activity type "FindClippy" | title="${activity.title}" | offerId=${offerId}`);
                        await this.bot.activities.doFindClippy(clippyPromotion);
                        break;
                    }
                    // Unsupported types
                    default: {
                        this.bot.logger.warn(this.bot.isMobile, 'ACTIVITY', `Skipped activity "${activity.title}" | offerId=${offerId} | Reason: Unsupported type "${activity.promotionType}"`);
                        break;
                    }
                }
                // Cooldown
                await this.bot.utils.wait(this.bot.utils.randomDelay(5000, 15000));
            }
            catch (error) {
                this.bot.logger.error(this.bot.isMobile, 'ACTIVITY', `Error while solving activity "${activity.title}" | message=${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
}
exports.Workers = Workers;
//# sourceMappingURL=Workers.js.map