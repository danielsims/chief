/** HTTPS page that hands the authorization code back to the desktop app. */
export const DESKTOP_AUTH_CALLBACK_PATH = "/auth/desktop";

export function desktopAuthorizationRedirectUri(authUiUrl: string) {
  return new URL(DESKTOP_AUTH_CALLBACK_PATH, authUiUrl).toString();
}
