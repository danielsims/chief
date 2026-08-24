import type { SessionManager } from "./manager.js";
import type { AgentEvent, SessionArtifact } from "./types.js";

export function lastAssistantText(events: readonly AgentEvent[]) {
  return events
    .flatMap((event) =>
      event.type === "message" && event.role === "assistant"
        ? event.content.flatMap((block) =>
            block.type === "text" ? [block.text] : [],
          )
        : [],
    )
    .at(-1)
    ?.slice(0, 20_000);
}

export function reportedRequiredDataFailure(
  summary: string | undefined,
  analyticsRequired: boolean,
) {
  if (!summary) return null;
  const marker = /(?:CHIEF|MARKETER)_(?:WORK|RUN)_FAILED\s*:?[ \t]*(.+)?/i.exec(
    summary,
  );
  if (marker) {
    const cause = marker[1]?.trim();
    return cause?.length ? cause : "The required source could not be read.";
  }
  if (/tool_not_found/i.test(summary)) {
    return "The required connector was not available to this work.";
  }
  if (
    analyticsRequired &&
    /live analytics report unavailable|analytics (?:data|report) (?:is |was )?(?:not available|unavailable)|analytics (?:has|have) not (?:yet )?populated|no reliable .*data .*available/i.test(
      summary,
    )
  ) {
    return "Google Analytics could not be read for this work.";
  }
  return null;
}

export function blockedWorkSummary(blockedTools: readonly string[]) {
  if (
    blockedTools.some((tool) =>
      tool.startsWith("tools.google_analytics.org.main."),
    )
  ) {
    return "Live analytics was not read. The Analyst selected the cached workspace report path instead of this task's approved live Google Analytics path. No Google permission was removed and nothing was changed. Reconnect Google Analytics if prompted, then try the report again.";
  }
  const count = blockedTools.length;
  if (count === 0) {
    return "The connector stopped before the approved tool could be used. Nothing was changed. Try the task again; if it stops again, reconnect the integration.";
  }
  return count === 1
    ? "The work stopped before using one tool outside its approved scope. Nothing was changed. Review that tool, then try again."
    : `The work stopped before using ${count} tools outside its approved scope. Nothing was changed. Review those tools, then try again.`;
}

export function safeWorkFailure(error: Error) {
  const message = error.message;
  if (/Failed query:|insert into|update .+ set|SQLITE_/i.test(message)) {
    return "Chief could not save this work cleanly. Nothing external was changed.";
  }
  return message.slice(0, 1_000);
}

export type ArtifactWorkspaceData = Awaited<
  ReturnType<SessionManager["workspaceData"]>
>;

function newIds<T extends { id: string }>(before: T[], after: T[]) {
  const existing = new Set(before.map((item) => item.id));
  return after.filter((item) => !existing.has(item.id));
}

function changedIds<T extends { id: string; updatedAt: number }>(
  before: T[],
  after: T[],
) {
  const existing = new Map(before.map((item) => [item.id, item.updatedAt]));
  return after.filter((item) => existing.get(item.id) !== item.updatedAt);
}

export function artifactsFromSession(
  events: readonly AgentEvent[],
  before: ArtifactWorkspaceData,
  after: ArtifactWorkspaceData,
): SessionArtifact[] {
  const artifacts: SessionArtifact[] = [];
  const partIds = new Set<string>();
  for (const event of events) {
    if (event.type !== "message") continue;
    for (const block of event.content) {
      if (block.type !== "data-chart" && block.type !== "data-document") {
        continue;
      }
      const id =
        block.id ??
        `${block.type === "data-chart" ? "chart" : "document"}-${artifacts.length + 1}`;
      if (partIds.has(id)) continue;
      partIds.add(id);
      artifacts.push(block);
    }
  }

  const prospects = newIds(before.prospects, after.prospects).slice(0, 25);
  if (prospects.length > 0) {
    artifacts.push({
      type: "data-table",
      id: "prospects",
      data: {
        title: "Prospects found",
        columns: [
          { key: "name", label: "Name" },
          { key: "company", label: "Company" },
          { key: "relevance", label: "Relevance" },
          { key: "source", label: "Source" },
        ],
        rows: prospects.map((item) => ({
          name: item.name,
          company: item.company ?? "",
          relevance: item.relevance,
          source: item.source,
        })),
      },
    });
  }

  const trends = newIds(before.trends, after.trends).slice(0, 25);
  if (trends.length > 0) {
    artifacts.push({
      type: "data-table",
      id: "trends",
      data: {
        title: "Signals found",
        columns: [
          { key: "title", label: "Signal" },
          { key: "source", label: "Source" },
          { key: "strength", label: "Strength" },
        ],
        rows: trends.map((item) => ({
          title: item.title,
          source: item.source,
          strength: item.signal,
        })),
      },
    });
  }

  const drafts = changedIds(before.drafts, after.drafts).slice(0, 25);
  if (drafts.length > 0) {
    artifacts.push({
      type: "data-table",
      id: "content",
      data: {
        title: "Content prepared",
        columns: [
          { key: "title", label: "Draft" },
          { key: "platform", label: "Channel" },
          { key: "status", label: "Status" },
        ],
        rows: drafts.map((item) => ({
          title: item.title,
          platform: item.platform,
          status: item.status,
        })),
      },
    });
  }

  const campaigns = changedIds(before.campaigns, after.campaigns).slice(0, 25);
  if (campaigns.length > 0) {
    artifacts.push({
      type: "data-table",
      id: "campaigns",
      data: {
        title: "Campaigns",
        columns: [
          { key: "name", label: "Campaign" },
          { key: "provider", label: "Provider" },
          { key: "status", label: "Status" },
          { key: "budget", label: "Budget" },
        ],
        rows: campaigns.map((item) => ({
          name: item.name,
          provider: item.provider,
          status: item.status,
          budget: item.budget ?? "",
        })),
      },
    });
  }

  return artifacts;
}
