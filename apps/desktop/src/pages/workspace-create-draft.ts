import {
  isJsonNumber,
  isJsonObject,
  isJsonString,
} from "@chief/relay-contracts";

export type WorkspaceInferenceProvider = "claude" | "codex" | "opencode" | null;

const createDraftVersion = 1;

export interface CreateWorkspaceDraft {
  version: typeof createDraftVersion;
  step: number;
  name: string;
  website: string;
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
      !isJsonString(value.model) ||
      !Array.isArray(value.selectedApps) ||
      !value.selectedApps.every((app) => isJsonString(app)) ||
      (value.provider !== undefined &&
        value.provider !== null &&
        value.provider !== "claude" &&
        value.provider !== "codex" &&
        value.provider !== "opencode")
    ) {
      return null;
    }
    return {
      version: createDraftVersion,
      step,
      name: value.name,
      website: value.website,
      provider:
        value.provider === "claude" ||
        value.provider === "codex" ||
        value.provider === "opencode"
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
