import { useCallback, useEffect, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router";

import { createWorkspaceCommandSchema } from "@chief/relay-contracts";

import { useAuth } from "../lib/auth/auth-context";
import {
  CHIEF_CLOUD_AUTH_BASE_URL,
  CHIEF_CLOUD_AUTH_UI_URL,
  CHIEF_CLOUD_RELAY_URL,
  RELAY_URL,
} from "../lib/config";
import {
  parseOrganizationInvitationUrl,
  storePendingOrganizationInvitation,
} from "../lib/organization-invitation";
import {
  saveStoredRelayConnection,
  validateRelayConnection,
} from "../lib/relay-connection";
import { useRelaySession } from "../lib/relay-session";
import {
  pendingCreateRelayKey,
  shouldResumeWorkspaceCreate,
} from "../lib/workspace-entry";
import {
  createWorkspaceDraftKey,
  readCreateWorkspaceDraft,
  workspaceDraft,
} from "./workspace-create-draft";
import { preloadWorkspaceOnboardingApps } from "./workspace-create-options";
import {
  AccountIndicator,
  WorkspaceHome,
  WorkspaceProgress,
} from "./workspace-new-chrome";
import { CreateForm, JoinForm } from "./workspace-new-components";
import {
  ForeignRelayInvite,
  parseIncomingOrganizationInvitation,
  parseWorkspaceInvite,
  WorkspaceHostingChoice,
} from "./workspace-new-supplementary";

type PageMode = "home" | "hosting" | "create" | "join";
const pendingInviteKey = "chief.pending-workspace-invite.v1";
export function CreateWorkspacePage() {
  const auth = useAuth();
  const relay = useRelaySession();
  const navigate = useNavigate();
  const createDraftKey = useMemo(
    () => createWorkspaceDraftKey(RELAY_URL, auth.user?.id),
    [auth.user?.id],
  );
  const initialDraft = useMemo(
    () => readCreateWorkspaceDraft(createDraftKey),
    [createDraftKey],
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
  const resumesWorkspaceCreate = shouldResumeWorkspaceCreate(
    window.sessionStorage.getItem(pendingCreateRelayKey),
    RELAY_URL,
  );
  const [mode, setMode] = useState<PageMode>(
    incomingInvite || organizationEntry.invitation
      ? "join"
      : initialDraft || resumesWorkspaceCreate
        ? "create"
        : "home",
  );
  const [createStep, setCreateStep] = useState(initialDraft?.step ?? 0);
  const [name, setName] = useState(initialDraft?.name ?? "");
  const [website, setWebsite] = useState(initialDraft?.website ?? "");
  const [runtime, setRuntime] = useState<"cloud" | "desktop">(
    initialDraft?.runtime ?? "cloud",
  );
  const [provider, setProvider] = useState<
    "claude" | "codex" | "opencode" | null
  >(initialDraft?.provider ?? "opencode");
  const [model, setModel] = useState(
    initialDraft?.model ?? "opencode-go/deepseek-v4-flash",
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
  const [selfHostedRelayUrl, setSelfHostedRelayUrl] = useState("");
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
  }, []);

  useEffect(() => {
    if (mode === "create") {
      window.sessionStorage.removeItem(pendingCreateRelayKey);
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "create") return;
    const draft = workspaceDraft({
      step: createStep,
      name,
      website,
      runtime,
      provider,
      model,
      selectedApps: Array.from(selectedApps).sort(),
    });
    window.localStorage.setItem(createDraftKey, JSON.stringify(draft));
  }, [
    createDraftKey,
    createStep,
    mode,
    model,
    name,
    provider,
    runtime,
    selectedApps,
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
    setCreateStep(0);
    setName("");
    setWebsite("");
    setRuntime("cloud");
    setProvider("opencode");
    setModel("opencode-go/deepseek-v4-flash");
    setSelectedApps(new Set());
    returnToWorkspaceHome();
  }, [createDraftKey, returnToWorkspaceHome]);

  const createOnChiefHosted = useCallback(async () => {
    if (isWorking) return;
    setActionError(null);
    if (new URL(RELAY_URL).origin === new URL(CHIEF_CLOUD_RELAY_URL).origin) {
      setCreateStep(0);
      setMode("create");
      return;
    }
    setIsWorking(true);
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
      setActionError(error instanceof Error ? error.message : String(error));
      setIsWorking(false);
    }
  }, [auth, isWorking]);

  const createOnSelfHosted = useCallback(async () => {
    if (isWorking || !selfHostedRelayUrl.trim()) return;
    setIsWorking(true);
    setActionError(null);
    try {
      const connection = await validateRelayConnection(
        selfHostedRelayUrl,
        isTauri() ? tauriFetch : fetch,
      );
      if (connection.relayUrl === new URL(RELAY_URL).origin) {
        setCreateStep(0);
        setMode("create");
        setIsWorking(false);
        return;
      }
      window.sessionStorage.setItem(pendingCreateRelayKey, connection.relayUrl);
      await auth.connectRelay(connection);
    } catch (error) {
      window.sessionStorage.removeItem(pendingCreateRelayKey);
      setActionError(error instanceof Error ? error.message : String(error));
      setIsWorking(false);
    }
  }, [auth, isWorking, selfHostedRelayUrl]);

  const createWorkspace = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmedName = name.trim();
      if (!trimmedName || isWorking) return;
      setIsWorking(true);
      setActionError(null);
      try {
        await relay.createWorkspace(
          createWorkspaceCommandSchema.parse({
            commandId: crypto.randomUUID(),
            name: trimmedName,
            website: website.trim(),
            runtime,
            inferenceProvider: provider,
            inferenceModel: model || "auto",
            selectedApps: Array.from(selectedApps).sort(),
          }),
          apiKey,
        );
        window.localStorage.removeItem(createDraftKey);
        void navigate("/", { replace: true });
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
        setIsWorking(false);
      }
    },
    [
      apiKey,
      createDraftKey,
      isWorking,
      model,
      name,
      navigate,
      provider,
      relay,
      runtime,
      selectedApps,
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
    <div className="bg-background text-foreground flex h-screen flex-col">
      <AccountIndicator
        user={auth.user}
        onSignOut={auth.signOut}
        disabled={isWorking}
      />
      {mode === "create" ? <WorkspaceProgress step={createStep} /> : null}
      <header data-tauri-drag-region className="h-[72px] shrink-0" />
      <main className="flex min-h-0 flex-1 overflow-y-auto px-6 pb-10">
        <div
          className={`mx-auto flex min-h-full w-full max-w-[560px] flex-col ${mode === "create" ? "justify-start pt-20 pb-12" : "justify-center py-12"}`}
        >
          {mode === "home" ? (
            <WorkspaceHome
              onCreate={() => {
                setActionError(null);
                setMode("hosting");
              }}
              onJoin={() => {
                setActionError(null);
                setMode("join");
              }}
            />
          ) : mode === "hosting" ? (
            <WorkspaceHostingChoice
              relayUrl={selfHostedRelayUrl}
              working={isWorking}
              error={actionError}
              onRelayUrlChange={setSelfHostedRelayUrl}
              onBack={returnToWorkspaceHome}
              onChiefHosted={() => void createOnChiefHosted()}
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
              runtime={runtime}
              provider={provider}
              model={model}
              apiKey={apiKey}
              selectedApps={selectedApps}
              working={isWorking}
              connected={relay.client !== null}
              step={createStep}
              onNameChange={setName}
              onWebsiteChange={setWebsite}
              onRuntimeChange={(value) => {
                setRuntime(value);
                setProvider("opencode");
                setModel("opencode-go/deepseek-v4-flash");
              }}
              onProviderChange={setProvider}
              onModelChange={setModel}
              onApiKeyChange={setApiKey}
              onSelectedAppsChange={setSelectedApps}
              onStepChange={setCreateStep}
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
  );
}
