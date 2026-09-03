import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import type { RelayClient } from "@chief/relay-client";
import type { WorkspaceSnapshot } from "@chief/relay-contracts";

import type {
  EveProjectMode,
  WorkspaceAgentRuntime,
  WorkspaceInferenceProvider,
} from "./workspace-create-draft";
import type {
  WorkspaceNewDraftOverrides,
  WorkspacePageMode,
} from "./workspace-new-flow";
import { preferredVercelProjectName } from "../components/agents/agent-connection-model";
import { connectedRelayIdentities } from "../lib/auth/account-directory";
import { useAuth } from "../lib/auth/auth-context";
import { RELAY_URL } from "../lib/config";
import { knownWorkspacesForRelayIdentities } from "../lib/relay-connection";
import { relayAgentDefinitions } from "../lib/relay-runtime-agents";
import { useRelaySession } from "../lib/relay-session";
import {
  activeWorkspaceCreateKey,
  pendingCreateRelayKey,
  shouldRestoreWorkspaceCreate,
  shouldResumeWorkspaceCreate,
} from "../lib/workspace-entry";
import { createWorkspaceDraftKey } from "./workspace-create-draft";
import {
  claimPreparedWorkspaceInvite,
  connectForeignInviteRelay,
  prepareWorkspaceInvite,
  refreshEveDestinations,
  submitWorkspaceCreate,
  useWorkspaceNewLifecycle,
} from "./workspace-new-effects";
import {
  forgetPendingVercelToken,
  initialWorkspacePageMode,
  pendingInviteKey,
  persistWorkspaceCreateDraft,
  readPendingVercelToken,
  resolveEveWorkspace,
  restoredWorkspaceDraft,
  useOnboardingRecorder,
} from "./workspace-new-flow";
import { parseIncomingOrganizationInvitation } from "./workspace-new-supplementary";

type VercelDestinationCatalog = Awaited<
  ReturnType<RelayClient["listVercelDestinations"]>
>;

