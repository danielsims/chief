import type { CSSProperties, ReactNode } from "react";
import {
  Button,
  Column,
  Img,
  Link,
  Row,
  Section,
  Text,
} from "@react-email/components";

import { PREVIEW_EMAIL_LOGO_URL } from "../../branding";
import { EmailShell } from "../../components/email-shell";

export interface DigestIntegration {
  name: string;
  domain: string;
}

/**
 * Digest data intentionally mirrors records Chief already stores locally:
 * completed work, action items, workspace records, and schedules.
 * The email renderer does not infer outcomes or create marketing metrics.
 */
export interface DigestCompletedWork {
  id: string;
  title: string;
  agentName: string;
  summary: string;
  integrations?: DigestIntegration[];
  url?: string;
}

export interface DigestActionItem {
  id: string;
  title: string;
  reason: string;
  agentName: string;
  integrations?: DigestIntegration[];
  url?: string;
}

export interface DigestScheduleItem {
  id: string;
  title: string;
  agentName: string;
  nextAtLabel: string;
  timezone: string;
  integrations?: DigestIntegration[];
  url?: string;
}

export interface DigestWorkspaceRecords {
  newProspects: number;
  newTrends: number;
  draftsReady: number;
}

export interface ChiefDigestEmailProps {
  firstName?: string;
  frequency?: "daily" | "weekly";
  periodLabel?: string;
  dashboardUrl?: string;
  logoUrl?: string;
  completedWork?: DigestCompletedWork[];
  actionItems?: DigestActionItem[];
  upcomingWork?: DigestScheduleItem[];
  workspaceRecords?: DigestWorkspaceRecords;
}

const emptyWorkspaceRecords: DigestWorkspaceRecords = {
  newProspects: 0,
  newTrends: 0,
  draftsReady: 0,
};

export function ChiefDigestEmail({
  firstName,
  frequency = "weekly",
  periodLabel = "This week",
  dashboardUrl = "https://heychief.sh",
  logoUrl,
  completedWork = [],
  actionItems = [],
  upcomingWork = [],
  workspaceRecords = emptyWorkspaceRecords,
}: ChiefDigestEmailProps) {
  const headingText = frequency === "daily" ? "Daily digest" : "Weekly digest";
  const intro = digestIntro({
    firstName,
    completedCount: completedWork.length,
    actionCount: actionItems.length,
    records: workspaceRecords,
  });

  return (
    <EmailShell
      footerNote={`You’re receiving your ${frequency} Chief digest. You can change or pause it in Schedule.`}
      logoUrl={logoUrl}
      preview={`Work completed: ${completedWork.length}. Actions needed: ${actionItems.length}.`}
    >
      <Text style={heading}>{headingText}</Text>
      <Text style={period}>{periodLabel}</Text>
      <Text style={introStyle}>{intro}</Text>

      {actionItems.length > 0 ? (
        <DigestSection title="Actions">
          {actionItems.map((item, index) => (
            <ActionRow
              item={item}
              key={item.id}
              showBorder={index < actionItems.length - 1}
            />
          ))}
        </DigestSection>
      ) : null}

      {completedWork.length > 0 ? (
        <DigestSection title="Completed work">
          {completedWork.map((work, index) => (
            <CompletedWorkRow
              key={work.id}
              showBorder={index < completedWork.length - 1}
              work={work}
            />
          ))}
        </DigestSection>
      ) : null}

      {upcomingWork.length > 0 ? (
        <DigestSection title="Up next">
          {upcomingWork.slice(0, 3).map((work, index) => (
            <ScheduleRow
              key={work.id}
              showBorder={index < Math.min(upcomingWork.length, 3) - 1}
              work={work}
            />
          ))}
        </DigestSection>
      ) : null}

      <Button href={dashboardUrl} style={primaryButton}>
        Open Chief
      </Button>
    </EmailShell>
  );
}

function digestIntro({
  actionCount,
  completedCount,
  firstName,
  records,
}: {
  actionCount: number;
  completedCount: number;
  firstName?: string;
  records: DigestWorkspaceRecords;
}) {
  const greeting = firstName ? `Hey ${firstName}.` : "Hey.";
  const saved = [
    records.newProspects > 0
      ? `${records.newProspects} new ${records.newProspects === 1 ? "prospect" : "prospects"}`
      : null,
    records.newTrends > 0
      ? `${records.newTrends} new ${records.newTrends === 1 ? "trend" : "trends"}`
      : null,
    records.draftsReady > 0
      ? `${records.draftsReady} ${records.draftsReady === 1 ? "draft" : "drafts"}`
      : null,
  ].filter((value): value is string => Boolean(value));
  const completed = `${completedCount} ${completedCount === 1 ? "piece" : "pieces"} of work`;
  const actions =
    actionCount === 1
      ? "One action needs you."
      : actionCount > 1
        ? `${actionCount} actions need you.`
        : "No actions needed.";
  const savedText = saved.length > 0 ? ` and saved ${sentenceList(saved)}` : "";
  return `${greeting} Your agents completed ${completed}${savedText}. ${actions}`;
}

