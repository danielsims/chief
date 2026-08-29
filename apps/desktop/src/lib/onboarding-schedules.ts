import type { OnboardingSchedule } from "@chief/agent-runtime/types";
import type { JsonValue } from "@chief/relay-contracts";
import {
  isJsonBoolean,
  isJsonNumber,
  isJsonObject,
  isJsonString,
} from "@chief/relay-contracts";

import { onboardingScopedId } from "./onboarding-ids";
import { getPlaybook, playbookInstructions } from "./playbook-prompts";

export interface StarterScheduleItem {
  playbookId: string;
  title: string;
  agentId: string;
  purpose: string;
  enabled: boolean;
  frequency: "daily" | "weekly";
  day: number;
  time: string;
}

export interface StarterSchedulePlan {
  mode: "automatic" | "review" | "manual";
  timezone: string;
  plan: StarterScheduleItem[];
}

const weekDays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function cron(item: StarterScheduleItem) {
  const [hour = "09", minute = "00"] = item.time.split(":");
  return item.frequency === "daily"
    ? `${Number(minute)} ${Number(hour)} * * *`
    : `${Number(minute)} ${Number(hour)} * * ${item.day}`;
}

function toolPatterns(playbookId: string) {
  const sources = [
    "tools.search",
    "tools.chief.org.workspace.agentTools.sourcesList",
  ];
  if (playbookId === "growth-brief") {
    return [
      ...sources,
      "tools.google_analytics.org.main.*",
      "tools.chief-local.org.localworkspace.localTools.analyticsSaveDataset",
      "tools.chief.org.workspace.agentTools.uiPresentChart",
    ];
  }
  if (playbookId === "founder-content" || playbookId === "brand-content") {
    return [
      ...sources,
      "tools.chief-local.org.localworkspace.localTools.contentList",
      "tools.chief-local.org.localworkspace.localTools.contentSave",
    ];
  }
  return [
    ...sources,
    "tools.chief-local.org.localworkspace.localTools.prospectsList",
    "tools.chief-local.org.localworkspace.localTools.prospectsSave",
    "tools.chief-local.org.localworkspace.localTools.trendsList",
    "tools.chief-local.org.localworkspace.localTools.trendsSave",
  ];
}

function timeLabel(value: string) {
  const [hour = "0", minute = "0"] = value.split(":");
  return new Date(2000, 0, 1, Number(hour), Number(minute)).toLocaleTimeString(
    [],
    { hour: "numeric", minute: "2-digit" },
  );
}

export function buildOnboardingSchedules(
  automation: StarterSchedulePlan,
  workspaceId: string,
): OnboardingSchedule[] {
  if (automation.mode === "manual") return [];
  return automation.plan
    .filter((item) => item.enabled)
    .map((item) => {
      const playbook = getPlaybook(item.playbookId);
      return {
        id: onboardingScopedId(workspaceId, item.playbookId),
        playbookId: item.playbookId,
        agentId: item.agentId,
        title: item.title,
        instructions: [item.purpose, playbook && playbookInstructions(playbook)]
          .filter(Boolean)
          .join("\n\n"),
        cron: cron(item),
        timezone: automation.timezone,
        status:
          automation.mode === "automatic"
            ? ("active" as const)
            : ("draft" as const),
        approvalSummary: `${item.title} will run ${item.frequency === "daily" ? "every day" : `every ${weekDays[item.day]}`} at ${timeLabel(item.time)} (${automation.timezone}).`,
        proposedToolPatterns: toolPatterns(item.playbookId),
      };
    });
}

export function onboardingSchedulePlanFromMetadata(
  value: JsonValue,
): StarterSchedulePlan | null {
  if (!isJsonObject(value)) return null;
  const automation = value;
  if (
    automation.mode !== "automatic" &&
    automation.mode !== "review" &&
    automation.mode !== "manual"
  ) {
    return null;
  }
  if (!isJsonString(automation.timezone) || !automation.timezone) {
    return null;
  }
  if (!Array.isArray(automation.plan)) return null;
  const plan = automation.plan.flatMap((item) => {
    if (!isJsonObject(item)) return [];
    const candidate = item;
    const frequency =
      candidate.frequency === "weekdays" ? "daily" : candidate.frequency;
    if (
      !isJsonString(candidate.playbookId) ||
      !isJsonString(candidate.title) ||
      !isJsonString(candidate.agentId) ||
      !isJsonString(candidate.purpose) ||
      !isJsonBoolean(candidate.enabled) ||
      (frequency !== "daily" && frequency !== "weekly") ||
      !isJsonNumber(candidate.day) ||
      !isJsonString(candidate.time)
    ) {
      return [];
    }
    return [
      {
        playbookId: candidate.playbookId,
        title: candidate.title,
        agentId: candidate.agentId,
        purpose: candidate.purpose,
        enabled: candidate.enabled,
        frequency,
        day: candidate.day,
        time: candidate.time,
      } satisfies StarterScheduleItem,
    ];
  });
  return { mode: automation.mode, timezone: automation.timezone, plan };
}
