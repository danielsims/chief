/** Packaged apps use the web handoff; unbundled dev apps use their own listener. */
export const DESKTOP_AUTH_CALLBACK_PATH = "/auth/desktop";

export function desktopAuthorizationRedirectUri(
  authUiUrl: string,
  loopbackUri?: string,
) {
  if (loopbackUri) {
    const url = new URL(loopbackUri);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      !url.port ||
      url.port === "0" ||
      url.pathname !== DESKTOP_AUTH_CALLBACK_PATH ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Chief received an invalid browser sign-in address.");
    return url.toString();
  }
  return new URL(DESKTOP_AUTH_CALLBACK_PATH, authUiUrl).toString();
}
