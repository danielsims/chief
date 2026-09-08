import { z } from "zod";

import type { JsonObject, WorkspaceSnapshot } from "@chief/relay-contracts";
import { authoredAgentDefinitions } from "@chief/agent-runtime/agent-definitions";
import {
  parseJsonObject,
  projectProviderIdSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

const authoredById = new Map(
  authoredAgentDefinitions.map((agent) => [agent.id, agent]),
);
const chief = authoredById.get("chief");
if (!chief) throw new Error("Chief's authored agent definition is missing.");

export const defaultWorkspaceAgents = [
  {
    id: chief.id,
    name: chief.name,
    role: chief.role,
    description: chief.description,
    instructions: chief.instructions,
    capabilities: chief.capabilities ?? [],
    status: "working",
    runtime: { kind: "native-cell" },
    subagents: (chief.delegates ?? []).flatMap((agentId) => {
      const subagent = authoredById.get(agentId);
      return subagent
        ? [
            {
              id: subagent.id,
              name: subagent.name,
              role: subagent.role,
              description: subagent.description,
              instructions: subagent.instructions,
              capabilities: subagent.capabilities ?? [],
            },
          ]
        : [];
    }),
  },
] as const satisfies WorkspaceSnapshot["agents"];

export const defaultWorkspaceAgentProfiles = defaultWorkspaceAgents.flatMap(
  (agent) => [agent, ...agent.subagents],
);

export function workspaceAgentProfiles(snapshot: WorkspaceSnapshot) {
  return snapshot.agents.flatMap((agent) => [agent, ...agent.subagents]);
}

/** Normalizes known stored-data drift before applying the strict wire schema. */
export function decodeWorkspaceSnapshot(json: string): WorkspaceSnapshot {
  // The stored JSON is trusted to be a JSON object (it was written by the
  // schema); this boundary parser either yields one or leaves no path to
  // repair, in which case the original schema error is the honest failure.
  const raw = parseJsonObject(JSON.parse(json));
  if (!raw) throw new Error("Stored workspace snapshot is not a JSON object.");
  const parsed = workspaceSnapshotSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  let repaired = raw;
  let changed = false;
  const staleRuntime = workspaceSnapshotRuntimeSafeParse(raw);
  if (staleRuntime) {
    console.warn("[workspace-snapshot] lenient runtime decode", {
      runtime: staleRuntime,
    });
    repaired = { ...repaired, runtime: null };
    changed = true;
  }
  const staleProviders = workspaceSnapshotProjectProviders(raw);
  if (staleProviders) {
    console.warn("[workspace-snapshot] lenient project provider decode", {
      providerIds: staleProviders.providerIds,
    });
    repaired = { ...repaired, projects: staleProviders.projects };
    changed = true;
  }
  if (changed) return workspaceSnapshotSchema.parse(repaired);
  throw parsed.error;
}

/** Returns the stored runtime value when it is a string outside the enum. */
function workspaceSnapshotRuntimeSafeParse(raw: JsonObject) {
  const knownRuntime = z
    .enum(["phone", "desktop", "cloud"])
    .safeParse(raw.runtime);
  if (knownRuntime.success) return undefined;
  // Only a string that the enum rejects is repairable; anything else (a number
  // or missing key) is not a runtime-drift case.
  const candidate = z.string().safeParse(raw.runtime);
  return candidate.success ? candidate.data : undefined;
}

function workspaceSnapshotProjectProviders(raw: JsonObject) {
  if (!Array.isArray(raw.projects)) return undefined;
  const providerIds: string[] = [];
  const projects = raw.projects.map((value) => {
    const project = parseJsonObject(value);
    if (!project) return value;
    const candidate = z
      .string()
      .trim()
      .min(1)
      .max(128)
      .safeParse(project.providerId);
    if (
      !candidate.success ||
      projectProviderIdSchema.safeParse(candidate.data).success
    ) {
      return project;
    }
    providerIds.push(candidate.data);
    return { ...project, providerId: "generic-git" };
  });
  return providerIds.length > 0 ? { projects, providerIds } : undefined;
}

export function reconcileWorkspaceAgents(snapshot: WorkspaceSnapshot): {
  snapshot: WorkspaceSnapshot;
  changed: boolean;
} {
  const missionControlWasPrivate = snapshot.conversations.some(
    (conversation) =>
      conversation.id === "mission-control" && conversation.isPrivate,
  );
  if (!missionControlWasPrivate) {
    return { snapshot, changed: false };
  }
  return {
    snapshot: {
      ...snapshot,
      conversations: snapshot.conversations.map((conversation) =>
        conversation.id === "mission-control"
          ? { ...conversation, isPrivate: false }
          : conversation,
      ),
    },
    changed: true,
  };
}
