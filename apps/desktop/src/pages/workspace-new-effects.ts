import type { NavigateFunction } from "react-router";
import { useEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

import type { RelayClient } from "@chief/relay-client";
import type {
  CreateWorkspaceCommand,
  OnboardingStage,
  OnboardingTelemetryEvent,
  WorkspaceSnapshot,
} from "@chief/relay-contracts";
import { RelayClientError } from "@chief/relay-client";

import type { PendingOrganizationInvitation } from "../lib/organization-invitation";
import type { RelaySessionValue } from "../lib/relay-session-value";
import type {
  EveProjectMode,
  WorkspaceAgentRuntime,
  WorkspaceInferenceProvider,
} from "./workspace-create-draft";
import type {
  EveWorkspace,
  WorkspaceNewDraftOverrides,
  WorkspacePageMode,
} from "./workspace-new-flow";
import {
  preferredVercelProjectName,
  suggestedVercelProjectName,
} from "../components/agents/agent-connection-model";
import { RELAY_URL } from "../lib/config";
import {
  parseOrganizationInvitationUrl,
  storePendingOrganizationInvitation,
} from "../lib/organization-invitation";
import {
  saveStoredRelayConnection,
  validateRelayConnection,
} from "../lib/relay-connection";
import {
  pendingCreateDraftKey,
  pendingCreateRelayKey,
} from "../lib/workspace-entry";
import { eveDestinationIsReady } from "./workspace-create-draft";
import { preloadWorkspaceOnboardingApps } from "./workspace-create-options";
import {
  connectEveWorkspace,
  createEveWorkspace,
  createRelayWorkspace,
  previewVercelDestinations,
} from "./workspace-new-actions";
import {
  onboardingStage,
  pendingInviteKey,
  rememberPendingVercelToken,
} from "./workspace-new-flow";
import { parseWorkspaceInvite } from "./workspace-new-supplementary";

type OnboardingRecorder = (
  event: OnboardingTelemetryEvent["event"],
  stage: OnboardingStage,
  details?: Partial<OnboardingTelemetryEvent>,
) => void;

type CreateWorkspaceFn = (
  command: CreateWorkspaceCommand,
  apiKey: string,
  options?: { reconnect?: boolean },
) => Promise<WorkspaceSnapshot>;

export function useWorkspaceNewLifecycle({
  activeCreateKey,
  addWorkspace,
  agentRuntime,
  createDraftKey,
  createStep,
  initialDraft,
  mode,
  navigate,
  organizationInvitation,
  persistCreateDraft,
  recordOnboardingEvent,
  relay,
  vercelAccessToken,
}: {
  activeCreateKey: string;
  addWorkspace: boolean;
  agentRuntime: WorkspaceAgentRuntime;
  createDraftKey: string;
  createStep: number;
  initialDraft: {
    eveAutoDeploy: boolean;
    eveWorkspaceId: string | null;
  } | null;
  mode: WorkspacePageMode;
  navigate: NavigateFunction;
  organizationInvitation: PendingOrganizationInvitation | null;
  persistCreateDraft: (overrides?: WorkspaceNewDraftOverrides) => void;
  recordOnboardingEvent: OnboardingRecorder;
  relay: Pick<
    RelaySessionValue,
    "client" | "loading" | "snapshot" | "switchWorkspace"
  >;
  vercelAccessToken: string;
}) {
  const lastViewedStage = useRef<string | null>(null);

  useEffect(() => {
    preloadWorkspaceOnboardingApps();
  }, []);

  useEffect(() => {
    rememberPendingVercelToken(createDraftKey, vercelAccessToken);
  }, [createDraftKey, vercelAccessToken]);

  useEffect(() => {
    const targetId = initialDraft?.eveWorkspaceId;
    if (
      !initialDraft?.eveAutoDeploy ||
      !targetId ||
      !relay.client ||
      relay.loading
    )
      return;
    if (relay.snapshot?.id === targetId) return;
    void relay.switchWorkspace(targetId).catch((error: unknown) => {
      console.warn(
        "[Onboarding] Could not return to the Eve workspace:",
        error,
      );
    });
  }, [initialDraft?.eveAutoDeploy, initialDraft?.eveWorkspaceId, relay]);

  useEffect(() => {
    if (mode === "create" || mode === "eve") {
      window.sessionStorage.setItem(activeCreateKey, "active");
      window.sessionStorage.removeItem(pendingCreateRelayKey);
      window.sessionStorage.removeItem(pendingCreateDraftKey);
    }
  }, [activeCreateKey, mode]);

  useEffect(() => {
    if (!addWorkspace || mode !== "home") return;
    window.localStorage.removeItem(createDraftKey);
    window.sessionStorage.removeItem(activeCreateKey);
  }, [activeCreateKey, addWorkspace, createDraftKey, mode]);

  useEffect(() => {
    const stage = onboardingStage(mode, createStep, agentRuntime);
    if (!stage) return;
    const viewKey = `${mode}:${createStep}`;
    if (lastViewedStage.current === viewKey) return;
    lastViewedStage.current = viewKey;
    recordOnboardingEvent("viewed", stage);
  }, [agentRuntime, createStep, mode, recordOnboardingEvent]);

  useEffect(() => {
    if (mode !== "create" && mode !== "eve") return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("invite") || params.has("organizationInvite")) return;
    if (params.get("intent") === "create") return;
    params.set("intent", "create");
    const query = params.toString();
    void navigate(
      query ? `/workspaces/new?${query}` : "/workspaces/new?intent=create",
      { replace: true },
    );
  }, [mode, navigate]);

  useEffect(() => {
    if (mode !== "create" && mode !== "eve") return;
    persistCreateDraft();
  }, [mode, persistCreateDraft]);

  useEffect(() => {
    if (organizationInvitation?.relayUrl !== new URL(RELAY_URL).origin) return;
    storePendingOrganizationInvitation(organizationInvitation);
    window.location.assign("/");
  }, [organizationInvitation]);
}

