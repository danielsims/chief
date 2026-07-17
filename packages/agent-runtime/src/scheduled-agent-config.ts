import type { SessionManager } from "./manager.js";
import type {
  AgentDefinition,
  AgentPreference,
  RecurringWorkRecord,
  RuntimeNotice,
} from "./types.js";
import { getAgent } from "./agents.js";
import { nextRunAt } from "./recurring-work.js";

const MISSING_DRIVER_RESULT = "CHIEF_AGENT_APP_REQUIRED";

export interface ScheduledAgentConfig {
  agent: AgentDefinition;
  preference: AgentPreference & {
    driver: NonNullable<AgentPreference["driver"]>;
  };
}

export async function scheduledAgentConfig(
  manager: SessionManager,
  workspaceId: string,
  _work: RecurringWorkRecord,
): Promise<ScheduledAgentConfig | null> {
  const agent = getAgent("cmo");
  if (!agent) throw new Error("CMO persona is missing.");

  const preference = await manager.agentPreference(workspaceId, "cmo");
  if (preference?.enabled === false) {
    throw new Error(`${agent.name} is disabled.`);
  }
  if (!preference?.driver) return null;

  return { agent, preference: { ...preference, driver: preference.driver } };
}

export async function deferForAgentConfiguration(
  manager: SessionManager,
  workspaceId: string,
  work: RecurringWorkRecord,
  notice: (workspaceId: string, notice: RuntimeNotice) => void,
  onChange: (workspaceId: string) => void | Promise<void>,
) {
  const agentName = "CMO";
  const reason = `Choose an agent app for ${agentName} before this work can run.`;
  const now = Date.now();

  await manager.saveRecurringWork(workspaceId, {
    ...work,
    status: "needs_approval",
    nextRunAt: undefined,
    lastResult: `${MISSING_DRIVER_RESULT}: ${reason}`,
    updatedAt: now,
  });
  await manager.raiseAttentionItem(workspaceId, {
    id: `attention-${work.id}-agent-app`,
    agentId: "cmo",
    title: `Configure ${agentName}`,
    reason,
    sourceId: "agent-cmo",
    status: "open",
    createdAt: now,
  });
  notice(workspaceId, {
    kind: "setup-required",
    title: `Configure ${agentName}`,
    detail: reason,
    sourceId: "agent-cmo",
    agentId: "cmo",
    recurringWorkId: work.id,
  });
  await Promise.resolve(onChange(workspaceId));
}

export async function resumeDriverBlockedWork(
  manager: SessionManager,
  workspaceId: string,
  agentId: string,
) {
  const data = await manager.workspaceData(workspaceId);
  const blocked = data.recurringWork.filter(
    (work) =>
      agentId === "cmo" &&
      work.status === "needs_approval" &&
      work.lastResult?.startsWith(MISSING_DRIVER_RESULT),
  );
  const now = Date.now();
  for (const work of blocked) {
    await manager.saveRecurringWork(workspaceId, {
      ...work,
      status: "active",
      nextRunAt:
        work.runOnceAt === undefined
          ? Math.min(nextRunAt(work.cron, work.timezone, now), now + 1_000)
          : now,
      lastResult: undefined,
      updatedAt: now,
    });
    await manager.dismissAttentionItem(
      workspaceId,
      `attention-${work.id}-agent-app`,
    );
  }
  return blocked.length;
}
