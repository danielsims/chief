import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router";

import type {
  OnboardingStage,
  OnboardingTelemetryEvent,
} from "@chief/relay-contracts";
import { RelayClientError } from "@chief/relay-client";
import {
  commandIdSchema,
  createWorkspaceCommandSchema,
} from "@chief/relay-contracts";
import { TooltipProvider } from "@chief/ui/components/tooltip";

import type { WorkspaceHosting } from "./workspace-create-draft";
import type { WorkspaceInferenceProvider } from "./workspace-create-draft";
import type { LocalRelayDiscovery } from "./workspace-new-supplementary";
import { connectedRelayIdentities } from "../lib/auth/account-directory";
import { useAuth } from "../lib/auth/auth-context";
import {
  CHIEF_CLOUD_AUTH_BASE_URL,
  CHIEF_CLOUD_AUTH_UI_URL,
  CHIEF_CLOUD_RELAY_URL,
  RELAY_URL,
  USING_CUSTOM_RELAY,
} from "../lib/config";
import {
  parseOrganizationInvitationUrl,
  storePendingOrganizationInvitation,
} from "../lib/organization-invitation";
import {
  knownWorkspacesForRelayIdentities,
  saveStoredRelayConnection,
  validateRelayConnection,
} from "../lib/relay-connection";
import { useRelaySession } from "../lib/relay-session";
import {
  pendingCreateDraftKey,
  pendingCreateRelayKey,
  shouldResumeWorkspaceCreate,
} from "../lib/workspace-entry";
import { UserIndicator } from "./onboarding-presentation";
import {
  createWorkspaceDraftKey,
  parseCreateWorkspaceDraft,
  readCreateWorkspaceDraft,
  workspaceDraft,
} from "./workspace-create-draft";
import { preloadWorkspaceOnboardingApps } from "./workspace-create-options";
import { WorkspaceHome, WorkspaceProgress } from "./workspace-new-chrome";
import { CreateForm, JoinForm } from "./workspace-new-components";
import {
  ForeignRelayInvite,
  parseIncomingOrganizationInvitation,
  parseWorkspaceInvite,
  preloadLocalRelayDiscovery,
  WorkspaceHostingChoice,
} from "./workspace-new-supplementary";

type PageMode = "home" | "hosting" | "create" | "join";
const pendingInviteKey = "chief.pending-workspace-invite.v1";

function onboardingStage(mode: PageMode, step: number): OnboardingStage | null {
  if (mode === "home") return "workspace-home";
  if (mode === "hosting") return "agent-hosting";
  if (mode !== "create") return null;
  const stages: OnboardingStage[] = [
    "workspace-profile",
    "agent-hosting",
    "inference-provider",
    "apps",
  ];
  return stages[step] ?? null;
}

