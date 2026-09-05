import { invoke, isTauri } from "@tauri-apps/api/core";

/** Event emitted if a local loopback listener receives an OAuth callback. */
export const DESKTOP_OAUTH_LOOPBACK_EVENT = "chief://oauth-loopback";

/** True when a URL is an OAuth authorization response, not another Chief deep link. */
export function isDesktopOAuthCallback(url: string) {
  try {
    const parsed = new URL(url);
    return Boolean(
      parsed.searchParams.get("error") ||
        (parsed.searchParams.get("code") && parsed.searchParams.get("state")),
    );
  } catch {
    return false;
  }
}

export async function stopDesktopOAuthLoopback() {
  if (!isTauri()) return;
  await invoke("stop_oauth_loopback");
}
