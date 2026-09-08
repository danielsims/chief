import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { RecurringWorkRecord } from "../../../types.js";
import { nextRunAt, validateCron } from "../../../recurring-work.js";
import { readWorkspaceContext } from "../../../workspace-context.js";
import { time } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { proposeRecurringWorkDefinition } from "./recurring-work-definitions.js";

const automaticScheduleScopeSchema = z.array(
  z.object({
    playbookId: z.string().optional(),
    agentId: z.string().optional(),
    cron: z.string().optional(),
    timezone: z.string().optional(),
  }),
);

function automaticScheduleScope(workspaceContext: string | undefined) {
  const encoded = workspaceContext?.match(
    /^Automatic schedule scope:\s*(.+)$/imu,
  )?.[1];
  if (!encoded) return [];
  try {
    const parsed: unknown = JSON.parse(encoded);
    const result = automaticScheduleScopeSchema.safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

function schedulingAuthority(workspaceContext: string | undefined) {
  return workspaceContext?.match(
    /^Agent scheduling authority:\s*(automatic|review|manual)$/imu,
  )?.[1];
}

export const proposeRecurringWorkTool = defineLocalTool({
  ...proposeRecurringWorkDefinition,
  async execute({ context, input, manager, workspaceId }) {
    const now = Date.now();
    const id = input.id ?? randomUUID();
    const existing = await manager.recurringWorkById(workspaceId, id);
    const onceAt =
      input.onceAt === undefined
        ? existing?.onceAt
        : time(input.onceAt, Number.NaN);
    if (onceAt !== undefined && !Number.isFinite(onceAt)) {
      throw new Error("onceAt must be a valid timestamp.");
    }
    validateCron(input.cron, input.timezone);
    const workspaceContext = readWorkspaceContext(workspaceId);
    if (
      input.activate &&
      schedulingAuthority(workspaceContext) !== "automatic"
    ) {
      throw new Error(
        "This workspace requires schedule review. Create a draft without activate.",
      );
    }
    if (input.activate) {
      const approved = automaticScheduleScope(workspaceContext).find(
        (item) =>
          item.playbookId === input.playbookId &&
          item.agentId === input.agentId &&
          item.cron === input.cron &&
          item.timezone === input.timezone,
      );
      if (!approved) {
        throw new Error(
          "This schedule is outside the scope approved during onboarding.",
        );
      }
    }
    const conversationId =
      input.conversationId ??
      context.conversationId ??
      existing?.conversationId;
    if (!conversationId) {
      throw new Error(
        "conversationId from the current runtime context is required.",
      );
    }
    const work: RecurringWorkRecord = {
      id,
      conversationId,
      agentId: input.agentId,
      title: input.title,
      instructions: input.instructions,
      cron: input.cron,
      timezone: input.timezone,
      onceAt,
      status: input.activate ? "active" : "draft",
      placement: "local",
      approvalSummary: input.approvalSummary,
      proposedToolPatterns: input.proposedToolPatterns,
      grant: input.activate
        ? {
            version: 1,
            approvedAt: now,
            toolPatterns: input.proposedToolPatterns,
          }
        : undefined,
      nextAt: input.activate
        ? onceAt !== undefined && onceAt <= now
          ? now
          : (onceAt ?? nextRunAt(input.cron, input.timezone))
        : undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await manager.saveRecurringWork(workspaceId, work);
    if (!input.activate) {
      await manager.raiseActionItem(workspaceId, {
        id: `action-${work.id}-approval`,
        agentId: work.agentId,
        title: `Approve: ${work.title}`,
        reason: work.approvalSummary,
        sourceId: `automation-${work.id}`,
        status: "open",
        createdAt: Date.now(),
      });
    }
    return jsonResponse({
      recurringWork: work,
      requiresUserApproval: !input.activate,
      activated: input.activate,
    });
  },
});
