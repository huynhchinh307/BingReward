"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const patchright_1 = __importDefault(require("patchright"));
const fingerprint_injector_1 = require("fingerprint-injector");
const fingerprint_generator_1 = require("fingerprint-generator");
const fs = __importStar(require("fs"));
const Load_1 = require("../util/Load");
const UserAgent_1 = require("./UserAgent");
class Browser {
    constructor(bot) {
        this.bot = bot;
    }
    getEdgeExecutable() {
        const paths = Browser.EDGE_PATHS[process.platform] ?? [];
        const found = paths.find(p => {
            try {
                return fs.existsSync(p);
            }
            catch {
                return false;
            }
        });
        if (!found) {
            this.bot.logger.warn(this.bot.isMobile, 'BROWSER', 'Edge executable not found, falling back to Chromium');
        }
        else {
            this.bot.logger.info(this.bot.isMobile, 'BROWSER', `Using Edge at: ${found}`);
        }
        return found;
    }
    async createBrowser(account) {
        let browser;
        const useEdge = (this.bot.config.browserType ?? 'chromium') === 'edge';
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
                : undefined;
            const edgePath = useEdge ? this.getEdgeExecutable() : undefined;
            browser = await patchright_1.default.chromium.launch({
                headless: this.bot.config.headless,
                ...(proxyConfig && { proxy: proxyConfig }),
                ...(edgePath && { executablePath: edgePath }),
                args: [...Browser.BROWSER_ARGS]
            });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.logger.error(this.bot.isMobile, 'BROWSER', `Launch failed: ${errorMessage}`);
            throw error;
        }
        try {
            const sessionData = await (0, Load_1.loadSessionData)(this.bot.config.sessionPath, account.email, account.saveFingerprint, this.bot.isMobile);
            const fingerprint = sessionData.fingerprint ?? (await this.generateFingerprint(this.bot.isMobile));
            const context = await (0, fingerprint_injector_1.newInjectedContext)(browser, { fingerprint });
            await context.addInitScript(() => {
                Object.defineProperty(navigator, 'credentials', {
                    value: {
                        create: () => Promise.reject(new Error('WebAuthn disabled')),
                        get: () => Promise.reject(new Error('WebAuthn disabled'))
                    }
                });
            });
            context.setDefaultTimeout(this.bot.utils.stringToNumber(this.bot.config?.globalTimeout ?? 30000));
            await context.addCookies(sessionData.cookies);
            if ((account.saveFingerprint.mobile && this.bot.isMobile) ||
                (account.saveFingerprint.desktop && !this.bot.isMobile)) {
                await (0, Load_1.saveFingerprintData)(this.bot.config.sessionPath, account.email, this.bot.isMobile, fingerprint);
            }
            this.bot.logger.info(this.bot.isMobile, 'BROWSER', `Created browser with User-Agent: "${fingerprint.fingerprint.navigator.userAgent}"`);
            this.bot.logger.debug(this.bot.isMobile, 'BROWSER-FINGERPRINT', JSON.stringify(fingerprint));
            return { context: context, fingerprint };
        }
        catch (error) {
            await browser.close().catch(() => { });
            throw error;
        }
    }
    formatProxyServer(proxy) {
        try {
            const urlObj = new URL(proxy.url);
            const protocol = urlObj.protocol.replace(':', '');
            return `${protocol}://${urlObj.hostname}:${proxy.port}`;
        }
        catch {
            return `${proxy.url}:${proxy.port}`;
        }
    }
    async generateFingerprint(isMobile) {
        const fingerPrintData = new fingerprint_generator_1.FingerprintGenerator().getFingerprint({
            devices: isMobile ? ['mobile'] : ['desktop'],
            operatingSystems: isMobile ? ['android', 'ios'] : ['windows', 'linux'],
            browsers: [{ name: 'edge' }]
        });
        const userAgentManager = new UserAgent_1.UserAgentManager(this.bot);
        const updatedFingerPrintData = await userAgentManager.updateFingerprintUserAgent(fingerPrintData, isMobile);
        return updatedFingerPrintData;
    }
}
Browser.BROWSER_ARGS = [
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
];
// Known Edge installation paths by platform
Browser.EDGE_PATHS = {
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
};
exports.default = Browser;
//# sourceMappingURL=Browser.js.map