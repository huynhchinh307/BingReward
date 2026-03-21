import rebrowser, { BrowserContext } from 'patchright'
import { newInjectedContext } from 'fingerprint-injector'
import { BrowserFingerprintWithHeaders, FingerprintGenerator } from 'fingerprint-generator'
import * as fs from 'fs'

import type { MicrosoftRewardsBot } from '../index'
import { loadSessionData, saveFingerprintData } from '../util/Load'
import { UserAgentManager } from './UserAgent'

import type { Account, AccountProxy } from '../interface/Account'

/* Test Stuff
https://abrahamjuliot.github.io/creepjs/
https://botcheck.luminati.io/
https://fv.pro/
https://pixelscan.net/
https://www.browserscan.net/
*/

interface BrowserCreationResult {
    context: BrowserContext
    fingerprint: BrowserFingerprintWithHeaders
}

class Browser {
    private readonly bot: MicrosoftRewardsBot
    private static readonly BROWSER_ARGS = [
        '--no-sandbox',
        '--mute-audio',
        '--disable-setuid-sandbox',
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-spki-list',
        '--ignore-ssl-errors',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-user-media-security=true',
        '--disable-blink-features=Attestation',
        '--disable-features=WebAuthentication,PasswordManagerOnboarding,PasswordManager,EnablePasswordsAccountStorage,Passkeys',
        '--disable-save-password-bubble'
    ] as const

    // Known Edge installation paths by platform
    private static readonly EDGE_PATHS: Partial<Record<NodeJS.Platform, string[]>> = {
        win32: [
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`
        ],
        linux: [
            '/usr/bin/microsoft-edge',
            '/usr/bin/microsoft-edge-stable',
            '/opt/microsoft/msedge/msedge'
        ],
        darwin: [
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
        ]
    }

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    private getEdgeExecutable(): string | undefined {
        const paths = Browser.EDGE_PATHS[process.platform] ?? []
        const found = paths.find(p => {
            try { return fs.existsSync(p) } catch { return false }
        })
        if (!found) {
            this.bot.logger.warn(this.bot.isMobile, 'BROWSER', 'Edge executable not found, falling back to Chromium')
        } else {
            this.bot.logger.info(this.bot.isMobile, 'BROWSER', `Using Edge at: ${found}`)
        }
        return found
    }

    async createBrowser(account: Account): Promise<BrowserCreationResult> {
        let browser: rebrowser.Browser
        const useEdge = (this.bot.config.browserType ?? 'chromium') === 'edge'

        try {
            const proxyConfig = account.proxy.url
                ? {
                      server: this.formatProxyServer(account.proxy),
                      ...(account.proxy.username &&
                          account.proxy.password && {
                              username: account.proxy.username,
                              password: account.proxy.password
                          })
                  }
                : undefined

            const edgePath = useEdge ? this.getEdgeExecutable() : undefined

            browser = await rebrowser.chromium.launch({
                headless: this.bot.config.headless,
                ...(proxyConfig && { proxy: proxyConfig }),
                ...(edgePath && { executablePath: edgePath }),
                args: [...Browser.BROWSER_ARGS]
            })
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            this.bot.logger.error(this.bot.isMobile, 'BROWSER', `Launch failed: ${errorMessage}`)
            throw error
        }

        try {
            const sessionData = await loadSessionData(
                this.bot.config.sessionPath,
                account.email,
                account.saveFingerprint,
                this.bot.isMobile
            )

            const fingerprint = sessionData.fingerprint ?? (await this.generateFingerprint(this.bot.isMobile))

            const context = await newInjectedContext(browser as any, { fingerprint })

            await context.addInitScript(() => {
                Object.defineProperty(navigator, 'credentials', {
                    value: {
                        create: () => Promise.reject(new Error('WebAuthn disabled')),
                        get: () => Promise.reject(new Error('WebAuthn disabled'))
                    }
                })
            })

            context.setDefaultTimeout(this.bot.utils.stringToNumber(this.bot.config?.globalTimeout ?? 30000))

            await context.addCookies(sessionData.cookies)

            if (
                (account.saveFingerprint.mobile && this.bot.isMobile) ||
                (account.saveFingerprint.desktop && !this.bot.isMobile)
            ) {
                await saveFingerprintData(this.bot.config.sessionPath, account.email, this.bot.isMobile, fingerprint)
            }

            this.bot.logger.info(
                this.bot.isMobile,
                'BROWSER',
                `Created browser with User-Agent: "${fingerprint.fingerprint.navigator.userAgent}"`
            )
            this.bot.logger.debug(this.bot.isMobile, 'BROWSER-FINGERPRINT', JSON.stringify(fingerprint))

            return { context: context as unknown as BrowserContext, fingerprint }
        } catch (error) {
            await browser.close().catch(() => {})
            throw error
        }
    }

    private formatProxyServer(proxy: AccountProxy): string {
        try {
            const urlObj = new URL(proxy.url)
            const protocol = urlObj.protocol.replace(':', '')
            return `${protocol}://${urlObj.hostname}:${proxy.port}`
        } catch {
            return `${proxy.url}:${proxy.port}`
        }
    }

    async generateFingerprint(isMobile: boolean) {
        const fingerPrintData = new FingerprintGenerator().getFingerprint({
            devices: isMobile ? ['mobile'] : ['desktop'],
            operatingSystems: isMobile ? ['android', 'ios'] : ['windows', 'linux'],
            browsers: [{ name: 'edge' }]
        })

        const userAgentManager = new UserAgentManager(this.bot)
        const updatedFingerPrintData = await userAgentManager.updateFingerprintUserAgent(fingerPrintData, isMobile)

        return updatedFingerPrintData
    }
}

export default Browser
