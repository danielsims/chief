import { Button, Heading, Text } from "@react-email/components";

import { EmailShell } from "../../components/email-shell";
import { emailStyles } from "../../components/email-styles";
import { workspaceInvitationCopy } from "../../workspace-invitation-message";

export interface WorkspaceInvitationEmailProps {
  invitationUrl: string;
  inviterEmail: string;
  inviterName: string;
  relayHost: string;
  role: string;
  workspaceName: string;
}

export function WorkspaceInvitationEmail({
  invitationUrl,
  inviterEmail,
  inviterName,
  relayHost,
  role,
  workspaceName,
}: WorkspaceInvitationEmailProps) {
  const copy = workspaceInvitationCopy({
    invitationUrl,
    inviterEmail,
    inviterName,
    relayHost,
    role,
    workspaceName,
  });
  return (
    <EmailShell preview={copy.preview} footerNote={copy.safety}>
      <Text style={emailStyles.greeting}>You’re invited</Text>
      <Heading style={{ ...emailStyles.heading, marginTop: "12px" }}>
        Join {workspaceName}
      </Heading>
      <Text style={emailStyles.intro}>{copy.intro}</Text>
      <Text style={emailStyles.copy}>{copy.detail}</Text>
      <Button href={invitationUrl} style={emailStyles.button}>
        Review invitation
      </Button>
      <Text
        style={{ ...emailStyles.copy, fontSize: "12px", marginTop: "24px" }}
      >
        This link is intended for your email address and expires automatically.
        If you weren’t expecting it, you can ignore this message.
      </Text>
    </EmailShell>
  );
}

WorkspaceInvitationEmail.PreviewProps = {
  invitationUrl: "https://heychief.sh/invitations/example",
  inviterEmail: "alex@example.com",
  inviterName: "Alex",
  relayHost: "relay.heychief.sh",
  role: "member",
  workspaceName: "Acme",
} satisfies WorkspaceInvitationEmailProps;

export default WorkspaceInvitationEmail;
