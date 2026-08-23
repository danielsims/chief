import type { ChiefAuthOptions } from "@chief/auth";
import { createCloudflareEmailClient } from "@chief/email/cloudflare";
import { createWorkspaceInvitationMessage } from "@chief/email/invitation-message";

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

  return {
    baseURL: env.AUTH_BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    uiOrigin: env.AUTH_UI_ORIGIN,
    google,
    sendOrganizationInvitation: (invitation) => {
      const delivery = deliverOrganizationInvitation(env, invitation);
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

async function deliverOrganizationInvitation(
  env: Env,
  invitation: Parameters<
    NonNullable<ChiefAuthOptions["sendOrganizationInvitation"]>
  >[0],
) {
  const relay = new URL(env.AUTH_BASE_URL);
  const invitationUrl = new URL(
    `/invitations/${encodeURIComponent(invitation.id)}`,
    env.AUTH_UI_ORIGIN,
  );
  invitationUrl.searchParams.set("relay", relay.origin);
  invitationUrl.searchParams.set("workspace", invitation.organization.id);
  const role = Array.isArray(invitation.role)
    ? invitation.role.join(", ")
    : invitation.role;
  const message = createWorkspaceInvitationMessage({
    invitationUrl: invitationUrl.toString(),
    inviterEmail: invitation.inviter.email,
    inviterName: invitation.inviter.name,
    relayHost: relay.host,
    role,
    workspaceName: invitation.organization.name,
  });

  if (
    env.CLOUDFLARE_ACCOUNT_ID &&
    env.CLOUDFLARE_EMAIL_API_TOKEN &&
    env.EMAIL_FROM_ADDRESS
  ) {
    const client = createCloudflareEmailClient({
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: env.CLOUDFLARE_EMAIL_API_TOKEN,
    });
    await client.send({
      from: {
        address: env.EMAIL_FROM_ADDRESS,
        name: env.EMAIL_FROM_NAME || "Chief",
      },
      to: invitation.email,
      subject: `${invitation.inviter.name} invited you to ${invitation.organization.name}`,
      html: message.html,
      text: message.text,
    });
    return;
  }

  if (env.RELAY_DEPLOYMENT === "local") {
    console.info("relay.auth.invitation-email.local", {
      invitationId: invitation.id,
      invitationUrl: invitationUrl.toString(),
      recipient: invitation.email,
    });
    return;
  }
  throw new Error(
    "Transactional email delivery is not configured for this relay.",
  );
}
