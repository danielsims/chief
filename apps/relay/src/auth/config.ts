import type { ChiefAuthOptions } from "@chief/auth";

import { sendWorkspaceInvitationEmail } from "../workspace-invitation-email";

export function relayAuthOptions(
  env: Env,
  context?: Pick<ExecutionContext, "waitUntil">,
): ChiefAuthOptions {
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          redirectURI: env.AUTH_GOOGLE_REDIRECT_URI,
        }
      : undefined;
  const apple =
    env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET
      ? appleAuthOptions(env, env.APPLE_CLIENT_ID, env.APPLE_CLIENT_SECRET)
      : undefined;

  return {
    baseURL: env.AUTH_BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    uiOrigin: env.AUTH_UI_ORIGIN,
    google,
    apple,
    sendOrganizationInvitation: (invitation) => {
      const delivery = sendWorkspaceInvitationEmail(env, invitation);
      if (context) {
        context.waitUntil(
          delivery.catch((error: unknown) => {
            console.error("relay.auth.invitation-email.failed", {
              invitationId: invitation.id,
              organizationId: invitation.organization.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }),
        );
        return;
      }
      return delivery;
    },
  };
}

function appleAuthOptions(
  env: Env,
  clientId: string,
  clientSecret: string,
): NonNullable<ChiefAuthOptions["apple"]> {
  const options: NonNullable<ChiefAuthOptions["apple"]> = {
    clientId,
    clientSecret,
  };
  if (env.AUTH_APPLE_REDIRECT_URI) {
    options.redirectURI = env.AUTH_APPLE_REDIRECT_URI;
  }
  if (env.APPLE_APP_BUNDLE_IDENTIFIER) {
    options.appBundleIdentifier = env.APPLE_APP_BUNDLE_IDENTIFIER;
  }
  return options;
}
