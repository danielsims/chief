import type { CSSProperties } from "react";
import { Button, Text } from "@react-email/components";

import { PREVIEW_EMAIL_LOGO_URL } from "../../branding";
import { EmailShell } from "../../components/email-shell";
import { emailStyles } from "../../components/email-styles";

export interface FounderWelcomeEmailProps {
  firstName?: string;
  dashboardUrl?: string;
  logoUrl?: string;
}

export function FounderWelcomeEmail({
  firstName,
  dashboardUrl = "https://heychief.sh",
  logoUrl,
}: FounderWelcomeEmailProps) {
  const greeting = firstName ? `Hey ${firstName},` : "Hey there,";

  return (
    <EmailShell
      footerNote="You’re receiving this because you created a Chief account. Reply any time."
      logoUrl={logoUrl}
      preview="Why I’m building Chief, and where to start."
    >
      <Text style={emailStyles.greeting}>{greeting}</Text>
      <Text style={emailStyles.copy}>
        Thanks for downloading the app. I’m Daniel, the founder of Chief.
      </Text>

      <FounderWelcomeCopy />

      <Button href={dashboardUrl} style={emailStyles.button}>
        Open Chief
      </Button>
      <Text style={emailStyles.signature}>
        Cheers,
        <br />
        <br />
        Daniel
        <br />
        Founder &amp; CEO
      </Text>
    </EmailShell>
  );
}

function FounderWelcomeCopy() {
  return (
    <>
      <Text style={sectionHeading}>Why I’m building Chief</Text>
      <Text style={emailStyles.copy}>
        I’ve spent years building software, and the last few working closely
        with AI agents. They’re now capable of real work, but most of them still
        wait for you to prompt them, and their output ends up scattered across
        chats, terminals and tabs.
      </Text>
      <Text style={emailStyles.copy}>
        I wanted one place where a team of agents could work alongside the
        people they work for: in shared channels and direct messages, on their
        own schedules, picking up work in the background and reporting back when
        it’s done. That’s Chief.
      </Text>
      <Text style={emailStyles.copy}>
        Your agents can run in Chief Cloud, on your Mac or on your phone. You
        decide what they can access, and your team sees the same workspace from
        every device.
      </Text>

      <Text style={sectionHeading}>Where to start</Text>
      <Text style={emailStyles.copy}>
        Give one agent a job you repeat every week and let it run on a schedule.
        Then invite a teammate, so the work and the conversations about it live
        in the same place.
      </Text>

      <Text style={sectionHeading}>Tell me what you think</Text>
      <Text style={emailStyles.copy}>
        Chief is early, and I’m improving it every day. Results, papercuts,
        feature requests and blunt critique are all welcome. Just reply to this
        email; I read every one.
      </Text>
    </>
  );
}

const sectionHeading: CSSProperties = {
  ...emailStyles.sectionHeading,
  margin: "34px 0 0",
};

FounderWelcomeEmail.PreviewProps = {
  firstName: "Alex",
  dashboardUrl: "https://heychief.sh",
  logoUrl: PREVIEW_EMAIL_LOGO_URL,
} satisfies FounderWelcomeEmailProps;

export default FounderWelcomeEmail;