export async function submitWorkspaceCreate({
  activeCreateKey,
  agentRuntime,
  apiKey,
  createCommandId,
  createDraftKey,
  createWorkspace,
  eveProjectId,
  eveProjectMode,
  eveProjectName,
  eveTeamId,
  isWorking,
  name,
  persistCreateDraft,
  provider,
  recordOnboardingEvent,
  relayClient,
  selectedApps,
  vercelAccessToken,
  website,
  navigate,
  setActionError,
  setEveAutoDeploy,
  setEveDestinationCatalog,
  setEveWorkspace,
  setIsWorking,
  setMode,
  setTransitionDirection,
}: {
  activeCreateKey: string;
  agentRuntime: WorkspaceAgentRuntime;
  apiKey: string;
  createCommandId: string;
  createDraftKey: string;
  createWorkspace: CreateWorkspaceFn;
  eveProjectId: string;
  eveProjectMode: EveProjectMode;
  eveProjectName: string;
  eveTeamId: string;
  isWorking: boolean;
  name: string;
  persistCreateDraft: (overrides?: WorkspaceNewDraftOverrides) => void;
  provider: WorkspaceInferenceProvider;
  recordOnboardingEvent: OnboardingRecorder;
  relayClient: RelayClient | null;
  selectedApps: Set<string>;
  vercelAccessToken: string;
  website: string;
  navigate: NavigateFunction;
  setActionError: (error: string | null) => void;
  setEveAutoDeploy: (value: boolean) => void;
  setEveDestinationCatalog: (
    catalog: Awaited<ReturnType<RelayClient["listVercelDestinations"]>>,
  ) => void;
  setEveWorkspace: (workspace: EveWorkspace) => void;
  setIsWorking: (value: boolean) => void;
  setMode: (mode: WorkspacePageMode) => void;
  setTransitionDirection: (direction: 1 | -1) => void;
}) {
  const trimmedName = name.trim();
  if (!trimmedName || isWorking) return;
  if (!relayClient) {
    setActionError("Chief is still connecting to this relay.");
    return;
  }
  if (agentRuntime === "relay-cell" && !provider) {
    setActionError("Choose an inference provider before continuing.");
    return;
  }
  if (
    agentRuntime === "vercel-eve" &&
    !eveDestinationIsReady({
      eveTeamId,
      eveProjectMode,
      eveProjectId,
      eveProjectName,
    })
  ) {
    setActionError("Choose a Vercel team and project before continuing.");
    return;
  }
  const token = vercelAccessToken.trim();
  if (agentRuntime === "vercel-eve" && !token) {
    setActionError("Add a Vercel access token before continuing.");
    return;
  }
  setIsWorking(true);
  setActionError(null);
  try {
    recordOnboardingEvent("advanced", "apps", {
      agentRuntime,
      provider: provider ?? undefined,
      selectedAppCount: selectedApps.size,
    });
    if (agentRuntime === "vercel-eve") {
      const snapshot = await createEveWorkspace({
        commandId: createCommandId,
        createWorkspace: (command, key) =>
          createWorkspace(command, key, { reconnect: false }),
        name: trimmedName,
        selectedApps: Array.from(selectedApps).sort(),
        website: website.trim(),
      });
      persistCreateDraft({
        eveWorkspaceId: snapshot.id,
        eveAutoDeploy: false,
        page: "create",
        step: 3,
      });
      const client = relayClient.forWorkspace(snapshot.id);
      try {
        const catalog = await connectEveWorkspace({ client, token });
        persistCreateDraft({
          eveWorkspaceId: snapshot.id,
          eveAutoDeploy: true,
          page: "eve",
          step: 3,
        });
        setEveWorkspace({ snapshot, client });
        setEveDestinationCatalog(catalog);
        setEveAutoDeploy(true);
        setTransitionDirection(1);
        setMode("eve");
        setIsWorking(false);
      } catch (error) {
        setEveWorkspace({ snapshot, client });
        throw error;
      }
      return;
    }
    const snapshot = await createRelayWorkspace({
      apiKey,
      commandId: createCommandId,
      createWorkspace: (command, key) => createWorkspace(command, key),
      inferenceProvider: provider ?? "vercelAiGateway",
      name: trimmedName,
      selectedApps: Array.from(selectedApps).sort(),
      website: website.trim(),
    });
    recordOnboardingEvent("completed", "workspace-create", {
      agentRuntime,
      provider: provider ?? undefined,
      selectedAppCount: selectedApps.size,
      workspaceId: snapshot.id,
    });
    window.localStorage.removeItem(createDraftKey);
    window.sessionStorage.removeItem(activeCreateKey);
    void navigate("/", { replace: true });
  } catch (error) {
    recordOnboardingEvent("failed", "workspace-create", {
      agentRuntime,
      provider: provider ?? undefined,
      selectedAppCount: selectedApps.size,
      errorCode:
        error instanceof RelayClientError
          ? (error.code ?? `http_${error.status}`)
          : "client_error",
    });
    setActionError(error instanceof Error ? error.message : String(error));
    setIsWorking(false);
  }
}

