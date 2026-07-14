import { Button, Text } from "@react-email/components";

import { PREVIEW_EMAIL_LOGO_URL } from "../../branding";
import { EmailShell } from "../../components/email-shell";
import { emailStyles } from "../../components/email-styles";

export interface AccountCreatedEmailProps {
  firstName?: string;
  dashboardUrl?: string;
  logoUrl?: string;
  supportEmail?: string;
}

export function AccountCreatedEmail({
  firstName,
  dashboardUrl = "https://heychief.sh",
  logoUrl,
  supportEmail = "hello@heychief.sh",
}: AccountCreatedEmailProps) {
  const greeting = firstName ? `Hey ${firstName},` : "Hey there,";

  return (
    <EmailShell
      preview="Your Chief account is ready."
      logoUrl={logoUrl}
      footerNote={
        <>
          If you did not create this account, reply to this email or contact{" "}
          <a href={`mailto:${supportEmail}`} style={supportLink}>
            {supportEmail}
          </a>
          .
        </>
      }
    >
      <Text style={emailStyles.greeting}>{greeting}</Text>
      <Text style={emailStyles.copy}>
        Your account has been created and your workspace is ready. Open Chief to
        finish setting up the agents, integrations, and recurring work you want
        on your team.
      </Text>
      <Button href={dashboardUrl} style={emailStyles.button}>
        Open Chief
      </Button>
    </EmailShell>
  );
}

AccountCreatedEmail.PreviewProps = {
  firstName: "Alex",
  dashboardUrl: "https://heychief.sh",
  logoUrl: PREVIEW_EMAIL_LOGO_URL,
} satisfies AccountCreatedEmailProps;

export default AccountCreatedEmail;

const supportLink = { color: "#c8c8c3", textDecoration: "underline" };
