import {
  Body,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Row,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";
import { getEmailBranding } from "../branding";

export interface EmailShellProps {
  children: ReactNode;
  preview: string;
  applicationName?: string;
  companyName?: string;
  footerNote?: ReactNode;
  logoUrl?: string;
}

export function EmailShell({
  children,
  preview,
  applicationName,
  companyName,
  footerNote,
  logoUrl = "https://heychief.sh/brand/chief-mark-white.png",
}: EmailShellProps) {
  const branding = getEmailBranding();
  const resolvedApplicationName = applicationName ?? branding.applicationName;
  const resolvedCompanyName = companyName ?? branding.companyName;

  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Row>
            <Column style={markColumn}>
              <Img alt="" height="32" src={logoUrl} style={mark} width="32" />
            </Column>
            <Column>
              <Text style={wordmark}>{resolvedApplicationName}</Text>
            </Column>
          </Row>
          <Hr style={headerRule} />
          {children}
          <Hr style={footerRule} />
          {footerNote ? (
            <Text style={footerNoteStyle}>{footerNote}</Text>
          ) : null}
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

const body = {
  backgroundColor: "#080808",
  color: "#f1f1ee",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  margin: 0,
  padding: "48px 16px",
};

const container = {
  backgroundColor: "#111111",
  border: "1px solid #292929",
  margin: "0 auto",
  maxWidth: "600px",
  padding: "42px 48px 38px",
};

const wordmark = {
  fontSize: "23px",
  fontWeight: "500",
  letterSpacing: "-0.055em",
  lineHeight: "32px",
  margin: 0,
};

const markColumn = { width: "39px" };
const mark = { display: "block" };

const headerRule = { borderColor: "#292929", margin: "22px 0 42px" };
const footerRule = { borderColor: "#292929", margin: "42px 0 20px" };
const footerNoteStyle = {
  color: "#8e8e89",
  fontSize: "12px",
  lineHeight: "19px",
  margin: "0 0 12px",
};
const footer = { color: "#74746f", fontSize: "12px", margin: 0 };
