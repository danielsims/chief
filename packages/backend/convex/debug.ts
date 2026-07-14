import { internalAction } from "./_generated/server";

/**
 * Temporary connectivity probe: verifies the deployment can reach Google's
 * OAuth token endpoint. A 400 JSON response from Google proves connectivity
 * (we send no credentials). Delete once auth is verified end to end.
 */
export const probeGoogleToken = internalAction({
  args: {},
  handler: async () => {
    const results: Record<string, string> = {};
    for (const url of [
      "https://oauth2.googleapis.com/token",
      "https://accounts.google.com/.well-known/openid-configuration",
    ]) {
      try {
        const res = await fetch(url, {
          method: url.endsWith("/token") ? "POST" : "GET",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: url.endsWith("/token")
            ? "grant_type=authorization_code"
            : undefined,
        });
        const text = await res.text();
        results[url] = `HTTP ${res.status}: ${text.slice(0, 120)}`;
      } catch (error) {
        results[url] =
          `FETCH ERROR: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    return results;
  },
});
