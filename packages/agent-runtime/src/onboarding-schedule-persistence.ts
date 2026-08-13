import type { SessionManager } from "./manager.js";
import type { DriverType, OnboardingSchedule } from "./types.js";
import { nextRunAt, validateCron } from "./recurring-work.js";
import {
  preferredScheduledChannel,
  scheduledChannelConversationId,
} from "./scheduled-work-channel.js";

export interface OnboardingSchedulePersistenceResult {
  failed: number;
  saved: number;
}

/**
 * Persists onboarding schedules after their channel conversations exist.
 * Failures stay isolated so optional calendar setup can never halt onboarding.
 */
export async function persistOnboardingSchedules(input: {
  manager: SessionManager;
  workspaceId: string;
  schedules: readonly OnboardingSchedule[];
  missionChannelId: string;
  fallbackConversationId: string;
  driver: DriverType;
  model?: string;
  now: number;
}): Promise<OnboardingSchedulePersistenceResult> {
  let channels;
  try {
    channels = await input.manager.store.channelStore().list(input.workspaceId);
  } catch (error) {
    console.error("[chief] onboarding schedule channels unavailable:", error);
    return { failed: input.schedules.length, saved: 0 };
  }

  const outcomes = await Promise.allSettled(
    input.schedules.map(async (schedule) => {
      if (!/^[a-z0-9][a-z0-9_-]{2,96}$/i.test(schedule.id)) {
        throw new Error("Invalid onboarding schedule id.");
      }
      validateCron(schedule.cron, schedule.timezone);
      const existing = await input.manager.recurringWorkById(
        input.workspaceId,
        schedule.id,
      );
      const scheduleChannel = preferredScheduledChannel(
        channels,
        {
          id: schedule.id,
          agentId: schedule.agentId,
          conversationId:
            existing?.conversationId ?? input.fallbackConversationId,
        },
        input.missionChannelId,
      );
      const conversationId = scheduleChannel
        ? scheduledChannelConversationId(input.workspaceId, scheduleChannel)
        : input.fallbackConversationId;

      if (scheduleChannel) {
        await input.manager.createRootChat(
          input.workspaceId,
          conversationId,
          `#${scheduleChannel.name}`,
          input.driver,
          input.model,
        );
      }

      const toolPatterns = Array.from(
        new Set(
          schedule.proposedToolPatterns
            .filter((pattern) => pattern.startsWith("tools."))
            .slice(0, 24),
        ),
      );
      await input.manager.saveRecurringWork(input.workspaceId, {
        id: schedule.id,
        conversationId,
        agentId: schedule.agentId,
        title: schedule.title.trim().slice(0, 160),
        instructions: schedule.instructions.trim().slice(0, 40_000),
        cron: schedule.cron,
        timezone: schedule.timezone,
        status: schedule.status,
        placement: "local",
        approvalSummary: schedule.approvalSummary.trim().slice(0, 2_000),
        proposedToolPatterns: toolPatterns,
        grant:
          schedule.status === "active"
            ? { version: 1, approvedAt: input.now, toolPatterns }
            : undefined,
        nextAt:
          schedule.status === "active"
            ? nextRunAt(schedule.cron, schedule.timezone)
            : undefined,
        lastCompletedAt: existing?.lastCompletedAt,
        lastSummary: existing?.lastSummary,
        createdAt: existing?.createdAt ?? input.now,
        updatedAt: input.now,
      });
    }),
  );

  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      console.error("[chief] onboarding schedule was skipped:", outcome.reason);
    }
  }
  const saved = outcomes.filter(
    (outcome) => outcome.status === "fulfilled",
  ).length;
  return { failed: outcomes.length - saved, saved };
}
