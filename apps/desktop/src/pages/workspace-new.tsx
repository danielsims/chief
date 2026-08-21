import { useCallback, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router";

import { createWorkspaceCommandSchema } from "@chief/relay-contracts";

import { useAuth } from "../lib/auth/auth-context";
import { RELAY_URL } from "../lib/config";
import { useRelaySession } from "../lib/relay-session";
import {
  AccountIndicator,
  ConnectionNotice,
  CreateForm,
  ExistingWorkspaces,
  JoinForm,
  WorkspaceHome,
} from "./workspace-new-components";

type PageMode = "home" | "existing" | "create" | "join";

export function CreateWorkspacePage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const relay = useRelaySession();
  const incomingInvite =
    new URLSearchParams(window.location.search).get("invite") ?? "";
  const [mode, setMode] = useState<PageMode>(incomingInvite ? "join" : "home");
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [invite, setInvite] = useState(incomingInvite);
  const [invitePreview, setInvitePreview] = useState<{
    workspaceId: string;
    workspaceName: string;
    conversationName: string | null;
    secret: string;
  } | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const connectionError = actionError ?? relay.error;

  const closePage = useCallback(() => {
    if (relay.snapshot) {
      void navigate("/");
      return;
    }
    setMode("home");
  }, [navigate, relay.snapshot]);

  const selectWorkspace = useCallback(
    async (workspaceId: string) => {
      if (switchingTo) return;
      setSwitchingTo(workspaceId);
      setActionError(null);
      try {
        await relay.switchWorkspace(workspaceId);
        window.location.assign("/");
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
        setSwitchingTo(null);
      }
    },
    [relay, switchingTo],
  );

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
            inferenceProvider: "unconfigured",
            inferenceModel: "unconfigured",
            selectedApps: [],
          }),
        );
        window.location.assign("/");
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
        setIsWorking(false);
      }
    },
    [isWorking, name, relay, website],
  );

  const prepareInvite = useCallback(async () => {
    setIsWorking(true);
    setActionError(null);
    try {
      const parsed = parseWorkspaceInvite(invite);
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

  const joinWorkspace = useCallback(async () => {
    if (!invitePreview) return;
    setIsWorking(true);
    setActionError(null);
    try {
      const result = await relay.claimWorkspaceInvite(
        invitePreview.workspaceId,
        invitePreview.secret,
      );
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
      <header data-tauri-drag-region className="h-[72px] shrink-0" />
      <main className="flex min-h-0 flex-1 overflow-y-auto px-6 pb-10">
        <div className="mx-auto flex min-h-full w-full max-w-[560px] flex-col justify-center py-12">
          {mode === "home" ? (
            <WorkspaceHome
              hasWorkspaces={relay.workspaces.length > 0}
              onExisting={() => {
                setActionError(null);
                setMode("existing");
              }}
              onCreate={() => {
                setActionError(null);
                setMode("create");
              }}
              onJoin={() => {
                setActionError(null);
                setMode("join");
              }}
            />
          ) : (
            <button
              type="button"
              onClick={closePage}
              disabled={isWorking}
              className="text-muted-foreground hover:text-foreground mb-8 flex w-fit items-center gap-1.5 text-[13px] transition-colors disabled:opacity-50"
            >
              <ArrowLeft size={14} />
              Back
            </button>
          )}

          {mode === "create" ? (
            <CreateForm
              name={name}
              website={website}
              working={isWorking}
              connected={relay.client !== null}
              onNameChange={setName}
              onWebsiteChange={setWebsite}
              onSubmit={createWorkspace}
            />
          ) : null}

          {mode === "existing" ? (
            <ExistingWorkspaces
              workspaces={relay.workspaces}
              switchingTo={switchingTo}
              onSelect={selectWorkspace}
            />
          ) : null}

          {mode === "join" ? (
            <JoinForm
              invite={invite}
              preview={invitePreview}
              working={isWorking}
              connected={relay.client !== null}
              onInviteChange={(value) => {
                setInvite(value);
                setInvitePreview(null);
              }}
              onPrepare={() => void prepareInvite()}
              onJoin={() => void joinWorkspace()}
            />
          ) : null}

          {connectionError ? (
            <ConnectionNotice
              message={connectionError}
              retrying={relay.loading}
              onRetry={() => void relay.refresh()}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}

function parseWorkspaceInvite(value: string) {
  const url = new URL(value.trim());
  if (url.username || url.password || url.hash)
    throw new Error("This invitation link is not valid.");
  if (url.protocol === "chief-desktop:" && url.hostname === "join") {
    const relay = new URL(url.searchParams.get("relay") ?? "");
    if (relay.origin !== new URL(RELAY_URL).origin) {
      throw new Error("Add this invitation’s Chief relay before joining.");
    }
    return inviteParts(
      url.searchParams.get("workspace") ?? "",
      url.searchParams.get("code") ?? "",
    );
  }
  if (url.origin !== new URL(RELAY_URL).origin) {
    throw new Error("Add this invitation’s Chief relay before joining.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "invite") {
    throw new Error("Paste a Chief workspace invitation link.");
  }
  return inviteParts(parts[1] ?? "", parts[2] ?? "");
}

function inviteParts(workspaceId: string, secret: string) {
  if (
    !workspaceId.startsWith("workspace-") ||
    !/^[A-Za-z0-9_-]{43,128}$/u.test(secret)
  ) {
    throw new Error("This invitation link is not valid.");
  }
  return { workspaceId, secret };
}