export function CreateWorkspacePage() {
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
  const initialDraft = useMemo(
    () =>
      readCreateWorkspaceDraft(createDraftKey) ??
      (resumesWorkspaceCreate
        ? parseCreateWorkspaceDraft(
            window.sessionStorage.getItem(pendingCreateDraftKey),
          )
        : null),
    [createDraftKey, resumesWorkspaceCreate],
  );
  const activeRelayUrl = new URL(RELAY_URL).origin;
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
  const [mode, setMode] = useState<PageMode>(
    incomingInvite || organizationEntry.invitation
      ? "join"
      : initialDraft || resumesWorkspaceCreate
        ? "create"
        : "home",
  );
  const [createStep, setCreateStep] = useState(initialDraft?.step ?? 0);
  const [createCommandId, setCreateCommandId] = useState(
    initialDraft?.commandId ?? crypto.randomUUID(),
  );
  const lastViewedStage = useRef<string | null>(null);
  const [name, setName] = useState(initialDraft?.name ?? "");
  const [website, setWebsite] = useState(initialDraft?.website ?? "");
  const [provider, setProvider] = useState<WorkspaceInferenceProvider>(
    initialDraft?.provider ?? "opencode",
  );
  const [apiKey, setApiKey] = useState("");
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
  const [hosting, setHosting] = useState<WorkspaceHosting>(
    initialDraft?.hosting ??
      (USING_CUSTOM_RELAY ? "self-hosted" : "chief-cloud"),
  );
  const [selectedRelayUrl, setSelectedRelayUrl] = useState(
    initialDraft?.relayUrl ?? activeRelayUrl,
  );
  const [selfHostedRelayUrl, setSelfHostedRelayUrl] = useState(
    initialDraft?.hosting === "self-hosted" ? initialDraft.relayUrl : "",
  );
  const [localRelay, setLocalRelay] = useState<LocalRelayDiscovery>({
    status: "checking",
  });
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
  useEffect(() => {
    preloadWorkspaceOnboardingApps();
    let cancelled = false;
    void preloadLocalRelayDiscovery().then((discovery) => {
      if (cancelled) return;
      setLocalRelay(discovery);
      if (discovery.status === "found") {
        setSelfHostedRelayUrl((current) =>
          current.trim() ? current : discovery.connection.relayUrl,
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (mode === "create") {
      window.sessionStorage.removeItem(pendingCreateRelayKey);
      window.sessionStorage.removeItem(pendingCreateDraftKey);
    }
  }, [mode]);

  const recordOnboardingEvent = useCallback(
    (
      event: OnboardingTelemetryEvent["event"],
      stage: OnboardingStage,
      details: Partial<OnboardingTelemetryEvent> = {},
    ) => {
      if (!relay.client) return;
      void relay.client
        .recordOnboardingEvent({
          sessionId: commandIdSchema.parse(createCommandId),
          stage,
          event,
          ...details,
        })
        .catch((error: unknown) => {
          console.warn("[Onboarding] Telemetry delivery failed:", error);
        });
    },
    [createCommandId, relay.client],
  );

  useEffect(() => {
    const stage = onboardingStage(mode, createStep);
    if (!stage) return;
    const viewKey = `${mode}:${createStep}`;
    if (lastViewedStage.current === viewKey) return;
    lastViewedStage.current = viewKey;
    recordOnboardingEvent("viewed", stage);
  }, [createStep, mode, recordOnboardingEvent]);

  useEffect(() => {
    if (mode !== "create") return;
    const draft = workspaceDraft({
      commandId: createCommandId,
      step: createStep,
      name,
      website,
      provider,
      selectedApps: Array.from(selectedApps).sort(),
      hosting,
      relayUrl: selectedRelayUrl,
    });
    window.localStorage.setItem(createDraftKey, JSON.stringify(draft));
  }, [
    createCommandId,
    createDraftKey,
    createStep,
    hosting,
    mode,
    name,
    provider,
    selectedApps,
    selectedRelayUrl,
    website,
  ]);

  const returnToWorkspaceHome = useCallback(() => {
    setActionError(null);
    setForeignRelay(null);
    setInvitePreview(null);
    setMode("home");
  }, []);

  const leaveCreateFlow = useCallback(() => {
    window.localStorage.removeItem(createDraftKey);
    setCreateCommandId(crypto.randomUUID());
    setCreateStep(0);
    setName("");
    setWebsite("");
    setProvider("opencode");
    setSelectedApps(new Set());
    setHosting(USING_CUSTOM_RELAY ? "self-hosted" : "chief-cloud");
    setSelectedRelayUrl(activeRelayUrl);
    returnToWorkspaceHome();
  }, [activeRelayUrl, createDraftKey, returnToWorkspaceHome]);

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

  const canReturnToWorkspace =
    relay.snapshot !== null ||
    knownWorkspacesForRelayIdentities(connectedRelayIdentities()).length > 0;

  const preserveDraftAcrossRelaySwitch = useCallback(
    (nextHosting: WorkspaceHosting, nextRelayUrl: string) => {
      window.sessionStorage.setItem(
        pendingCreateDraftKey,
        JSON.stringify(
          workspaceDraft({
            commandId: createCommandId,
            step: createStep,
            name,
            website,
            provider,
            selectedApps: Array.from(selectedApps).sort(),
            hosting: nextHosting,
            relayUrl: nextRelayUrl,
          }),
        ),
      );
    },
    [createCommandId, createStep, name, provider, selectedApps, website],
  );

  const createOnChiefHosted = useCallback(async () => {
    if (isWorking) return;
    setActionError(null);
    const relayUrl = new URL(CHIEF_CLOUD_RELAY_URL).origin;
    setHosting("chief-cloud");
    setSelectedRelayUrl(relayUrl);
    if (new URL(RELAY_URL).origin === new URL(CHIEF_CLOUD_RELAY_URL).origin) {
      return;
    }
    setIsWorking(true);
    preserveDraftAcrossRelaySwitch("chief-cloud", relayUrl);
    window.sessionStorage.setItem(
      pendingCreateRelayKey,
      new URL(CHIEF_CLOUD_RELAY_URL).origin,
    );
    try {
      await auth.connectRelay({
        version: 1,
        relayUrl: new URL(CHIEF_CLOUD_RELAY_URL).origin,
        authBaseUrl: new URL(CHIEF_CLOUD_AUTH_BASE_URL).origin,
        authUiUrl: new URL(CHIEF_CLOUD_AUTH_UI_URL).origin,
      });
    } catch (error) {
      window.sessionStorage.removeItem(pendingCreateRelayKey);
      window.sessionStorage.removeItem(pendingCreateDraftKey);
      setActionError(error instanceof Error ? error.message : String(error));
      setIsWorking(false);
    }
  }, [auth, isWorking, preserveDraftAcrossRelaySwitch]);

  const createOnSelfHosted = useCallback(async () => {
    if (isWorking || !selfHostedRelayUrl.trim()) return;
    setIsWorking(true);
    setActionError(null);
    try {
      const connection = await validateRelayConnection(
        selfHostedRelayUrl,
        isTauri() ? tauriFetch : fetch,
      );
      setHosting("self-hosted");
      setSelectedRelayUrl(connection.relayUrl);
      if (connection.relayUrl === new URL(RELAY_URL).origin) {
        setCreateStep(1);
        setMode("create");
        setIsWorking(false);
        return;
      }
      preserveDraftAcrossRelaySwitch("self-hosted", connection.relayUrl);
      window.sessionStorage.setItem(pendingCreateRelayKey, connection.relayUrl);
      await auth.connectRelay(connection);
    } catch (error) {
      window.sessionStorage.removeItem(pendingCreateRelayKey);
      window.sessionStorage.removeItem(pendingCreateDraftKey);
      setActionError(error instanceof Error ? error.message : String(error));
      setIsWorking(false);
    }
  }, [auth, isWorking, preserveDraftAcrossRelaySwitch, selfHostedRelayUrl]);

  const createWorkspace = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmedName = name.trim();
      if (!trimmedName || isWorking) return;
      if (!provider) {
        setActionError("Choose an inference provider before continuing.");
        return;
      }
      if (new URL(selectedRelayUrl).origin !== activeRelayUrl) {
        setActionError(
          "Reconnect the selected relay before creating this workspace.",
        );
        return;
      }
      setIsWorking(true);
      setActionError(null);
      try {
        recordOnboardingEvent("advanced", "apps", {
          hosting,
          provider,
          selectedAppCount: selectedApps.size,
        });
        const snapshot = await relay.createWorkspace(
          createWorkspaceCommandSchema.parse({
            commandId: createCommandId,
            name: trimmedName,
            website: website.trim(),
            runtime: "cloud",
            inferenceProvider: provider,
            inferenceModel: "auto",
            selectedApps: Array.from(selectedApps).sort(),
          }),
          apiKey,
        );
        recordOnboardingEvent("completed", "workspace-create", {
          hosting,
          provider,
          selectedAppCount: selectedApps.size,
          workspaceId: snapshot.id,
        });
        window.localStorage.removeItem(createDraftKey);
        void navigate("/", { replace: true });
      } catch (error) {
        recordOnboardingEvent("failed", "workspace-create", {
          hosting,
          provider,
          selectedAppCount: selectedApps.size,
          errorCode:
            error instanceof RelayClientError
              ? (error.code ?? `http_${error.status}`)
              : "client_error",
        });
        setActionError(error instanceof Error ? error.message : String(error));
        setIsWorking(false);
      }
    },
    [
      apiKey,
      activeRelayUrl,
      createCommandId,
      createDraftKey,
      hosting,
      isWorking,
      name,
      navigate,
      provider,
      recordOnboardingEvent,
      relay,
      selectedApps,
      selectedRelayUrl,
      website,
    ],
  );

  const prepareInvite = useCallback(async () => {
    setIsWorking(true);
    setActionError(null);
    try {
      const parsed = parseWorkspaceInvite(invite);
      if (parsed.relayUrl !== new URL(RELAY_URL).origin) {
        setForeignRelay({
          relayUrl: parsed.relayUrl,
          invitation: invite.trim(),
          kind: "link",
        });
        return;
      }
      const preview = await relay.previewWorkspaceInvite(
        parsed.workspaceId,
        parsed.secret,
      );
      setInvitePreview({
        workspaceId: preview.workspaceId,
        workspaceName: preview.workspaceName,
        conversationName: preview.conversationName,
        secret: parsed.secret,
      });
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
      const connection = await validateRelayConnection(
        foreignRelay.relayUrl,
        isTauri() ? tauriFetch : fetch,
      );
      if (foreignRelay.kind === "organization") {
        storePendingOrganizationInvitation(
          parseOrganizationInvitationUrl(foreignRelay.invitation),
        );
      } else {
        window.sessionStorage.setItem(
          pendingInviteKey,
          foreignRelay.invitation,
        );
      }
      saveStoredRelayConnection(connection);
      window.location.assign("/");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
      setIsWorking(false);
    }
  }, [foreignRelay, isWorking]);

  useEffect(() => {
    const invitation = organizationEntry.invitation;
    if (invitation?.relayUrl !== new URL(RELAY_URL).origin) return;
    storePendingOrganizationInvitation(invitation);
    window.location.assign("/");
  }, [organizationEntry.invitation]);

  const joinWorkspace = useCallback(async () => {
    if (!invitePreview) return;
    setIsWorking(true);
    setActionError(null);
    try {
      const result = await relay.claimWorkspaceInvite(
        invitePreview.workspaceId,
        invitePreview.secret,
      );
      window.sessionStorage.removeItem(pendingInviteKey);
      window.location.assign(
        result.conversationId
          ? `/conversations?channel=${encodeURIComponent(result.conversationId)}`
          : "/",
      );
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
      setIsWorking(false);
    }
  }, [invitePreview, relay]);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="bg-background text-foreground flex h-screen overflow-hidden">
        <UserIndicator user={auth.user} onSignOut={() => auth.signOut()} />
        <div className="bg-background flex min-w-0 flex-1 flex-col">
          {mode === "create" || mode === "hosting" ? (
            <WorkspaceProgress step={createStep} />
          ) : null}
          <header data-tauri-drag-region className="h-[72px] shrink-0" />
          <main className="flex min-h-0 flex-1 overflow-y-auto px-6 pb-10">
            <div className="mx-auto flex min-h-full w-full max-w-[560px] flex-col justify-center py-12">
              {mode === "home" ? (
                <WorkspaceHome
                  onBack={
                    canReturnToWorkspace
                      ? () => void returnToExistingWorkspace()
                      : undefined
                  }
                  onCreate={() => {
                    recordOnboardingEvent("advanced", "workspace-home");
                    setActionError(null);
                    setCreateStep(0);
                    setMode("create");
                  }}
                  onJoin={() => {
                    setActionError(null);
                    setMode("join");
                  }}
                />
              ) : mode === "hosting" ? (
                <WorkspaceHostingChoice
                  relayUrl={selfHostedRelayUrl}
                  localRelay={localRelay}
                  working={isWorking}
                  error={actionError}
                  onRelayUrlChange={setSelfHostedRelayUrl}
                  onBack={() => setMode("create")}
                  onSelfHosted={() => void createOnSelfHosted()}
                />
              ) : mode === "join" ? (
                <button
                  type="button"
                  onClick={returnToWorkspaceHome}
                  disabled={isWorking}
                  className="text-muted-foreground hover:text-foreground mb-8 flex w-fit items-center gap-1.5 text-[13px] transition-colors disabled:opacity-50"
                >
                  <ArrowLeft size={14} />
                  Back
                </button>
              ) : null}

              {mode === "create" ? (
                <CreateForm
                  name={name}
                  website={website}
                  provider={provider}
                  apiKey={apiKey}
                  selectedApps={selectedApps}
                  working={isWorking}
                  connected={relay.client !== null}
                  hosting={hosting}
                  relayUrl={selectedRelayUrl}
                  relayConnected={
                    relay.client !== null &&
                    new URL(selectedRelayUrl).origin === activeRelayUrl
                  }
                  error={actionError}
                  step={createStep}
                  onNameChange={setName}
                  onWebsiteChange={setWebsite}
                  onChiefCloud={() => void createOnChiefHosted()}
                  onSelfHosted={() => {
                    setMode("hosting");
                  }}
                  onProviderChange={(nextProvider) => {
                    setProvider(nextProvider);
                    setApiKey("");
                  }}
                  onApiKeyChange={setApiKey}
                  onSelectedAppsChange={setSelectedApps}
                  onStepChange={(nextStep) => {
                    recordOnboardingEvent(
                      "advanced",
                      onboardingStage("create", createStep) ??
                        "workspace-profile",
                      {
                        hosting,
                        provider: provider ?? undefined,
                        selectedAppCount: selectedApps.size,
                      },
                    );
                    setCreateStep(nextStep);
                  }}
                  onBackToHome={leaveCreateFlow}
                  onSubmit={createWorkspace}
                />
              ) : null}

              {mode === "join" && foreignRelay ? (
                <ForeignRelayInvite
                  relayUrl={foreignRelay.relayUrl}
                  working={isWorking}
                  error={actionError}
                  onCancel={() => {
                    setForeignRelay(null);
                    setActionError(null);
                  }}
                  onContinue={() => void connectToInviteRelay()}
                />
              ) : mode === "join" ? (
                <JoinForm
                  invite={invite}
                  preview={invitePreview}
                  working={isWorking}
                  connected={relay.client !== null}
                  onInviteChange={(value) => {
                    setInvite(value);
                    setInvitePreview(null);
                    setForeignRelay(null);
                  }}
                  onPrepare={() => void prepareInvite()}
                  onJoin={() => void joinWorkspace()}
                />
              ) : null}
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