export function useWorkspaceNewPage() {
  const auth = useAuth();
  const relay = useRelaySession();
  const navigate = useNavigate();
  const createDraftKey = useMemo(
    () => createWorkspaceDraftKey(RELAY_URL, auth.user?.id),
    [auth.user?.id],
  );
  const resumesWorkspaceCreate = shouldResumeWorkspaceCreate(
    window.sessionStorage.getItem(pendingCreateRelayKey),
    RELAY_URL,
  );
  const activeCreateKey = activeWorkspaceCreateKey(createDraftKey);
  const addWorkspace =
    new URLSearchParams(window.location.search).get("intent") === "add";
  const restoresWorkspaceCreate = shouldRestoreWorkspaceCreate(
    window.sessionStorage.getItem(activeCreateKey),
    resumesWorkspaceCreate,
    addWorkspace,
  );
  const initialDraft = useMemo(
    () => restoredWorkspaceDraft(restoresWorkspaceCreate, createDraftKey),
    [createDraftKey, restoresWorkspaceCreate],
  );
  const incomingInvite =
    new URLSearchParams(window.location.search).get("invite") ??
    window.sessionStorage.getItem(pendingInviteKey) ??
    "";
  const incomingOrganizationInvite = new URLSearchParams(
    window.location.search,
  ).get("organizationInvite");
  const organizationEntry = useMemo(
    () => parseIncomingOrganizationInvitation(incomingOrganizationInvite),
    [incomingOrganizationInvite],
  );
  const [mode, setMode] = useState<WorkspacePageMode>(() =>
    initialWorkspacePageMode(
      Boolean(incomingInvite || organizationEntry.invitation),
      initialDraft,
      resumesWorkspaceCreate,
      addWorkspace,
    ),
  );
  const [transitionDirection, setTransitionDirection] = useState<1 | -1>(1);
  const [createStep, setCreateStep] = useState(initialDraft?.step ?? 0);
  const [createCommandId, setCreateCommandId] = useState(
    initialDraft?.commandId ?? crypto.randomUUID(),
  );
  const [name, setName] = useState(initialDraft?.name ?? "");
  const [website, setWebsite] = useState(initialDraft?.website ?? "");
  const [provider, setProvider] = useState<WorkspaceInferenceProvider>(
    initialDraft?.provider ?? "vercelAiGateway",
  );
  const [agentRuntime, setAgentRuntime] = useState<WorkspaceAgentRuntime>(
    initialDraft?.agentRuntime ?? "relay-cell",
  );
  const [apiKey, setApiKey] = useState("");
  const [vercelAccessToken, setVercelAccessToken] = useState(() =>
    readPendingVercelToken(createDraftKey),
  );
  const [eveDestinationCatalog, setEveDestinationCatalog] =
    useState<VercelDestinationCatalog>({ teams: [], projects: [] });
  const [eveDestinationLoading, setEveDestinationLoading] = useState(false);
  const [eveTeamId, setEveTeamId] = useState(initialDraft?.eveTeamId ?? "");
  const [eveProjectMode, setEveProjectMode] = useState<EveProjectMode>(
    initialDraft?.eveProjectMode === "existing" ? "existing" : "new",
  );
  const [eveProjectId, setEveProjectId] = useState(
    initialDraft?.eveProjectId ?? "",
  );
  const [eveProjectName, setEveProjectName] = useState(() => {
    const stored = initialDraft?.eveProjectName ?? "";
    return stored.trim()
      ? preferredVercelProjectName(initialDraft?.name ?? "", stored)
      : "";
  });
  const [eveAutoDeploy, setEveAutoDeploy] = useState(
    initialDraft?.eveAutoDeploy ?? false,
  );
  const [selectedApps, setSelectedApps] = useState<Set<string>>(
    () => new Set(initialDraft?.selectedApps ?? []),
  );
  const [invite, setInvite] = useState(incomingInvite);
  const [invitePreview, setInvitePreview] = useState<{
    workspaceId: string;
    workspaceName: string;
    conversationName: string | null;
    secret: string;
  } | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(
    organizationEntry.error,
  );
  const [eveWorkspace, setEveWorkspace] = useState<{
    snapshot: WorkspaceSnapshot;
    client: RelayClient;
  } | null>(null);
  const resolvedEveWorkspace = useMemo(
    () =>
      resolveEveWorkspace(
        eveWorkspace,
        initialDraft,
        relay.snapshot,
        relay.client,
      ),
    [eveWorkspace, initialDraft, relay.client, relay.snapshot],
  );
  const resolvedEveWorkspaceId = resolvedEveWorkspace?.snapshot.id ?? null;
  const [foreignRelay, setForeignRelay] = useState<{
    relayUrl: string;
    invitation: string;
    kind: "link" | "organization";
  } | null>(
    organizationEntry.invitation &&
      organizationEntry.invitation.relayUrl !== new URL(RELAY_URL).origin
      ? {
          relayUrl: organizationEntry.invitation.relayUrl,
          invitation: incomingOrganizationInvite ?? "",
          kind: "organization",
        }
      : null,
  );
  const recordOnboardingEvent = useOnboardingRecorder(
    relay.client,
    createCommandId,
  );
  const persistCreateDraft = useCallback(
    (overrides: WorkspaceNewDraftOverrides = {}) => {
      persistWorkspaceCreateDraft(
        { activeCreateKey, createDraftKey },
        {
          commandId: createCommandId,
          step: overrides.step ?? createStep,
          name,
          website,
          provider,
          agentRuntime,
          eveWorkspaceId: overrides.eveWorkspaceId ?? resolvedEveWorkspaceId,
          eveAutoDeploy: overrides.eveAutoDeploy ?? eveAutoDeploy,
          eveTeamId,
          eveProjectMode,
          eveProjectId,
          eveProjectName,
          page: overrides.page ?? (mode === "eve" ? "eve" : "create"),
          selectedApps: Array.from(selectedApps).sort(),
        },
      );
    },
    [
      activeCreateKey,
      agentRuntime,
      createCommandId,
      createDraftKey,
      createStep,
      eveAutoDeploy,
      eveProjectId,
      eveProjectMode,
      eveProjectName,
      eveTeamId,
      mode,
      name,
      provider,
      resolvedEveWorkspaceId,
      selectedApps,
      website,
    ],
  );

  useWorkspaceNewLifecycle({
    activeCreateKey,
    addWorkspace,
    agentRuntime,
    createDraftKey,
    createStep,
    initialDraft,
    mode,
    navigate,
    organizationInvitation: organizationEntry.invitation,
    persistCreateDraft,
    recordOnboardingEvent,
    relay,
    vercelAccessToken,
  });

  const returnToWorkspaceHome = useCallback(() => {
    setTransitionDirection(-1);
    setActionError(null);
    setForeignRelay(null);
    setInvitePreview(null);
    setMode("home");
  }, []);

  const leaveCreateFlow = useCallback(() => {
    window.localStorage.removeItem(createDraftKey);
    window.sessionStorage.removeItem(activeCreateKey);
    setCreateCommandId(crypto.randomUUID());
    setCreateStep(0);
    setName("");
    setWebsite("");
    setProvider("vercelAiGateway");
    setAgentRuntime("relay-cell");
    setVercelAccessToken("");
    forgetPendingVercelToken(createDraftKey);
    setEveDestinationCatalog({ teams: [], projects: [] });
    setEveTeamId("");
    setEveProjectMode("new");
    setEveProjectId("");
    setEveProjectName("");
    setEveAutoDeploy(false);
    setSelectedApps(new Set());
    setEveWorkspace(null);
    returnToWorkspaceHome();
  }, [activeCreateKey, createDraftKey, returnToWorkspaceHome]);

  const returnToExistingWorkspace = useCallback(async () => {
    setActionError(null);
    if (relay.snapshot) {
      void navigate("/", { replace: true });
      return;
    }
    const fallback = knownWorkspacesForRelayIdentities(
      connectedRelayIdentities(),
    )[0];
    if (!fallback || isWorking) return;
    setIsWorking(true);
    try {
      await relay.switchWorkspace(fallback.summary.id, fallback);
      void navigate("/", { replace: true });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
      setIsWorking(false);
    }
  }, [isWorking, navigate, relay]);

  const createWorkspace = useCallback(() => {
    return submitWorkspaceCreate({
      activeCreateKey,
      agentRuntime,
      apiKey,
      createCommandId,
      createDraftKey,
      createWorkspace: (command, key, options) =>
        relay.createWorkspace(command, key, options),
      eveProjectId,
      eveProjectMode,
      eveProjectName,
      eveTeamId,
      isWorking,
      name,
      persistCreateDraft,
      provider,
      recordOnboardingEvent,
      relayClient: relay.client,
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
    });
  }, [
    apiKey,
    activeCreateKey,
    agentRuntime,
    createCommandId,
    createDraftKey,
    eveProjectId,
    eveProjectMode,
    eveProjectName,
    eveTeamId,
    isWorking,
    name,
    navigate,
    persistCreateDraft,
    provider,
    recordOnboardingEvent,
    relay,
    selectedApps,
    vercelAccessToken,
    website,
  ]);

  const loadEveDestinations = useCallback(
    async (teamId?: string) => {
      const token = vercelAccessToken.trim();
      if (!token) {
        setActionError("Add a Vercel access token before continuing.");
        return false;
      }
      setEveDestinationLoading(true);
      setActionError(null);
      try {
        await refreshEveDestinations({
          name,
          token,
          teamId,
          onCatalog: setEveDestinationCatalog,
          onProjectName: setEveProjectName,
          onTeamId: setEveTeamId,
        });
        return true;
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        setEveDestinationLoading(false);
      }
    },
    [name, vercelAccessToken],
  );

  const prepareInvite = useCallback(async () => {
    setIsWorking(true);
    setActionError(null);
    try {
      const parsed = await prepareWorkspaceInvite({
        invite,
        previewInvite: (workspaceId, secret) =>
          relay.previewWorkspaceInvite(workspaceId, secret),
      });
      setTransitionDirection(1);
      if (parsed.kind === "foreign") {
        setForeignRelay({
          relayUrl: parsed.relayUrl,
          invitation: parsed.invitation,
          kind: "link",
        });
        return;
      }
      setInvitePreview(parsed);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsWorking(false);
    }
  }, [invite, relay]);

  const connectToInviteRelay = useCallback(async () => {
    if (!foreignRelay || isWorking) return;
    setIsWorking(true);
    setActionError(null);
    try {
      await connectForeignInviteRelay(foreignRelay);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
      setIsWorking(false);
    }
  }, [foreignRelay, isWorking]);

  const joinWorkspace = useCallback(async () => {
    if (!invitePreview) return;
    setIsWorking(true);
    setActionError(null);
    try {
      await claimPreparedWorkspaceInvite({
        invitePreview,
        claimInvite: (workspaceId, secret) =>
          relay.claimWorkspaceInvite(workspaceId, secret),
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
      setIsWorking(false);
    }
  }, [invitePreview, relay]);

  const eveAgents = resolvedEveWorkspace
    ? relayAgentDefinitions(resolvedEveWorkspace.snapshot)
    : [];
  const canReturnToWorkspace =
    relay.snapshot !== null ||
    knownWorkspacesForRelayIdentities(connectedRelayIdentities()).length > 0;

  return {
    user: auth.user,
    onSignOut: () => auth.signOut(),
    mode,
    createStep,
    agentRuntime,
    eveAutoDeploy,
    transitionDirection,
    canReturnToWorkspace,
    isWorking,
    actionError,
    name,
    website,
    provider,
    apiKey,
    vercelAccessToken,
    selectedApps,
    eveDestinationLoading,
    eveTeamId,
    eveProjectMode,
    eveProjectId,
    eveProjectName,
    eveDestinationCatalog,
    connected: relay.client !== null,
    eveAgent:
      eveAgents.find((agent) => agent.id === "chief") ?? eveAgents[0] ?? null,
    resolvedEveWorkspace,
    foreignRelay,
    invite,
    invitePreview,
    createDraftKey,
    activeCreateKey,
    recordOnboardingEvent,
    setName,
    setWebsite,
    setProvider,
    setApiKey,
    setVercelAccessToken,
    setSelectedApps,
    setAgentRuntime,
    setActionError,
    setTransitionDirection,
    setCreateStep,
    setMode,
    setEveTeamId,
    setEveProjectId,
    setEveProjectMode,
    setEveProjectName,
    setEveAutoDeploy,
    setInvite,
    setInvitePreview,
    setForeignRelay,
    loadEveDestinations,
    createWorkspace,
    leaveCreateFlow,
    returnToWorkspaceHome,
    returnToExistingWorkspace,
    prepareInvite,
    connectToInviteRelay,
    joinWorkspace,
    navigate,
    relaySnapshotId: relay.snapshot?.id ?? null,
    refreshRelay: relay.refresh,
    setIsWorking,
    switchWorkspace: relay.switchWorkspace,
  };
}

export type WorkspaceNewPageModel = ReturnType<typeof useWorkspaceNewPage>;
