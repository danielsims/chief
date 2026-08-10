const GOOGLE_CONSOLE_HOST = "console.cloud.google.com";
const GOOGLE_ACCOUNTS_HOST = "accounts.google.com";

function parsedUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

/** The browser-local Google identity index chosen by the human. */
export function googleAuthUserFromUrl(rawUrl: string): string | null {
  const url = parsedUrl(rawUrl);
  if (!url) return null;
  const authuser = url.searchParams.get("authuser")?.trim();
  return authuser && /^[0-9]{1,3}$/.test(authuser) ? authuser : null;
}

export function isGoogleAccountChooserUrl(rawUrl: string): boolean {
  const url = parsedUrl(rawUrl);
  return Boolean(
    url?.hostname === GOOGLE_ACCOUNTS_HOST &&
    url.pathname.toLowerCase().includes("accountchooser"),
  );
}

/**
 * Pins Google Cloud and Google OAuth navigations to the identity the human
 * selected. Other providers and Google's explicit account chooser are left
 * untouched.
 */
export function withGoogleAuthUser(rawUrl: string, authuser: string): string {
  if (!/^[0-9]{1,3}$/.test(authuser)) {
    throw new Error("Google authuser is invalid.");
  }
  const url = parsedUrl(rawUrl);
  if (!url || isGoogleAccountChooserUrl(rawUrl)) return rawUrl;
  const isCloudConsole = url.hostname === GOOGLE_CONSOLE_HOST;
  const isGoogleOAuth = url.hostname === GOOGLE_ACCOUNTS_HOST;
  if (!isCloudConsole && !isGoogleOAuth) return rawUrl;
  url.searchParams.set("authuser", authuser);
  return url.toString();
}
