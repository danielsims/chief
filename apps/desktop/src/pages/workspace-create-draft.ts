import {
  isJsonNumber,
  isJsonObject,
  isJsonString,
} from "@chief/relay-contracts";

export type WorkspaceInferenceProvider =
  "claude" | "codex" | "opencode" | "remote" | null;

const createDraftVersion = 2;

export interface CreateWorkspaceDraft {
  version: typeof createDraftVersion;
  step: number;
  name: string;
  website: string;
  runtime: "cloud" | "desktop";
  provider: WorkspaceInferenceProvider;
  model: string;
  selectedApps: string[];
}

export function createWorkspaceDraftKey(relayUrl: string, userId?: string) {
  return `chief.create-workspace-draft.v1:${new URL(relayUrl).origin}:${userId ?? "signed-in"}`;
}

export function readCreateWorkspaceDraft(
  key: string,
): CreateWorkspaceDraft | null {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(key) ?? "null",
    );
    if (!isJsonObject(value)) return null;
    const step = value.step;
    if (
      value.version !== createDraftVersion ||
      !isJsonNumber(step) ||
      !Number.isInteger(step) ||
      step < 0 ||
      step > 3 ||
      !isJsonString(value.name) ||
      !isJsonString(value.website) ||
      (value.runtime !== "cloud" && value.runtime !== "desktop") ||
      !isJsonString(value.model) ||
      !Array.isArray(value.selectedApps) ||
      !value.selectedApps.every((app) => isJsonString(app)) ||
      (value.provider !== undefined &&
        value.provider !== null &&
        value.provider !== "claude" &&
        value.provider !== "codex" &&
        value.provider !== "opencode" &&
        value.provider !== "remote")
    ) {
      return null;
    }
    return {
      version: createDraftVersion,
      step,
      name: value.name,
      website: value.website,
      runtime: value.runtime,
      provider:
        value.provider === "claude" ||
        value.provider === "codex" ||
        value.provider === "opencode" ||
        value.provider === "remote"
          ? value.provider
          : null,
      model: value.model,
      selectedApps: value.selectedApps,
    };
  } catch {
    return null;
  }
}

export function workspaceDraft(
  draft: Omit<CreateWorkspaceDraft, "version">,
): CreateWorkspaceDraft {
  return { version: createDraftVersion, ...draft };
}
