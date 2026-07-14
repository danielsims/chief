import type {
  OnboardingSchedule,
  OnboardingWorkJob,
} from "@chief/agent-runtime/types";
import { getPlaybook, playbookInstructions } from "./playbooks";

export interface StarterScheduleItem {
  playbookId: string;
  title: string;
  agentId: string;
  purpose: string;
  enabled: boolean;
  frequency: "weekdays" | "weekly";
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
  return item.frequency === "weekdays"
    ? `${Number(minute)} ${Number(hour)} * * 1-5`
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
      "tools.chief-local.org.localworkspace.localTools.googleAnalyticsRunReport",
      "tools.chief.org.workspace.agentTools.uiPresentChart",
    ];
  }
  if (playbookId === "founder-content") {
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
): OnboardingSchedule[] {
  if (automation.mode === "manual") return [];
  return automation.plan
    .filter((item) => item.enabled)
    .map((item) => {
      const playbook = getPlaybook(item.playbookId);
      return {
        id: `onboarding-${item.playbookId}`,
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
        approvalSummary: `${item.title} will run ${item.frequency === "weekdays" ? "every weekday" : `every ${weekDays[item.day]}`} at ${timeLabel(item.time)} (${automation.timezone}).`,
        proposedToolPatterns: toolPatterns(item.playbookId),
      };
    });
}

export function buildScheduleProvisioningJob(
  automation: StarterSchedulePlan,
): OnboardingWorkJob | null {
  if (automation.mode !== "automatic") return null;
  const schedules = buildOnboardingSchedules(automation);
  if (schedules.length === 0) return null;
  const scheduleInstructions = schedules
    .map((schedule) =>
      [
        `## ${schedule.title}`,
        `Schedule id: ${schedule.id}`,
        `Playbook id: ${schedule.playbookId}`,
        `Owner: ${schedule.agentId}`,
        `Schedule: ${schedule.cron} in ${schedule.timezone}`,
        schedule.instructions,
      ].join("\n\n"),
    )
    .join("\n\n");
  return {
    id: "onboarding-starter-automations",
    agentId: "cmo",
    title: "Prepare starter schedules",
    runAt: Date.now() + 60_000,
    timezone: automation.timezone,
    proposedToolPatterns: [
      "tools.search",
      "tools.chief-local.org.localworkspace.localTools.recurringWorkPropose",
    ],
    instructions: [
      "Finish preparing the recurring schedules the user activated during onboarding.",
      "The selected schedules already exist in Schedule. Check them first, then update each one using its exact Schedule id below instead of creating another record. Call recurringWorkPropose with activate: true, the matching playbookId, every existing schedule field, and only the narrow read and save tool paths that run needs. Preserve its cadence, timezone, owner, and instructions.",
      "Scheduling authority does not approve publishing, outreach, spend changes, or other external mutations.",
      scheduleInstructions,
    ].join("\n\n"),
  };
}

export function onboardingSchedulePlanFromMetadata(
  value: unknown,
): StarterSchedulePlan | null {
  if (!value || typeof value !== "object") return null;
  const automation = value as Partial<StarterSchedulePlan>;
  if (
    automation.mode !== "automatic" &&
    automation.mode !== "review" &&
    automation.mode !== "manual"
  ) {
    return null;
  }
  if (typeof automation.timezone !== "string" || !automation.timezone) {
    return null;
  }
  if (!Array.isArray(automation.plan)) return null;
  const plan = automation.plan.filter((item): item is StarterScheduleItem => {
    return Boolean(
      item &&
      typeof item.playbookId === "string" &&
      typeof item.title === "string" &&
      typeof item.agentId === "string" &&
      typeof item.purpose === "string" &&
      typeof item.enabled === "boolean" &&
      (item.frequency === "weekdays" || item.frequency === "weekly") &&
      typeof item.day === "number" &&
      typeof item.time === "string",
    );
  });
  return { mode: automation.mode, timezone: automation.timezone, plan };
}