function sentenceList(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function DigestSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <Section style={section}>
      <Text style={sectionHeading}>{title}</Text>
      <Section style={sectionList}>{children}</Section>
    </Section>
  );
}

function ActionRow({
  item,
  showBorder,
}: {
  item: DigestActionItem;
  showBorder: boolean;
}) {
  return (
    <Section style={{ ...listRow, borderBottom: showBorder ? border : 0 }}>
      <Row>
        <Column>
          <Text style={itemTitle}>{item.title}</Text>
          <Text style={itemDetail}>{item.reason}</Text>
          <Row style={itemFooter}>
            <Column>
              <Text style={agentName}>{item.agentName}</Text>
            </Column>
            <Column style={integrationStackColumn}>
              <IntegrationStack integrations={item.integrations} />
            </Column>
          </Row>
        </Column>
        {item.url ? (
          <Column style={actionColumn}>
            <Link href={item.url} style={textAction}>
              Review
            </Link>
          </Column>
        ) : null}
      </Row>
    </Section>
  );
}

function CompletedWorkRow({
  showBorder,
  work,
}: {
  showBorder: boolean;
  work: DigestCompletedWork;
}) {
  return (
    <Section style={{ ...listRow, borderBottom: showBorder ? border : 0 }}>
      <Row>
        <Column>
          <Text style={itemTitle}>{work.title}</Text>
          <Text style={itemDetail}>{work.summary}</Text>
          <Row style={itemFooter}>
            <Column>
              <Text style={agentName}>{work.agentName}</Text>
            </Column>
            <Column style={integrationStackColumn}>
              <IntegrationStack integrations={work.integrations} />
            </Column>
          </Row>
        </Column>
        {work.url ? (
          <Column style={actionColumn}>
            <Link href={work.url} style={textAction}>
              View work
            </Link>
          </Column>
        ) : null}
      </Row>
    </Section>
  );
}

function ScheduleRow({
  showBorder,
  work,
}: {
  showBorder: boolean;
  work: DigestScheduleItem;
}) {
  return (
    <Section style={{ ...listRow, borderBottom: showBorder ? border : 0 }}>
      <Row>
        <Column>
          <Text style={itemTitle}>{work.title}</Text>
          <Text style={scheduleDetail}>
            {work.nextAtLabel} · {work.timezone}
          </Text>
          <Row style={itemFooter}>
            <Column>
              <Text style={agentName}>{work.agentName}</Text>
            </Column>
            <Column style={integrationStackColumn}>
              <IntegrationStack integrations={work.integrations} />
            </Column>
          </Row>
        </Column>
        {work.url ? (
          <Column style={actionColumn}>
            <Link href={work.url} style={textAction}>
              Schedule
            </Link>
          </Column>
        ) : null}
      </Row>
    </Section>
  );
}

function IntegrationStack({
  integrations = [],
}: {
  integrations?: DigestIntegration[];
}) {
  if (integrations.length === 0) return null;
  const visible = integrations.slice(0, 5);
  const remaining = integrations.length - visible.length;
  return (
    <Section style={integrationStack}>
      {visible.map((integration, index) => (
        <Img
          alt={integration.name}
          height="22"
          key={integration.domain}
          src={`https://integrations.sh/logo/${integration.domain}`}
          style={{
            ...integrationLogo,
            marginLeft: index === 0 ? "0" : "-5px",
          }}
          width="22"
        />
      ))}
      {remaining > 0 ? <span style={integrationMore}>+{remaining}</span> : null}
    </Section>
  );
}

const border = "1px solid #292929";
const serifFamily =
  '"Newsreader Variable", "Newsreader", "Iowan Old Style", Georgia, serif';

const heading: CSSProperties = {
  color: "#f5f5f2",
  fontFamily: serifFamily,
  fontSize: "42px",
  fontWeight: "400",
  letterSpacing: "-0.04em",
  lineHeight: "44px",
  margin: 0,
};
const period: CSSProperties = {
  color: "#81817c",
  fontSize: "13px",
  lineHeight: "20px",
  margin: "9px 0 0",
};
const introStyle: CSSProperties = {
  color: "#b9b9b4",
  fontSize: "15px",
  lineHeight: "25px",
  margin: "27px 0 0",
};

