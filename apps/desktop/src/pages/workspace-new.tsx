import { useCallback, useEffect, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { useNavigate } from "react-router";

import { createWorkspaceCommandSchema } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";

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
  WorkspaceAction,
  WorkspaceHome,
  WorkspaceProgress,
} from "./workspace-new-chrome";
import { CreateForm, JoinForm } from "./workspace-new-components";

type PageMode = "home" | "hosting" | "create" | "join";
const pendingInviteKey = "chief.pending-workspace-invite.v1";
const selfHostingGuideUrl =
  "https://github.com/danielsims/chief/blob/main/deploy/self-host/README.md";
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
  const [provider, setProvider] = useState<
    "claude" | "codex" | "opencode" | null
  >(initialDraft?.provider ?? null);
  const [model, setModel] = useState(initialDraft?.model ?? "auto");
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
    setProvider(null);
    setModel("auto");
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
            runtime: "mac",
            inferenceProvider: provider,
            inferenceModel: model || "auto",
            selectedApps: Array.from(selectedApps).sort(),
          }),
        );
        window.localStorage.removeItem(createDraftKey);
        void navigate("/", { replace: true });
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
        setIsWorking(false);
      }
    },
    [
      createDraftKey,
      isWorking,
      model,
      name,
      navigate,
      provider,
      relay,
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
              provider={provider}
              model={model}
              selectedApps={selectedApps}
              working={isWorking}
              connected={relay.client !== null}
              step={createStep}
              onNameChange={setName}
              onWebsiteChange={setWebsite}
              onProviderChange={setProvider}
              onModelChange={setModel}
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

function WorkspaceHostingChoice({
  relayUrl,
  working,
  error,
  onRelayUrlChange,
  onBack,
  onChiefHosted,
  onSelfHosted,
}: {
  relayUrl: string;
  working: boolean;
  error: string | null;
  onRelayUrlChange: (value: string) => void;
  onBack: () => void;
  onChiefHosted: () => void;
  onSelfHosted: () => void;
}) {
  const [selfHosted, setSelfHosted] = useState(false);
  if (selfHosted) {
    return (
      <section>
        <button
          type="button"
          onClick={() => setSelfHosted(false)}
          disabled={working}
          className="text-muted-foreground hover:text-foreground mb-8 flex items-center gap-1.5 text-[13px] transition-colors disabled:opacity-50"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <h1 className="text-[32px] leading-tight font-normal tracking-[-0.04em]">
          Connect your relay
        </h1>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          Deploy Chief on infrastructure you control, then connect this app to
          its public address.
        </p>

        <ol className="mt-8 space-y-4">
          <SelfHostingStep number="1">
            Install Docker, Node 24 and pnpm on your server, then clone Chief.
          </SelfHostingStep>
          <SelfHostingStep number="2">
            Run <InlineCode>pnpm self-host:init</InlineCode>, followed by{" "}
            <InlineCode>pnpm self-host:up</InlineCode>.
          </SelfHostingStep>
          <SelfHostingStep number="3">
            Confirm the relay health endpoint responds, then paste its public
            HTTPS address below.
          </SelfHostingStep>
        </ol>

        <button
          type="button"
          onClick={() => {
            if (isTauri()) void openUrl(selfHostingGuideUrl);
            else
              window.open(selfHostingGuideUrl, "_blank", "noopener,noreferrer");
          }}
          className="text-muted-foreground hover:text-foreground mt-5 inline-flex items-center gap-1.5 text-[13px] underline-offset-4 transition-colors hover:underline"
        >
          Read the self-hosting guide
          <ArrowUpRight size={13} />
        </button>

        <div className="mt-8 border-t pt-6">
          <label htmlFor="create-relay-url" className="text-[13px] font-medium">
            Relay address
          </label>
          <Input
            id="create-relay-url"
            value={relayUrl}
            onChange={(event) => onRelayUrlChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && relayUrl.trim()) onSelfHosted();
            }}
            placeholder="https://relay.example.com"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="mt-2"
            disabled={working}
            autoFocus
          />
          <div className="mt-4 flex justify-end">
            <Button
              type="button"
              onClick={onSelfHosted}
              disabled={working || !relayUrl.trim()}
              loading={working}
            >
              Connect relay
            </Button>
          </div>
        </div>
        {error ? (
          <p className="bg-destructive/5 text-destructive mt-4 rounded-lg px-3 py-2 text-xs leading-5">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section>
      <button
        type="button"
        onClick={onBack}
        disabled={working}
        className="text-muted-foreground hover:text-foreground mb-8 flex items-center gap-1.5 text-[13px] transition-colors disabled:opacity-50"
      >
        <ArrowLeft size={14} /> Back
      </button>
      <h1 className="text-[32px] leading-tight font-normal tracking-[-0.04em]">
        Where should Chief run?
      </h1>
      <p className="text-muted-foreground mt-2 text-sm leading-6">
        Choose managed hosting or connect infrastructure you control.
      </p>
      <div className="mt-8 space-y-2">
        <WorkspaceAction
          title="Chief hosted"
          description="Ready to use. Chief manages the relay and updates"
          onClick={onChiefHosted}
          disabled={working}
        />
        <WorkspaceAction
          title="Self-host"
          description="Deploy Chief on your own server and connect it here"
          onClick={() => setSelfHosted(true)}
          disabled={working}
        />
      </div>
      {error ? (
        <p className="bg-destructive/5 text-destructive mt-4 rounded-lg px-3 py-2 text-xs leading-5">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function SelfHostingStep({
  number,
  children,
}: {
  number: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 text-[13px] leading-5">
      <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium">
        {number}
      </span>
      <span className="text-muted-foreground pt-0.5">{children}</span>
    </li>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-muted text-foreground rounded px-1.5 py-0.5 font-mono text-[11px]">
      {children}
    </code>
  );
}

function parseIncomingOrganizationInvitation(value: string | null) {
  if (!value) return { invitation: null, error: null };
  try {
    return {
      invitation: parseOrganizationInvitationUrl(value),
      error: null,
    };
  } catch (error) {
    return {
      invitation: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseWorkspaceInvite(value: string) {
  const url = new URL(value.trim());
  if (url.username || url.password || url.hash)
    throw new Error("This invitation link is not valid.");
  if (
    ["chief:", "chief-mobile:", "chief-desktop:"].includes(url.protocol) &&
    url.hostname === "join"
  ) {
    const relay = new URL(url.searchParams.get("relay") ?? "");
    assertSafeRelayOrigin(relay);
    return inviteParts(
      url.searchParams.get("workspace") ?? "",
      url.searchParams.get("code") ?? "",
      relay.origin,
    );
  }
  assertSafeRelayOrigin(url);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "invite") {
    throw new Error("Paste a Chief workspace invitation link.");
  }
  return inviteParts(parts[1] ?? "", parts[2] ?? "", url.origin);
}

function inviteParts(workspaceId: string, secret: string, relayUrl: string) {
  if (
    !workspaceId.startsWith("workspace-") ||
    !/^[A-Za-z0-9_-]{43,128}$/u.test(secret)
  ) {
    throw new Error("This invitation link is not valid.");
  }
  return { workspaceId, secret, relayUrl };
}

function assertSafeRelayOrigin(url: URL) {
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" && !(local && url.protocol === "http:"))
  ) {
    throw new Error("This invitation points to an unsafe relay address.");
  }
}

function ForeignRelayInvite({
  relayUrl,
  working,
  error,
  onCancel,
  onContinue,
}: {
  relayUrl: string;
  working: boolean;
  error: string | null;
  onCancel: () => void;
  onContinue: () => void;
}) {
  return (
    <section>
      <h1 className="text-[32px] leading-tight font-normal tracking-[-0.04em]">
        Join this workspace?
      </h1>
      <p className="text-muted-foreground mt-2 text-sm leading-6">
        This invitation is hosted outside your current Chief connection.
      </p>
      <div className="mt-8 rounded-xl border px-4 py-4">
        <p className="text-sm font-medium">
          Check the relay before you continue
        </p>
        <p className="text-muted-foreground mt-2 font-mono text-xs break-all">
          {new URL(relayUrl).host}
        </p>
        <p className="text-muted-foreground mt-3 text-xs leading-5">
          Chief will verify this relay and ask you to authenticate with its
          account issuer. Your other relay connections stay on this device.
        </p>
      </div>
      {error ? <p className="text-destructive mt-4 text-xs">{error}</p> : null}
      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={working}
          className="text-muted-foreground hover:text-foreground px-3 py-2 text-sm"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={working}
          className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {working ? "Checking relay…" : "Continue"}
        </button>
      </div>
    </section>
  );
}
