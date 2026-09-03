import {
  commandIdSchema,
  isJsonBoolean,
  isJsonNumber,
  isJsonObject,
  isJsonString,
} from "@chief/relay-contracts";

export type WorkspaceInferenceProvider = "opencode" | "vercelAiGateway" | null;
export type WorkspaceAgentRuntime = "relay-cell" | "vercel-eve";
export type EveProjectMode = "" | "new" | "existing";

const createDraftVersion = 12;

export interface CreateWorkspaceDraft {
  version: typeof createDraftVersion;
  commandId: string;
  step: number;
  name: string;
  website: string;
  provider: WorkspaceInferenceProvider;
  agentRuntime: WorkspaceAgentRuntime;
  eveWorkspaceId: string | null;
  eveAutoDeploy: boolean;
  eveTeamId: string;
  eveProjectMode: EveProjectMode;
  eveProjectId: string;
  eveProjectName: string;
  page: "create" | "eve";
  selectedApps: string[];
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
      step > 4 ||
      !isJsonString(value.name) ||
      !isJsonString(value.website) ||
      (value.agentRuntime !== "relay-cell" &&
        value.agentRuntime !== "vercel-eve") ||
      (value.eveWorkspaceId !== null && !isJsonString(value.eveWorkspaceId)) ||
      (value.eveAutoDeploy !== undefined &&
        !isJsonBoolean(value.eveAutoDeploy)) ||
      (value.eveTeamId !== undefined && !isJsonString(value.eveTeamId)) ||
      (value.eveProjectMode !== undefined &&
        value.eveProjectMode !== "" &&
        value.eveProjectMode !== "new" &&
        value.eveProjectMode !== "existing") ||
      (value.eveProjectId !== undefined && !isJsonString(value.eveProjectId)) ||
      (value.eveProjectName !== undefined &&
        !isJsonString(value.eveProjectName)) ||
      (value.page !== undefined &&
        value.page !== "create" &&
        value.page !== "eve") ||
      !Array.isArray(value.selectedApps) ||
      !value.selectedApps.every((app) => isJsonString(app)) ||
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
      agentRuntime: value.agentRuntime,
      eveWorkspaceId: value.eveWorkspaceId,
      eveAutoDeploy: value.eveAutoDeploy === true,
      eveTeamId: isJsonString(value.eveTeamId) ? value.eveTeamId : "",
      eveProjectMode:
        value.eveProjectMode === "new" || value.eveProjectMode === "existing"
          ? value.eveProjectMode
          : "",
      eveProjectId: isJsonString(value.eveProjectId) ? value.eveProjectId : "",
      eveProjectName: isJsonString(value.eveProjectName)
        ? value.eveProjectName
        : "",
      page: value.page === "eve" ? "eve" : "create",
      provider:
        value.provider === "opencode" || value.provider === "vercelAiGateway"
          ? value.provider
          : null,
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

export function eveDestinationIsReady(draft: {
  eveTeamId: string;
  eveProjectMode: EveProjectMode;
  eveProjectId: string;
  eveProjectName: string;
}) {
  if (!draft.eveTeamId || !draft.eveProjectMode) return false;
  if (draft.eveProjectMode === "existing") return Boolean(draft.eveProjectId);
  return Boolean(draft.eveProjectName.trim());
}
