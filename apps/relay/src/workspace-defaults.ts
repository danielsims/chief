import { z } from "zod";

import type { JsonObject, WorkspaceSnapshot } from "@chief/relay-contracts";
import {
  parseJsonObject,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

export const defaultWorkspaceAgents = [
  {
    id: "chief",
    name: "Chief",
    role: "Chief of staff",
    status: "working",
  },
  {
    id: "brand",
    name: "Marketer",
    role: "Marketing",
    status: "idle",
  },
  {
    id: "content",
    name: "Content",
    role: "Content and creative",
    status: "idle",
  },
  {
    id: "analyst",
    name: "Analyst",
    role: "Measurement and reporting",
    status: "idle",
  },
  {
    id: "ads",
    name: "Advertising",
    role: "Paid acquisition",
    status: "idle",
  },
  {
    id: "prospector",
    name: "Prospector",
    role: "Research and outreach",
    status: "idle",
  },
  {
    id: "engineer",
    name: "Engineer",
    role: "Product engineering",
    status: "idle",
  },
  {
    id: "setup",
    name: "Setup",
    role: "Connections and integrations",
    status: "idle",
  },
] as const satisfies WorkspaceSnapshot["agents"];

/** Normalizes a stored workspace snapshot so older or drifted data can never
 * brick the workspace. The only lenient field today is `runtime`: a stale
 * value outside the current enum falls back to the schema's own nullable
 * default instead of throwing. We log the offending value so the drift is
 * root-caused, then repair it persistently at the next write. */
export function decodeWorkspaceSnapshot(json: string): WorkspaceSnapshot {
  // The stored JSON is trusted to be a JSON object (it was written by the
  // schema); this boundary parser either yields one or leaves no path to
  // repair, in which case the original schema error is the honest failure.
  const raw = parseJsonObject(JSON.parse(json));
  if (!raw) throw new Error("Stored workspace snapshot is not a JSON object.");
  const parsed = workspaceSnapshotSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const staleRuntime = workspaceSnapshotRuntimeSafeParse(raw);
  if (staleRuntime) {
    console.warn("[workspace-snapshot] lenient runtime decode", {
      runtime: staleRuntime,
    });
    return workspaceSnapshotSchema.parse({ ...raw, runtime: null });
  }
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

export function reconcileWorkspaceAgents(snapshot: WorkspaceSnapshot): {
  snapshot: WorkspaceSnapshot;
  changed: boolean;
} {
  const existing = new Map(snapshot.agents.map((agent) => [agent.id, agent]));
  const missing = defaultWorkspaceAgents.filter(
    (agent) => !existing.has(agent.id),
  );
  const missionControlWasPrivate = snapshot.conversations.some(
    (conversation) =>
      conversation.id === "mission-control" && conversation.isPrivate,
  );
  if (missing.length === 0 && !missionControlWasPrivate) {
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
      agents: [
        ...defaultWorkspaceAgents.map(
          (agent) => existing.get(agent.id) ?? agent,
        ),
        ...snapshot.agents.filter(
          (agent) =>
            !defaultWorkspaceAgents.some(
              (required) => required.id === agent.id,
            ),
        ),
      ],
    },
    changed: true,
  };
}
