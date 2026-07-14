import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "@chief/backend/convex/_generated/api";
import { convex } from "./convex";
import { CONVEX_URL } from "./config";

export type GoogleAnalyticsConnectResult =
  | { status: "opened" }
  | { status: "configurationRequired"; missing: string[] }
  | { status: "error"; message: string };

export async function connectGoogleAnalytics(): Promise<GoogleAnalyticsConnectResult> {
  try {
    const result = (await convex.mutation(
      api.googleAnalytics.startOAuth,
      {},
    )) as
      | { status: "ready"; url: string }
      | { status: "configurationRequired"; missing: string[] };

    if (result.status === "configurationRequired") {
      return result;
    }

    await openUrl(result.url);
    return { status: "opened" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function googleAnalyticsRedirectUri() {
  if (!CONVEX_URL) {
    throw new Error("Chief is missing VITE_CONVEX_URL.");
  }
  return `${CONVEX_URL.replace(".convex.cloud", ".convex.site")}/google-analytics/callback`;
}
