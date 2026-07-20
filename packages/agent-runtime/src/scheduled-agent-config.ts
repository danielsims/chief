import type { SessionManager } from "./manager.js";
import type {
  AgentDefinition,
  AgentPreference,
  RecurringWorkRecord,
  RuntimeNotice,
} from "./types.js";
import { getAgent } from "./agents.js";
import { DEPLOYMENT_REQUIRED_MESSAGE } from "./deployment-failure.js";
import { nextRunAt } from "./recurring-work.js";
import { workspaceKey } from "./workspace-secrets.js";

const MISSING_DRIVER_SUMMARY = "CHIEF_AGENT_APP_REQUIRED";

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
    nextAt: undefined,
    lastSummary: `${MISSING_DRIVER_SUMMARY}: ${reason}`,
    updatedAt: now,
  });
  await manager.raiseActionItem(workspaceId, {
    id: `action-${work.id}-agent-app`,
    agentId: "cmo",
    title: `Configure ${agentName}`,
    reason,
    sourceId: "agent-cmo",
    status: "open",
    createdAt: now,
  });
  notice(workspaceId, {
    kind: "action",
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
      (work.lastSummary?.startsWith(MISSING_DRIVER_SUMMARY) === true ||
        work.lastSummary === DEPLOYMENT_REQUIRED_MESSAGE),
  );
  const now = Date.now();
  for (const work of blocked) {
    await manager.saveRecurringWork(workspaceId, {
      ...work,
      status: "active",
      nextAt: work.onceAt ?? nextRunAt(work.cron, work.timezone, now),
      lastSummary: undefined,
      updatedAt: now,
    });
    await manager.dismissActionItem(workspaceId, `action-${work.id}-agent-app`);
  }
  if (blocked.length > 0) {
    await manager.dismissActionItem(
      workspaceId,
      `action-chief-deployment-required-${workspaceKey(workspaceId)}`,
    );
  }
  return blocked.length;
}
