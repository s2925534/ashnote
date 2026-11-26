// Every web address Ashnote opens, in one place (VLABS-446). They are fixed: no query string and nothing
// about the phone, the person or an account is ever added. tests/privacy.test.ts checks this, and that no
// other file opens a web address of its own.
export { INVITE_LINK_BASE } from "./invite";
/** "Get the latest version": the Ashnote page in the VelosoLabs app store. */
export const LATEST_VERSION_URL = "https://apps.velosolabs.com/ashnote";
/**
 * "Leave a tip": only in the APK we publish ourselves. App stores don't allow links to outside payments, so in
 * the store build this is null and the address is left out of the app entirely (the release workflow checks).
 */
export const TIP_URL: string | null = process.env.EXPO_PUBLIC_DIST === "apk" ? "https://velosolabs.com/ashnote/support" : null;
