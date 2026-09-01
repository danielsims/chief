import { z } from "zod";

import type { JsonObject, WorkspaceSnapshot } from "@chief/relay-contracts";
import {
  parseJsonObject,
  projectProviderIdSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

export const defaultWorkspaceAgents = [
  {
    id: "chief",
    name: "Chief",
    role: "Chief of staff",
    status: "working",
    runtime: { kind: "native-cell" },
  },
  {
    id: "brand",
    name: "Marketer",
    role: "Marketing",
    status: "idle",
    runtime: { kind: "native-cell" },
  },
  {
    id: "content",
    name: "Content",
    role: "Content and creative",
    status: "idle",
    runtime: { kind: "native-cell" },
  },
  {
    id: "analyst",
    name: "Analyst",
    role: "Measurement and reporting",
    status: "idle",
    runtime: { kind: "native-cell" },
  },
  {
    id: "ads",
    name: "Advertising",
    role: "Paid acquisition",
    status: "idle",
    runtime: { kind: "native-cell" },
  },
  {
    id: "prospector",
    name: "Prospector",
    role: "Research and outreach",
    status: "idle",
    runtime: { kind: "native-cell" },
  },
  {
    id: "engineer",
    name: "Engineer",
    role: "Product engineering",
    status: "idle",
    runtime: { kind: "native-cell" },
  },
  {
    id: "setup",
    name: "Setup",
    role: "Connections and integrations",
    status: "idle",
    runtime: { kind: "native-cell" },
  },
] as const satisfies WorkspaceSnapshot["agents"];

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