export async function refreshEveDestinations({
  name,
  teamId,
  token,
  onCatalog,
  onProjectName,
  onTeamId,
}: {
  name: string;
  teamId?: string;
  token: string;
  onCatalog: (
    catalog: Awaited<ReturnType<typeof previewVercelDestinations>>,
  ) => void;
  onProjectName: (update: (current: string) => string) => void;
  onTeamId: (teamId: string) => void;
}) {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error("Add a Vercel access token before continuing.");
  }
  const vercelFetcher = isTauri() ? tauriFetch : fetch;
  const catalog = await previewVercelDestinations({
    fetcher: vercelFetcher,
    token: trimmed,
    teamId,
  });
  onCatalog(catalog);
  let nextTeamId = catalog.teams[0]?.id ?? "";
  if (teamId) nextTeamId = teamId;
  onTeamId(nextTeamId);
  onProjectName((current) =>
    preferredVercelProjectName(
      name,
      current.trim() || suggestedVercelProjectName(name),
    ),
  );
  if (!teamId && nextTeamId) {
    const withProjects = await previewVercelDestinations({
      fetcher: vercelFetcher,
      token: trimmed,
      teamId: nextTeamId,
    });
    onCatalog(withProjects);
    onProjectName((current) =>
      preferredVercelProjectName(
        name,
        current.trim() || suggestedVercelProjectName(name),
      ),
    );
  }
}

export async function prepareWorkspaceInvite({
  invite,
  previewInvite,
}: {
  invite: string;
  previewInvite: (
    workspaceId: string,
    secret: string,
  ) => Promise<{
    workspaceId: string;
    workspaceName: string;
    conversationName: string | null;
  }>;
}) {
  const parsed = parseWorkspaceInvite(invite);
  if (parsed.relayUrl !== new URL(RELAY_URL).origin) {
    return {
      kind: "foreign" as const,
      relayUrl: parsed.relayUrl,
      invitation: invite.trim(),
    };
  }
  const preview = await previewInvite(parsed.workspaceId, parsed.secret);
  return {
    kind: "preview" as const,
    workspaceId: preview.workspaceId,
    workspaceName: preview.workspaceName,
    conversationName: preview.conversationName,
    secret: parsed.secret,
  };
}

export async function connectForeignInviteRelay(foreignRelay: {
  relayUrl: string;
  invitation: string;
  kind: "link" | "organization";
}) {
  const connection = await validateRelayConnection(
    foreignRelay.relayUrl,
    isTauri() ? tauriFetch : fetch,
  );
  if (foreignRelay.kind === "organization") {
    storePendingOrganizationInvitation(
      parseOrganizationInvitationUrl(foreignRelay.invitation),
    );
  } else {
    window.sessionStorage.setItem(pendingInviteKey, foreignRelay.invitation);
  }
  saveStoredRelayConnection(connection);
  window.location.assign("/");
}

export async function claimPreparedWorkspaceInvite({
  invitePreview,
  claimInvite,
}: {
  invitePreview: { workspaceId: string; secret: string };
  claimInvite: (
    workspaceId: string,
    secret: string,
  ) => Promise<{ conversationId: string | null }>;
}) {
  const result = await claimInvite(
    invitePreview.workspaceId,
    invitePreview.secret,
  );
  window.sessionStorage.removeItem(pendingInviteKey);
  window.location.assign(
    result.conversationId
      ? `/conversations?channel=${encodeURIComponent(result.conversationId)}`
      : "/",
  );
}
