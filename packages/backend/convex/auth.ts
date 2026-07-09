import type { AuthFunctions } from "@convex-dev/better-auth";
import type { GenericCtx } from "@convex-dev/better-auth/utils";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { createClient } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
import { createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { generateRandomString } from "better-auth/crypto";
import { bearer, deviceAuthorization, organization } from "better-auth/plugins";

import type { DataModel } from "./_generated/dataModel";
import { components, internal } from "./_generated/api";
import { query } from "./_generated/server";
import authConfig from "./auth.config";
import { convexEnv } from "./env";

// Polyfill for URL.canParse (not available in Convex runtime)
// This must be before any imports that might use it
if (typeof URL.canParse !== "function") {
  URL.canParse = function (url: string, base?: string): boolean {
    try {
      new URL(url, base);
      return true;
    } catch {
      return false;
    }
  };
}

// Reference to this module's exported trigger handlers
// Required for triggers to work - tells the component where to call back
const authFunctions: AuthFunctions = internal.auth;

/**
 * Helper to generate a URL-safe slug from a name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Create the Better Auth client component with triggers
// All auth data (user, session, account, organization, member) lives in betterAuth component
export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    // When a user is created, create their personal organization in betterAuth tables
    user: {
      onCreate: async (ctx, user) => {
        console.log("[Auth Trigger] Creating organization for:", user.email);

        const baseSlug = generateSlug(user.name);

        // Create org + member directly via the adapter instead of auth.api.
        // The API route can't find the user mid-transaction and sometimes
        // creates the org without the member record.
        let createdOrgId: string | null = null;
        let attempts = 0;
        while (!createdOrgId && attempts < 5) {
          const slug =
            attempts === 0
              ? baseSlug
              : `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;

          // Check if slug is taken
          const existing = (await ctx.runQuery(
            components.betterAuth.adapter.findOne,
            {
              model: "organization",
              where: [{ field: "slug", operator: "eq", value: slug }],
            },
          )) as { _id: string } | null;

          if (existing) {
            attempts++;
            console.log(
              `[Auth Trigger] Slug "${slug}" taken, retrying (${attempts}/4)`,
            );
            if (attempts >= 5) break;
            continue;
          }

          try {
            // Create the organization
            const org = (await ctx.runMutation(
              components.betterAuth.adapter.create,
              {
                input: {
                  model: "organization",
                  data: {
                    name: user.name,
                    slug,
                    createdAt: Date.now(),
                    metadata: JSON.stringify({ personalOrgUserId: user._id }),
                  },
                },
              },
            )) as { _id: string };

            // Create the member record linking user to org
            await ctx.runMutation(components.betterAuth.adapter.create, {
              input: {
                model: "member",
                data: {
                  userId: user._id,
                  organizationId: org._id,
                  role: "owner",
                  createdAt: Date.now(),
                },
              },
            });

            createdOrgId = org._id;
            console.log(
              "[Auth Trigger] Organization + member created for:",
              user.email,
              "slug:",
              slug,
              "orgId:",
              org._id,
            );
          } catch (error) {
            console.error(
              "[Auth Trigger] Failed to create organization:",
              error instanceof Error ? error.message : String(error),
            );
            break;
          }
        }

        // Set activeOrganizationId on any existing sessions for this user.
        // The session.create.before databaseHook can't find the org during
        // signup because the trigger hasn't run yet at that point.
        if (createdOrgId) {
          try {
            const sessions = (await ctx.runQuery(
              components.betterAuth.adapter.findMany,
              {
                model: "session",
                where: [{ field: "userId", operator: "eq", value: user._id }],
                paginationOpts: { numItems: 10, cursor: null },
              },
            )) as { page: { _id: string; activeOrganizationId?: string }[] };

            for (const session of sessions.page) {
              if (!session.activeOrganizationId) {
                await ctx.runMutation(components.betterAuth.adapter.updateOne, {
                  input: {
                    model: "session",
                    update: { activeOrganizationId: createdOrgId },
                    where: [
                      { field: "_id", operator: "eq", value: session._id },
                    ],
                  },
                });
                console.log(
                  "[Auth Trigger] Patched session with orgId:",
                  session._id,
                );
              }
            }
          } catch (error) {
            console.error("[Auth Trigger] Failed to patch sessions:", error);
          }
        }
      },
    },
    // Note: Session activeOrganizationId is set via databaseHooks in createAuthOptions
    // This ensures the JWT has the organization ID from the start
  },
});

// Export trigger handlers for use in the component
export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

/**
 * Desktop PKCE Auth Plugin
 *
 * Implements a PKCE-based authentication flow for the Tauri desktop app,
 * adapted from BetterAuth's Electron plugin. This is stateless-compatible
 * with Convex (new BetterAuth instance per request).
 *
 * Flow:
 * 1. Desktop opens browser to /sign-in with client_id, code_challenge, state
 * 2. Sign-in page passes PKCE params through Google OAuth as query params
 * 3. After auth callback, plugin stores PKCE params in a signed transfer cookie
 * 4. When newSession is created, plugin creates a verification record and
 *    sets a non-httpOnly cookie with the authorization code
 * 5. Success page reads cookie and redirects to marketer-desktop:///auth#token=...
 * 6. Desktop extracts token, exchanges it via POST /desktop/token with code_verifier
 * 7. Server validates PKCE and returns a session token
 */
const TAURI_SCHEME = "marketer-desktop";
const DESKTOP_CLIENT_ID = "marketer-desktop";
const DESKTOP_COOKIE_PREFIX = "better-auth";
const CODE_EXPIRES_IN = 300; // 5 minutes

// Helper to safely parse JSON without throwing
function safeJsonParse<T>(str: string): T | null {
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

// Helper for base64url encoding (Convex runtime has no Buffer)
function base64UrlEncode(data: Uint8Array): string {
  const binary = Array.from(data, (b) => String.fromCharCode(b)).join("");
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Helper for base64url decoding
function base64UrlDecode(str: string): Uint8Array {
  // Restore standard base64
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding
  while (base64.length % 4) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Timing-safe comparison using Web Crypto (Convex has no Node crypto)
function timingSafeCompare(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return result === 0;
}

function createDesktopPkcePlugin(): BetterAuthPlugin {
  const hookMatcher = (ctx: { path?: string }) => {
    if (!ctx.path) return false;
    return (
      ctx.path.startsWith("/sign-in") ||
      ctx.path.startsWith("/sign-up") ||
      ctx.path.startsWith("/callback")
    );
  };

  return {
    id: "desktop-pkce",
    endpoints: {
      desktopToken: createAuthEndpoint(
        "/desktop/token",
        {
          method: "POST",
        },
        async (ctx) => {
          const body = ctx.body as {
            token?: string;
            state?: string;
            code_verifier?: string;
          };
          if (!body.token || !body.state || !body.code_verifier) {
            throw new Error(
              "Missing required fields: token, state, code_verifier",
            );
          }
          // Look up the verification record
          const record =
            await ctx.context.internalAdapter.findVerificationValue(
              `desktop:${body.token}`,
            );
          if (!record || record.expiresAt < new Date()) {
            throw new Error("Invalid or expired authorization code");
          }

          const tokenData = safeJsonParse<{
            userId: string;
            codeChallenge: string;
            codeChallengeMethod: string;
            state: string;
          }>(record.value);
          if (!tokenData) {
            throw new Error("Invalid verification record");
          }

          // Verify state matches
          if (tokenData.state !== body.state) {
            throw new Error("State mismatch");
          }

          // Verify PKCE: SHA-256(code_verifier) should match stored codeChallenge
          if (!tokenData.codeChallenge) {
            throw new Error("Missing code challenge");
          }

          if (tokenData.codeChallengeMethod === "s256") {
            const verifierHash = new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(body.code_verifier),
              ),
            );
            const storedChallenge = base64UrlDecode(tokenData.codeChallenge);

            if (!timingSafeCompare(verifierHash, storedChallenge)) {
              throw new Error("PKCE verification failed");
            }
          } else {
            if (tokenData.codeChallenge !== body.code_verifier) {
              throw new Error("PKCE verification failed");
            }
          }

          // Delete the verification record (one-time use)
          await ctx.context.internalAdapter.deleteVerificationByIdentifier(
            `desktop:${body.token}`,
          );

          // Find the user
          const user = await ctx.context.internalAdapter.findUserById(
            tokenData.userId,
          );
          if (!user) {
            throw new Error("User not found");
          }

          // Create a new session
          const session = await ctx.context.internalAdapter.createSession(
            user.id,
          );

          console.log(
            "[Desktop PKCE] Token exchanged for user:",
            user.id,
            "session:",
            session.id,
          );

          return ctx.json({
            token: session.token,
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
              emailVerified: user.emailVerified,
              image: user.image,
            },
          });
        },
      ),
    },
    hooks: {
      after: [
        {
          // For non-auth paths: refresh the transfer cookie if it exists
          // so it doesn't expire during multi-step OAuth flows
          matcher: (ctx) => !hookMatcher(ctx),
          handler: createAuthMiddleware(async (ctx) => {
            const transferCookie = await ctx.getSignedCookie(
              `${DESKTOP_COOKIE_PREFIX}.transfer_token`,
              ctx.context.secret,
            );
            if (!ctx.context.newSession?.session || !transferCookie) {
              return;
            }

            const cookie = ctx.context.createAuthCookie("transfer_token", {
              maxAge: CODE_EXPIRES_IN,
            });
            await ctx.setSignedCookie(
              cookie.name,
              transferCookie,
              ctx.context.secret,
              cookie.attributes,
            );
          }),
        },
        {
          // For sign-in/sign-up/callback paths: handle PKCE flow
          matcher: hookMatcher,
          handler: createAuthMiddleware(async (ctx) => {
            const cookie = ctx.context.createAuthCookie("transfer_token", {
              maxAge: CODE_EXPIRES_IN,
            });

            // Step 1: On sign-in/sign-up with client_id, store PKCE params
            // in a signed transfer cookie for retrieval after OAuth callback.
            // Check both query params and body — the desktop opens the browser
            // with query params, but the web sign-in page may pass them via
            // the signIn.social() body.
            const reqBody = ctx.body as Record<string, unknown> | undefined;
            const paramClientId = String(
              ctx.query?.client_id ?? reqBody?.client_id ?? "",
            );
            const paramChallenge = String(
              ctx.query?.code_challenge ?? reqBody?.code_challenge ?? "",
            );
            const paramMethod = String(
              ctx.query?.code_challenge_method ??
                reqBody?.code_challenge_method ??
                "S256",
            );
            const paramState = String(ctx.query?.state ?? reqBody?.state ?? "");

            const isSignInPath =
              ctx.path.startsWith("/sign-in") ||
              ctx.path.startsWith("/sign-up");
            if (paramClientId === DESKTOP_CLIENT_ID && isSignInPath) {
              if (paramChallenge && paramState) {
                await ctx.setSignedCookie(
                  cookie.name,
                  JSON.stringify({
                    client_id: paramClientId,
                    code_challenge: paramChallenge,
                    code_challenge_method: paramMethod,
                    state: paramState,
                  }),
                  ctx.context.secret,
                  cookie.attributes,
                );
              }
            }

            // Step 2: If we have a newSession (auth completed), create the
            // verification record and set the authorization code cookie
            if (!ctx.context.newSession?.session) {
              return;
            }

            // Try to get PKCE params from signed transfer cookie first,
            // then fall back to query params (for single-step flows)
            const transferCookie = await ctx.getSignedCookie(
              cookie.name,
              ctx.context.secret,
            );
            // Clear the transfer cookie
            ctx.setCookie(cookie.name, "", {
              ...cookie.attributes,
              maxAge: 0,
            });

            interface TransferPayload {
              client_id: string;
              code_challenge: string;
              code_challenge_method: string;
              state: string;
            }

            let transferPayload: TransferPayload | null = null;
            if (transferCookie) {
              transferPayload = safeJsonParse<TransferPayload>(transferCookie);
            } else {
              // Check query params and body as fallback
              const cbBody = ctx.body as Record<string, unknown> | undefined;
              const qClientId =
                (ctx.query?.client_id as string | undefined) ??
                (cbBody?.client_id as string | undefined);
              const qChallenge =
                (ctx.query?.code_challenge as string | undefined) ??
                (cbBody?.code_challenge as string | undefined);
              const qState =
                (ctx.query?.state as string | undefined) ??
                (cbBody?.state as string | undefined);
              if (qClientId === DESKTOP_CLIENT_ID && qChallenge && qState) {
                transferPayload = {
                  client_id: qClientId,
                  code_challenge: qChallenge,
                  code_challenge_method: String(
                    ctx.query?.code_challenge_method ??
                      cbBody?.code_challenge_method ??
                      "S256",
                  ),
                  state: qState,
                };
              }
            }

            if (transferPayload?.client_id !== DESKTOP_CLIENT_ID) {
              return;
            }

            const userId = ctx.context.newSession.user.id;
            if (!userId) {
              return;
            }

            // Create a one-time verification record with the PKCE code_challenge
            const identifier = generateRandomString(32, "a-z", "A-Z", "0-9");
            const expiresAt = new Date(Date.now() + CODE_EXPIRES_IN * 1000);

            await ctx.context.internalAdapter.createVerificationValue({
              identifier: `desktop:${identifier}`,
              value: JSON.stringify({
                userId,
                codeChallenge: transferPayload.code_challenge,
                codeChallengeMethod:
                  transferPayload.code_challenge_method.toLowerCase(),
                state: transferPayload.state,
              }),
              expiresAt,
            });

            // Set a non-httpOnly cookie with the authorization code so the
            // browser success page JS can read it and redirect to the deep link
            const redirectToken = base64UrlEncode(
              new TextEncoder().encode(
                JSON.stringify({
                  identifier,
                  state: transferPayload.state,
                }),
              ),
            );

            const redirectCookieName = `${DESKTOP_COOKIE_PREFIX}.${DESKTOP_CLIENT_ID}`;
            ctx.setCookie(redirectCookieName, redirectToken, {
              ...ctx.context.authCookies.sessionToken.attributes,
              maxAge: CODE_EXPIRES_IN,
              httpOnly: false,
            });

            console.log(
              "[Desktop PKCE] Created verification record for user:",
              userId,
              "identifier:",
              identifier,
            );
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}

// Auth options factory - creates options for each request context
// Note: convexEnv() is called inside this function (not at module level)
// because Convex env vars are only available at runtime, not during bundling
export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
  const env = convexEnv();
  const adapter = authComponent.adapter(ctx);

  // Build plugins array
  const plugins: BetterAuthPlugin[] = [
    bearer(), // Accept raw session tokens via Authorization: Bearer header (desktop app)
    createDesktopPkcePlugin(), // Desktop PKCE auth (stateless for Convex)
    organization({
      organizationHooks: {
        // Append a 4-digit random suffix to prevent slug collisions
        beforeCreateOrganization: async ({ organization: org }) => {
          const suffix = Math.floor(1000 + Math.random() * 9000);
          return {
            data: { ...org, slug: `${org.slug}-${suffix}` },
          };
        },
      },
    }), // Organization plugin - data stored in betterAuth tables
    // Device Authorization for headless/remote CLI authentication (RFC 8628)
    // This allows agents to authenticate without a local browser
    deviceAuthorization({
      verificationUri: "/device", // Web page where users enter the code
      expiresIn: "30 min", // 30 minutes to complete auth
      interval: "5 sec", // CLI polls every 5 seconds
      userCodeLength: 8, // e.g., "ABCD-1234"
      validateClient: (clientId) => {
        // Only allow our CLI client
        return clientId === "marketer-cli";
      },
    }),
  ];

  // Always add the convex plugin last
  plugins.push(
    convex({
      authConfig,
      // Include activeOrganizationId in the JWT payload so Convex can access it
      jwt: {
        definePayload: ({ user, session }) => ({
          // Include user fields
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          // Include the active organization ID from the session
          organizationId: session.activeOrganizationId as string | undefined,
          // Session ID for reference
          sessionId: session.id,
        }),
      },
    }),
  );

  return {
    appName: "Marketer",
    baseURL: env.BASE_URL,
    secret: env.AUTH_SECRET,
    database: adapter,
    // Desktop OAuth: the Tauri HTTP client sets the state cookie but the
    // browser callback can't read it (different cookie jar). The DB state
    // lookup still validates the request — this only skips the redundant
    // cookie cross-check.
    account: {
      skipStateCookieCheck: true,
    },
    emailAndPassword: {
      enabled: true,
    },
    socialProviders: {
      google: {
        clientId: env.AUTH_GOOGLE_ID,
        clientSecret: env.AUTH_GOOGLE_SECRET,
        redirectURI: `${env.BASE_URL}/api/auth/callback/google`,
      },
    },
    // Trust the app's origin and desktop app origins
    trustedOrigins: [
      env.BASE_URL,
      `${TAURI_SCHEME}://`,
      "http://localhost:1420", // Tauri dev (Vite)
      "tauri://localhost", // Tauri production (macOS)
      "https://tauri.localhost", // Tauri production (Windows)
    ].filter(Boolean),
    plugins,
    databaseHooks: {
      // Set activeOrganizationId on session BEFORE it's created
      // This ensures the JWT has the organization ID from the start
      session: {
        create: {
          before: async (session: Record<string, unknown>) => {
            console.log(
              "[DatabaseHook] session.create.before FIRED, userId:",
              session.userId,
              "existing activeOrganizationId:",
              session.activeOrganizationId,
            );

            // If it already has an org ID (e.g. from organization plugin), keep it
            if (session.activeOrganizationId) {
              console.log("[DatabaseHook] Already has org, skipping");
              return { data: session };
            }

            try {
              // Query the betterAuth component's member table using Convex context
              const orgId = await ctx.runQuery(
                components.betterAuth.organizations.getUserDefaultOrganization,
                { userId: session.userId as string },
              );

              console.log(
                "[DatabaseHook] getUserDefaultOrganization returned:",
                orgId,
              );

              if (orgId) {
                return {
                  data: {
                    ...session,
                    activeOrganizationId: orgId,
                  },
                };
              }
            } catch (error) {
              console.error(
                "[DatabaseHook] Error finding organization:",
                error,
              );
            }

            console.log(
              "[DatabaseHook] No organization found for user:",
              session.userId,
            );
            return { data: session };
          },
        },
      },
    },
    onAPIError: {
      onError(error, ctx) {
        console.error("[Better Auth] API Error:", error, ctx);
      },
    },
  } satisfies BetterAuthOptions;
};

// Create Better Auth instance for a given context
export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx));

// Export the getAuthUser helper from the component
export const { getAuthUser } = authComponent.clientApi();

// Get the current authenticated user
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return authComponent.safeGetAuthUser(ctx);
  },
});
