import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { AgentDeploymentRecord } from "./types.js";
import { workspaceKey, workspaceRoot } from "./workspace-secrets.js";

function recordPath(workspaceId: string, agentId: string) {
  return join(
    workspaceRoot(workspaceId),
    "deployments",
    `${workspaceKey(agentId)}.json`,
  );
}

export function readAgentDeploymentRecord(
  workspaceId: string,
  agentId: string,
): AgentDeploymentRecord | undefined {
  try {
    const currentPath = recordPath(workspaceId, agentId);
    const legacyPath = join(workspaceRoot(workspaceId), "deployment.json");
    const value = JSON.parse(
      readFileSync(
        existsSync(currentPath) || agentId !== "cmo" ? currentPath : legacyPath,
        "utf8",
      ),
    ) as Omit<AgentDeploymentRecord, "agentId"> & { agentId?: string };
    const persistedAgentId = value.agentId ?? "cmo";
    return value.workspaceId === workspaceId &&
      value.status === "ready" &&
      persistedAgentId === agentId
      ? { ...value, agentId: persistedAgentId }
      : undefined;
  } catch {
    return undefined;
  }
}

export function persistAgentDeploymentRecord(record: AgentDeploymentRecord) {
  if (record.status !== "ready") return;
  const path = recordPath(record.workspaceId, record.agentId);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
}
