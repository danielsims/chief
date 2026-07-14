import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

import { getEmailBranding } from "../branding";

export interface ChiefEmailProps {
  preview: string;
  heading: string;
  children?: string;
  actionLabel?: string;
  actionUrl?: string;
  applicationName?: string;
  companyName?: string;
}

export function ChiefEmail({
  preview,
  heading,
  children,
  actionLabel,
  actionUrl,
  applicationName,
  companyName,
}: ChiefEmailProps) {
  const branding = getEmailBranding();
  const resolvedApplicationName = applicationName ?? branding.applicationName;
  const resolvedCompanyName = companyName ?? branding.companyName;

  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={wordmark}>{resolvedApplicationName}</Text>
          <Section style={panel}>
            <Heading style={title}>{heading}</Heading>
            {children ? <Text style={copy}>{children}</Text> : null}
            {actionLabel && actionUrl ? (
              <Button href={actionUrl} style={button}>
                {actionLabel}
              </Button>
            ) : null}
          </Section>
          <Hr style={rule} />
          <Text style={footer}>
            {resolvedCompanyName
              ? `${resolvedApplicationName} by ${resolvedCompanyName}`
              : resolvedApplicationName}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

ChiefEmail.PreviewProps = {
  preview: "Your Chief workspace is ready.",
  heading: "The work is moving.",
  children:
    "Your agents have finished setting up the first pieces of your workspace.",
  actionLabel: "Open Chief",
  actionUrl: "https://heychief.sh",
} satisfies ChiefEmailProps;

export default ChiefEmail;

const body = {
  backgroundColor: "#0b0b0b",
  color: "#ededeb",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  margin: 0,
  padding: "40px 16px",
};

const container = { margin: "0 auto", maxWidth: "560px" };
const wordmark = { fontSize: "20px", fontWeight: "600", margin: "0 0 28px" };
const panel = { border: "1px solid #2a2a2a", padding: "36px" };
const title = {
  fontSize: "30px",
  fontWeight: "500",
  letterSpacing: "-0.04em",
  margin: 0,
};
const copy = {
  color: "#aaa9a5",
  fontSize: "15px",
  lineHeight: "24px",
  margin: "20px 0 0",
};
const button = {
  backgroundColor: "#ededeb",
  color: "#111",
  display: "inline-block",
  fontSize: "14px",
  fontWeight: "600",
  marginTop: "28px",
  padding: "12px 18px",
  textDecoration: "none",
};
const rule = { borderColor: "#242424", margin: "28px 0 18px" };
const footer = { color: "#777773", fontSize: "12px", margin: 0 };
