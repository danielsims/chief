import { Button, Text } from "@react-email/components";
import type { CSSProperties } from "react";
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
  logoUrl = "https://heychief.sh/brand/chief-mark-white.png",
}: FounderWelcomeEmailProps) {
  const greeting = firstName ? `Hey ${firstName},` : "Hey there,";

  return (
    <EmailShell
      footerNote="You’re receiving this because you created a Chief account. Reply any time."
      logoUrl={logoUrl}
      preview="Why I’m building Chief, and what comes next."
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
        I’ve spent years building software, and the last few really diving deep
        into AI agents and this new way of building.
      </Text>
      <Text style={emailStyles.copy}>
        With the state of AI today, it feels possible to build almost anything
        you can imagine. It’s one of the most exciting times to be a builder.
        I’ve been having so much fun being able to take an idea and bring it to
        life in the span of a day or two.
      </Text>
      <Text style={emailStyles.copy}>
        But even if it’s now possible to build your killer app in a weekend,
        getting it into the hands of users is still hard. Distribution, finding
        the right audience and getting useful feedback are arguably more
        important than ever.
      </Text>
      <Text style={emailStyles.copy}>
        At the same time, I’ve been really interested in building proactive
        agents that can keep working in the background without me constantly
        managing them. I want to be able to step away, come back and find useful
        work already completed on my behalf.
      </Text>
      <Text style={emailStyles.copy}>
        I’m building Chief to be the place where I can create, deploy and manage
        my team of agents, as well as a place to receive updates from the team,
        keep me in the loop and drive direction from a top level.
      </Text>

      <Text style={sectionHeading}>Tips and tricks coming your way</Text>
      <Text style={emailStyles.copy}>
        Over the next week, I’ll be sending you a daily email with guides and
        information to help you get up and running with Chief. Best practices
        and guides to really help you squeeze some extra juice out of your
        agents.
      </Text>

      <Text style={sectionHeading}>We’re just getting started</Text>
      <Text style={emailStyles.copy}>
        There are so many other avenues that I see would be excellent for
        proactive agents, and marketing is a first step towards having a fleet
        of self-operating, self-improving, self-replicating agents that carry
        forward meaningful work for me every day.
      </Text>
      <Text style={emailStyles.copy}>
        I chose marketing as an early avenue to explore because it solves a
        meaningful problem for me that actually provides value in my day to day.
        But this is only the starting point. I’m looking forward to steadily
        increasing the scope of work Chief can take on for you, across more of
        your business and eventually well beyond marketing.
      </Text>

      <Text style={sectionHeading}>Get in touch!</Text>
      <Text style={emailStyles.copy}>
        I’d love to hear any early results, papercuts, feature requests or
        critique that you have! The product is in its early stages and I’ll be
        working to improve it every day.
      </Text>
      <Text style={emailStyles.copy}>
        If you want to get in touch, just reply to this email! I love talking to
        users. My agents forward every single piece of user feedback that I get.
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
  logoUrl: "http://localhost:3001/static/chief-mark-white.png",
} satisfies FounderWelcomeEmailProps;

export default FounderWelcomeEmail;
