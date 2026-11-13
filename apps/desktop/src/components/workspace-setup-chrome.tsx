import { X } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { connectedRelayIdentities } from "../lib/auth/account-directory";
import { useAuth } from "../lib/auth/auth-context";
import { RELAY_URL } from "../lib/config";
import { knownWorkspacesForRelayIdentities } from "../lib/relay-connection";
import { useRelaySession } from "../lib/relay-session";
import { exitWorkspaceSetup } from "../lib/workspace-entry";
import { previousWorkspaceSwitch } from "../lib/workspace-switch-state";
import {
  forgetActiveWorkspaceSetup,
  readSetupDraft,
  workspaceSetupDraftKey,
} from "../pages/onboarding/model";
import { AvatarImage } from "./avatar-image";

export function useExitWorkspaceSetup() {
  const { user } = useAuth();
  const relay = useRelaySession();
  const navigate = useNavigate();
  return async () => {
    if (user) {
      const key = `chief.workspace-setup.v1:${RELAY_URL}:${user.id}`;
      const draft = readSetupDraft(key);
      if (draft.workspaceId)
        localStorage.setItem(
          workspaceSetupDraftKey(key, draft.workspaceId),
          JSON.stringify(draft),
        );
      localStorage.removeItem(key);
      forgetActiveWorkspaceSetup();
      exitWorkspaceSetup(
        sessionStorage,
        RELAY_URL,
        user.id,
        relay.snapshot?.id ?? null,
      );
      if (relay.snapshot?.setupComplete === false) {
        const previous = previousWorkspaceSwitch(user.id);
        const choices = knownWorkspacesForRelayIdentities(
          connectedRelayIdentities(),
        )
          .filter(
            (workspace) =>
              workspace.summary.id !== relay.snapshot?.id ||
              workspace.relayUrl !== new URL(RELAY_URL).origin,
          )
          .sort(
            (left, right) =>
              Number(
                right.summary.id === previous?.workspaceId &&
                  right.relayUrl === previous.relayUrl,
              ) -
              Number(
                left.summary.id === previous?.workspaceId &&
                  left.relayUrl === previous.relayUrl,
              ),
          );
        let target: (typeof choices)[number] | undefined;
        for (const workspace of choices) {
          if (
            workspace.relayUrl === new URL(RELAY_URL).origin &&
            relay.client
          ) {
            try {
              const snapshot = await relay.client
                .forWorkspace(workspace.summary.id)
                .setupSnapshot();
              if (snapshot.setupComplete === false) continue;
            } catch {
              continue;
            }
          } else if (!workspace.summary.onboardingComplete) continue;
          target = workspace;
          break;
        }
        if (target) {
          try {
            await relay.switchWorkspace(target.summary.id, target);
          } catch (error) {
            toast.error(
              error instanceof Error
                ? error.message
                : "Could not return to your previous workspace.",
            );
            return;
          }
        } else {
          void navigate("/workspaces", { replace: true });
          return;
        }
      }
    }
    void navigate("/", { replace: true });
  };
}

/** Matches Program's quiet account indicator, with Chief's square avatar. */
export function WorkspaceSetupChrome({ onExit }: { onExit?: () => void }) {
  const { signOut, user } = useAuth();
  const label = (user?.name.trim() ?? "") || (user?.email ?? "");
  return (
    <div
      className="absolute top-10 right-4 left-4 z-40 flex items-center justify-between gap-4"
      data-tauri-drag-region="false"
    >
      <div className="flex min-w-0 items-center gap-2 text-[13px]">
        <span className="bg-muted text-muted-foreground grid size-7 shrink-0 place-items-center overflow-hidden rounded-lg border text-[11px] font-medium">
          <AvatarImage
            src={user?.image}
            fallback={label.charAt(0).toUpperCase()}
            className="size-full object-cover"
          />
        </span>
        <span className="text-muted-foreground max-w-[180px] truncate">
          {label}
        </span>
        <span className="text-muted-foreground/40">·</span>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground cursor-pointer"
          onClick={() => signOut()}
        >
          Sign out
        </button>
      </div>
      {onExit ? (
        <button
          type="button"
          aria-label="Exit onboarding"
          title="Exit onboarding"
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 items-center justify-center rounded-lg transition-colors"
          onClick={onExit}
        >
          <X size={17} />
        </button>
      ) : null}
    </div>
  );
}
