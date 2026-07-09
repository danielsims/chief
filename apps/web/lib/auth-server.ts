import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";

import { env } from "./env";

// Derive the site URL from the Convex URL if not provided
// The site URL is the HTTP endpoints URL (*.convex.site), derived from the deployment URL
// Handle undefined during CI builds where env validation is skipped
const convexUrl = env.NEXT_PUBLIC_CONVEX_URL;
const convexSiteUrl =
  env.NEXT_PUBLIC_CONVEX_SITE_URL ??
  (convexUrl ? convexUrl.replace(".convex.cloud", ".convex.site") : "");

const auth = convexBetterAuthNextJs({
  convexUrl,
  convexSiteUrl,
});

export const {
  handler,
  preloadAuthQuery,
  fetchAuthQuery,
  fetchAuthMutation,
  fetchAuthAction,
} = auth;

// Next.js signals control flow with special errors carrying a digest — e.g.
// headers() throws DynamicServerError during static prerendering to mark the
// route dynamic, and redirect()/notFound() throw NEXT_-prefixed digests.
// These must propagate: swallowing them prerenders routes as signed-out
// static pages and breaks the build.
function isNextControlFlowError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const digest = (error as { digest?: unknown }).digest;
  return (
    typeof digest === "string" &&
    (digest === "DYNAMIC_SERVER_USAGE" || digest.startsWith("NEXT_"))
  );
}

// auth.getToken() / auth.isAuthenticated() resolve auth state by fetching the
// Convex-hosted token route. Auth-level failures (expired or invalid session,
// 401, 5xx) come back as an empty token without throwing, so anything thrown
// here is transport-level — network down, DNS, timeout, or a non-JSON
// response — never "signed in but errored". Fail closed as signed out rather
// than crashing the route, and log the cause so the failure stays observable.
// Never log cookies, tokens, or headers here.
function logTokenFetchFailure(helper: string, error: unknown) {
  const detail =
    error instanceof Error
      ? `${error.name}: ${error.message}${
          error.cause instanceof Error
            ? ` (cause: ${error.cause.name}: ${error.cause.message})`
            : ""
        }`
      : String(error);

  console.error(
    `[auth] ${helper} could not resolve an authentication token; treating request as signed out. ${detail}`,
  );
}

export async function isAuthenticated() {
  try {
    return await auth.isAuthenticated();
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;
    logTokenFetchFailure("isAuthenticated", error);
    return false;
  }
}

export async function getToken() {
  try {
    return await auth.getToken();
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;
    logTokenFetchFailure("getToken", error);
    return undefined;
  }
}
