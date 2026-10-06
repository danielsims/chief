export interface WorkspaceInvitationMessageInput {
  invitationUrl: string;
  inviterEmail: string;
  inviterName: string;
  /** Absolute https URL of the inviter's profile picture, when they have one. */
  inviterImage?: string | null;
  relayHost: string;
  role: string;
  workspaceName: string;
  /** Where the Chief mark is served from; defaults to the public site. */
  logoUrl?: string;
}

const DEFAULT_LOGO_URL = "https://heychief.sh/brand/chief-mark-white.png";

export function workspaceInvitationCopy(
  input: WorkspaceInvitationMessageInput,
) {
  const role = input.role.trim().toLowerCase();
  const article = /^[aeiou]/u.test(role) ? "an" : "a";
  return {
    subject: `${input.inviterName} invited you to ${input.workspaceName}`,
    preview: `${input.inviterName} invited you to ${input.workspaceName} on Chief.`,
    invitedTo: "invited you to collaborate on Chief.",
    action: `Join ${input.workspaceName}`,
    detail: `You’ll join as ${article} ${role}, hosted on ${input.relayHost}.`,
    expiry:
      "This link is for your email address and expires automatically. If you weren’t expecting it, you can ignore this email.",
    safety: `Sent by ${input.inviterName} (${input.inviterEmail}). Only continue if you recognise them and the host above.`,
  };
}

const fontStack =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif";

function escape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function initial(name: string) {
  return escape(name.trim().charAt(0).toUpperCase() || "?");
}

/** A rounded-square picture, or the name's initial when there is none. */
function picture(input: {
  image?: string | null;
  name: string;
  size: number;
  radius: number;
  fontSize: number;
}) {
  const box = `width:${input.size}px;height:${input.size}px;border-radius:${input.radius}px`;
  if (input.image?.startsWith("https://")) {
    return `<img src="${escape(input.image)}" width="${input.size}" height="${input.size}" alt="" style="display:block;${box};object-fit:cover;border:0">`;
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr><td align="center" valign="middle" style="${box};background:#262626;color:#f5f5f2;font:500 ${input.fontSize}px/${input.size}px ${fontStack}">${initial(input.name)}</td></tr></table>`;
}

/**
 * The workspace invitation, as both HTML and plain text. This is the email the
 * relay sends; the React Email preview renders this same markup.
 */
export function createWorkspaceInvitationMessage(
  input: WorkspaceInvitationMessageInput,
) {
  const copy = workspaceInvitationCopy(input);
  const url = escape(input.invitationUrl);
  const muted = "color:#8e8e89";
  const content = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0a0a"><tr><td align="center" style="padding:40px 16px 48px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px"><tr><td style="padding:0 0 56px"><img src="${escape(input.logoUrl ?? DEFAULT_LOGO_URL)}" width="28" height="28" alt="Chief" style="display:block;border:0"></td></tr><tr><td align="center">${picture({ name: input.workspaceName, size: 64, radius: 18, fontSize: 26 })}</td></tr><tr><td align="center" style="padding:24px 0 0;font:500 28px/34px ${fontStack};letter-spacing:-0.02em;color:#f5f5f2">${escape(copy.action)}</td></tr><tr><td align="center" style="padding:14px 0 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" style="padding:0 8px 0 0">${picture({ image: input.inviterImage, name: input.inviterName, size: 20, radius: 6, fontSize: 11 })}</td><td valign="middle" style="font:400 14px/20px ${fontStack};${muted}"><span style="color:#f5f5f2">${escape(input.inviterName)}</span> ${escape(copy.invitedTo)}</td></tr></table></td></tr><tr><td style="padding:32px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="border-radius:10px;background:#f1f1ee"><a href="${url}" style="display:block;padding:13px 20px;font:600 15px/20px ${fontStack};color:#111111;text-decoration:none;border-radius:10px">${escape(copy.action)}</a></td></tr></table></td></tr><tr><td align="center" style="padding:16px 0 0;font:400 13px/20px ${fontStack};${muted}">${escape(copy.detail)}</td></tr><tr><td style="padding:40px 0 0"><div style="border-top:1px solid #222222;font-size:0;line-height:0">&nbsp;</div></td></tr><tr><td align="center" style="padding:18px 0 0;font:400 12px/18px ${fontStack};color:#74746f">${escape(copy.expiry)} ${escape(copy.safety)}</td></tr></table></td></tr></table>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escape(copy.subject)}</title></head><body style="margin:0;padding:0;background:#0a0a0a;color:#f5f5f2;font-family:${fontStack};-webkit-font-smoothing:antialiased"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(copy.preview)}</div>${content}</body></html>`;
  const text = [
    `${input.inviterName} (${input.inviterEmail}) invited you to join ${input.workspaceName} on Chief.`,
    `${copy.action}: ${input.invitationUrl}`,
    copy.detail,
    copy.expiry,
    copy.safety,
  ].join("\n\n");
  return { subject: copy.subject, preview: copy.preview, content, html, text };
}