const section: CSSProperties = { marginTop: "38px" };
const sectionHeading: CSSProperties = {
  color: "#f1f1ee",
  fontFamily: serifFamily,
  fontSize: "25px",
  fontWeight: "400",
  letterSpacing: "-0.025em",
  lineHeight: "30px",
  margin: "0 0 11px",
};
const sectionList: CSSProperties = {
  borderBottom: border,
  borderTop: border,
};
const listRow: CSSProperties = { padding: "19px 0" };
const itemTitle: CSSProperties = {
  color: "#f1f1ee",
  fontFamily: serifFamily,
  fontSize: "20px",
  fontWeight: "400",
  letterSpacing: "-0.018em",
  lineHeight: "25px",
  margin: 0,
};
const itemDetail: CSSProperties = {
  color: "#969691",
  fontSize: "12px",
  lineHeight: "19px",
  margin: "7px 0 0",
};
const scheduleDetail: CSSProperties = {
  ...itemDetail,
  color: "#b9b9b4",
};
const itemFooter: CSSProperties = { marginTop: "13px" };
const agentName: CSSProperties = {
  color: "#74746f",
  fontSize: "11px",
  lineHeight: "22px",
  margin: 0,
};
const integrationStackColumn: CSSProperties = {
  textAlign: "right",
  verticalAlign: "middle",
  width: "180px",
};
const integrationStack: CSSProperties = {
  lineHeight: 0,
  textAlign: "right",
  whiteSpace: "nowrap",
};
const integrationLogo: CSSProperties = {
  backgroundColor: "#f1f1ee",
  border: "1px solid #292929",
  borderRadius: "999px",
  display: "inline-block",
  verticalAlign: "middle",
};
const integrationMore: CSSProperties = {
  backgroundColor: "#171717",
  border: "1px solid #292929",
  borderRadius: "999px",
  color: "#858580",
  display: "inline-block",
  fontSize: "8px",
  height: "20px",
  lineHeight: "20px",
  marginLeft: "-5px",
  textAlign: "center",
  verticalAlign: "middle",
  width: "20px",
};
const actionColumn: CSSProperties = {
  paddingLeft: "20px",
  textAlign: "right",
  verticalAlign: "top",
  width: "72px",
};
const textAction: CSSProperties = {
  color: "#f1f1ee",
  fontSize: "11px",
  fontWeight: "600",
  textDecoration: "underline",
  textUnderlineOffset: "3px",
};
const primaryButton: CSSProperties = {
  backgroundColor: "#f1f1ee",
  color: "#111111",
  display: "inline-block",
  fontSize: "14px",
  fontWeight: "600",
  marginTop: "36px",
  padding: "13px 18px",
  textDecoration: "none",
};

const googleAnalytics = {
  name: "Google Analytics",
  domain: "analytics.googleapis.com",
};
const posthog = { name: "PostHog", domain: "posthog.com" };
const reddit = { name: "Reddit", domain: "reddit.com" };
const x = { name: "X", domain: "x.com" };
const linkedIn = { name: "LinkedIn", domain: "linkedin.com" };
const facebook = { name: "Facebook", domain: "facebook.com" };
const instagram = { name: "Instagram", domain: "instagram.com" };
const tiktok = { name: "TikTok", domain: "tiktok.com" };
const youtube = { name: "YouTube", domain: "youtube.com" };

export const digestPreviewProps = {
  firstName: "Alex",
  frequency: "weekly",
  periodLabel: "7–13 July 2026",
  logoUrl: PREVIEW_EMAIL_LOGO_URL,
  completedWork: [
    {
      id: "growth-report",
      agentName: "Analyst",
      title: "Weekly growth report",
      summary:
        "Compared the latest complete period with the previous one and saved the report with two charts.",
      integrations: [googleAnalytics, posthog],
    },
    {
      id: "buying-signals",
      agentName: "Prospector",
      title: "Find buying signals",
      summary:
        "Saved eight new prospects and three relevant trends to the workspace for review.",
      integrations: [reddit, x, linkedIn, facebook, instagram, tiktok],
    },
    {
      id: "founder-content",
      agentName: "Content Writer",
      title: "Founder content",
      summary:
        "Prepared three drafts from recent product work. Nothing was published.",
      integrations: [googleAnalytics, x, linkedIn, instagram, tiktok, youtube],
    },
  ],
  actionItems: [
    {
      id: "connect-google-analytics",
      agentName: "Setup",
      title: "Finish Google Analytics setup",
      reason:
        "Sign in once so Analyst can create read-only reports from the connected property.",
      integrations: [googleAnalytics],
    },
  ],
  upcomingWork: [
    {
      id: "next-buying-signals",
      agentName: "Prospector",
      title: "Find buying signals",
      nextAtLabel: "Tomorrow at 9:00 am",
      timezone: "Australia/Brisbane",
      integrations: [reddit, x, linkedIn, facebook, instagram, tiktok],
    },
    {
      id: "next-growth-report",
      agentName: "Analyst",
      title: "Weekly growth report",
      nextAtLabel: "Saturday at 1:10 pm",
      timezone: "Australia/Brisbane",
      integrations: [googleAnalytics, posthog],
    },
  ],
  workspaceRecords: {
    newProspects: 8,
    newTrends: 3,
    draftsReady: 3,
  },
} satisfies ChiefDigestEmailProps;

ChiefDigestEmail.PreviewProps = digestPreviewProps;

export default ChiefDigestEmail;
