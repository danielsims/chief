import { createCloudflareEmailClient } from "@chief/email/cloudflare";
import { createWorkspaceInvitationMessage } from "@chief/email/invitation-message";
import { createResendEmailClient } from "@chief/email/resend";

export interface WorkspaceInvitationEmail {
  email: string;
  id: string;
  inviter: { email: string; name: string; image?: string | null };
  organization: {
    id: string;
    name: string;
    logo?: string | null;
    website?: string | null;
  };
  role: string | string[];
}

type EmailProvider = "resend" | "cloudflare" | "none";

/**
 * Emails a workspace invitation link using the relay's configured sender.
 * Throws when `EMAIL_PROVIDER` is set but its credentials are missing.
 */
export async function sendWorkspaceInvitationEmail(
  env: Env,
  invitation: WorkspaceInvitationEmail,
) {
  const relay = new URL(env.AUTH_BASE_URL);
  const invitationUrl = new URL(
    `/invitations/${encodeURIComponent(invitation.id)}`,
    env.AUTH_UI_ORIGIN,
  );
  invitationUrl.searchParams.set("relay", relay.origin);
  invitationUrl.searchParams.set("workspace", invitation.organization.id);
  // Shown on the accept page so the recipient can see which address the
  // invitation is for before they try to accept it.
  invitationUrl.searchParams.set("email", invitation.email);
  const role = Array.isArray(invitation.role)
    ? invitation.role.join(", ")
    : invitation.role;
  const message = createWorkspaceInvitationMessage({
    invitationUrl: invitationUrl.toString(),
    inviterEmail: invitation.inviter.email,
    inviterName: invitation.inviter.name,
    inviterImage: relayHostedImage(invitation.inviter.image, relay),
    relayHost: relay.host,
    role,
    workspaceImage:
      relayHostedImage(invitation.organization.logo, relay) ??
      websiteIcon(invitation.organization.website),
    workspaceName: invitation.organization.name,
  });
  const subject = message.subject;
  const fromName = env.EMAIL_FROM_NAME || "Chief";
  const provider = configuredEmailProvider(env);

  if (provider === "resend") {
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM_ADDRESS) {
      throw new Error(
        "EMAIL_PROVIDER=resend requires RESEND_API_KEY and EMAIL_FROM_ADDRESS.",
      );
    }
    await createResendEmailClient({ apiKey: env.RESEND_API_KEY }).send({
      from: { email: env.EMAIL_FROM_ADDRESS, name: fromName },
      to: invitation.email,
      subject,
      html: message.html,
      text: message.text,
    });
    console.info("relay.auth.invitation-email.sent", {
      invitationId: invitation.id,
      provider: "resend",
    });
    return;
  }

  if (provider === "cloudflare") {
    const binding = cloudflareEmailBinding(env);
    if (binding && env.EMAIL_FROM_ADDRESS) {
      await binding.send({
        from: { email: env.EMAIL_FROM_ADDRESS, name: fromName },
        to: invitation.email,
        subject,
        html: message.html,
        text: message.text,
      });
      console.info("relay.auth.invitation-email.sent", {
        invitationId: invitation.id,
        provider: "cloudflare",
      });
      return;
    }
    if (
      env.CLOUDFLARE_ACCOUNT_ID &&
      env.CLOUDFLARE_EMAIL_API_TOKEN &&
      env.EMAIL_FROM_ADDRESS
    ) {
      await createCloudflareEmailClient({
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
        apiToken: env.CLOUDFLARE_EMAIL_API_TOKEN,
      }).send({
        from: { address: env.EMAIL_FROM_ADDRESS, name: fromName },
        to: invitation.email,
        subject,
        html: message.html,
        text: message.text,
      });
      console.info("relay.auth.invitation-email.sent", {
        invitationId: invitation.id,
        provider: "cloudflare",
      });
      return;
    }
    throw new Error(
      "EMAIL_PROVIDER=cloudflare requires the send_email binding, or CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_EMAIL_API_TOKEN, and EMAIL_FROM_ADDRESS.",
    );
  }

  if (provider === "none") {
    console.info("relay.auth.invitation-email.disabled", {
      invitationId: invitation.id,
      recipient: invitation.email,
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
    "Transactional email delivery is not configured for this relay. Set EMAIL_PROVIDER and its credentials.",
  );
}

/**
 * Profile pictures uploaded to a relay are stored with the host they were
 * uploaded through, which may since have changed. Serve them from this relay.
 */
function relayHostedImage(image: string | null | undefined, relay: URL) {
  if (!image) return null;
  try {
    const url = new URL(image);
    if (url.pathname.startsWith("/v1/assets/"))
      return new URL(`${url.pathname}${url.search}`, relay.origin).toString();
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Workspaces without an uploaded logo show their website's icon in Chief.
 * Email clients can't fetch .ico or SVG reliably, so use Google's PNG proxy.
 */
function websiteIcon(website: string | null | undefined) {
  if (!website) return null;
  try {
    const { hostname } = new URL(
      /^https?:\/\//iu.test(website) ? website : `https://${website}`,
    );
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`;
  } catch {
    return null;
  }
}

/** The configured sender, or null to auto-detect. */
function configuredEmailProvider(env: Env): EmailProvider | null {
  const raw = (env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "resend" || raw === "cloudflare" || raw === "none") return raw;
  if (env.RESEND_API_KEY) return "resend";
  if (
    cloudflareEmailBinding(env) ||
    (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_EMAIL_API_TOKEN)
  ) {
    return "cloudflare";
  }
  return null;
}

/** The optional Workers `send_email` binding, present only on a paid plan. */
function cloudflareEmailBinding(env: Env): SendEmail | undefined {
  // Safe because Env only carries EMAIL when the optional send_email binding
  // is declared; this reads it defensively without widening the committed Env.
  const binding = env as Env & { EMAIL?: SendEmail };
  return binding.EMAIL;
}
