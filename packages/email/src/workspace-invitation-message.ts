export interface WorkspaceInvitationMessageInput {
  invitationUrl: string;
  inviterEmail: string;
  inviterName: string;
  relayHost: string;
  role: string;
  workspaceName: string;
}

export function workspaceInvitationCopy(
  input: WorkspaceInvitationMessageInput,
) {
  return {
    preview: `${input.inviterName} invited you to ${input.workspaceName} in Chief.`,
    intro: `${input.inviterName} invited you to work with their team of agents in Chief.`,
    detail: `You’ll join as ${input.role}. The workspace is hosted by ${input.relayHost}; Chief will show this host again before connecting.`,
    safety: `This invitation was sent by ${input.inviterName} (${input.inviterEmail}). Only continue if you recognize them and the relay shown above.`,
  };
}

export function createWorkspaceInvitationMessage(
  input: WorkspaceInvitationMessageInput,
) {
  const copy = workspaceInvitationCopy(input);
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const workspace = escape(input.workspaceName);
  return {
    html: `<!doctype html><html lang="en"><body style="margin:0;padding:48px 16px;background:#080808;color:#f1f1ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><main style="box-sizing:border-box;max-width:600px;margin:0 auto;padding:42px 48px 38px;background:#111;border:1px solid #292929"><p style="margin:0 0 42px;font-size:23px;font-weight:500;letter-spacing:-.055em">Chief</p><p style="margin:0;color:#e2e2de;font-size:17px">You’re invited</p><h1 style="margin:12px 0 0;color:#f5f5f2;font:400 38px/44px Georgia,'Times New Roman',serif;letter-spacing:-.045em">Join ${workspace}</h1><p style="margin:24px 0 0;color:#e2e2de;font-size:17px;line-height:27px">${escape(copy.intro)}</p><p style="margin:16px 0 0;color:#b9b9b4;font-size:15px;line-height:24px">${escape(copy.detail)}</p><a href="${escape(input.invitationUrl)}" style="display:inline-block;margin-top:30px;padding:13px 18px;background:#f1f1ee;color:#111;font-size:14px;font-weight:600;text-decoration:none">Review invitation</a><p style="margin:24px 0 0;color:#b9b9b4;font-size:12px;line-height:20px">This link is intended for your email address and expires automatically. If you weren’t expecting it, you can ignore this message.</p><hr style="margin:42px 0 20px;border:0;border-top:1px solid #292929"><p style="margin:0 0 12px;color:#8e8e89;font-size:12px;line-height:19px">${escape(copy.safety)}</p><p style="margin:0;color:#74746f;font-size:12px">Chief</p></main></body></html>`,
    text: `You’re invited\n\nJoin ${input.workspaceName}\n\n${copy.intro}\n\n${copy.detail}\n\nReview invitation: ${input.invitationUrl}\n\nThis link is intended for your email address and expires automatically. If you weren’t expecting it, you can ignore this message.\n\n${copy.safety}`,
  };
}
