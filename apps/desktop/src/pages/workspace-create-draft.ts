import {
  commandIdSchema,
  isJsonNumber,
  isJsonObject,
  isJsonString,
} from "@chief/relay-contracts";

export type WorkspaceInferenceProvider =
  | "opencode"
  | "vercelAiGateway"
  | null;
export type WorkspaceHosting = "chief-cloud" | "self-hosted";

const createDraftVersion = 5;

export interface CreateWorkspaceDraft {
  version: typeof createDraftVersion;
  commandId: string;
  step: number;
  name: string;
  website: string;
  provider: WorkspaceInferenceProvider;
  selectedApps: string[];
  hosting: WorkspaceHosting;
  relayUrl: string;
}

export function createWorkspaceDraftKey(relayUrl: string, userId?: string) {
  return `chief.create-workspace-draft.v1:${new URL(relayUrl).origin}:${userId ?? "signed-in"}`;
}

export function readCreateWorkspaceDraft(
  key: string,
): CreateWorkspaceDraft | null {
  return parseCreateWorkspaceDraft(window.localStorage.getItem(key));
}

export function parseCreateWorkspaceDraft(
  serialized: string | null,
): CreateWorkspaceDraft | null {
  try {
    const value: unknown = JSON.parse(serialized ?? "null");
    if (!isJsonObject(value)) return null;
    const step = value.step;
    if (
      value.version !== createDraftVersion ||
      !commandIdSchema.safeParse(value.commandId).success ||
      !isJsonNumber(step) ||
      !Number.isInteger(step) ||
      step < 0 ||
      step > 3 ||
      !isJsonString(value.name) ||
      !isJsonString(value.website) ||
      !Array.isArray(value.selectedApps) ||
      !value.selectedApps.every((app) => isJsonString(app)) ||
      (value.hosting !== "chief-cloud" && value.hosting !== "self-hosted") ||
      !isJsonString(value.relayUrl) ||
      (value.provider !== undefined &&
        value.provider !== null &&
        value.provider !== "opencode" &&
        value.provider !== "vercelAiGateway")
    ) {
      return null;
    }
    return {
      version: createDraftVersion,
      commandId: commandIdSchema.parse(value.commandId),
      step,
      name: value.name,
      website: value.website,
      provider:
        value.provider === "opencode" ||
        value.provider === "vercelAiGateway"
          ? value.provider
          : null,
      selectedApps: value.selectedApps,
      hosting: value.hosting,
      relayUrl: normalizedRelayUrl(value.relayUrl),
    };
  } catch {
    return null;
  }
}

function normalizedRelayUrl(value: string) {
  const url = new URL(value);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

export function workspaceDraft(
  draft: Omit<CreateWorkspaceDraft, "version">,
): CreateWorkspaceDraft {
  return { version: createDraftVersion, ...draft };
}
