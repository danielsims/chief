import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "@chief/ui/components/button";
import {
  HandoffCard,
  HandoffHeading,
  handoffPrimaryClassName,
} from "@chief/ui/components/handoff-card";
import { cn } from "@chief/ui/lib/utils";

import { workspaceRecoveryMessage } from "../lib/workspace-recovery";
import { ChiefMark } from "./chief-mark";
import { OrgLogo } from "./org-logo";

export interface RecoveryWorkspace {
  id: string;
  name: string;
  relayUrl: string;
  accountId: string;
  logo?: string | null;
  website?: string;
}

export function WorkspaceUnavailableCard({
  status,
  loading,
  workspaces,
  onRetry,
  onSelect,
  onSignIn,
  connectionSettings,
}: {
  status?: number;
  loading: boolean;
  workspaces: RecoveryWorkspace[];
  onRetry: () => Promise<void>;
  onSelect: (workspace: RecoveryWorkspace) => Promise<void>;
  onSignIn: () => void;
  connectionSettings: ReactNode;
}) {
  const [choosing, setChoosing] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const busy = loading || retrying || switchingTo !== null;
  const run = async (action: () => Promise<void>, workspaceKey?: string) => {
    if (busy) return;
    if (workspaceKey) setSwitchingTo(workspaceKey);
    else setRetrying(true);
    setActionError(null);
    try {
      await action();
    } catch {
      setActionError("We couldn’t connect to this workspace.");
    } finally {
      setSwitchingTo(null);
      setRetrying(false);
    }
  };
  return (
    <HandoffCard brand={<ChiefMark />} className="min-h-full bg-transparent">
      <HandoffHeading
        title={choosing ? "Choose a workspace" : "Workspace unavailable"}
      />
      {choosing ? (
        <>
          <div className="mt-6 max-h-[45vh] space-y-1 overflow-y-auto">
            {workspaces.map((workspace) => {
              const key = `${workspace.relayUrl}:${workspace.accountId}:${workspace.id}`;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => onSelect(workspace), key)}
                  className="group/workspace hover:bg-accent flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left text-base transition-colors disabled:opacity-50"
                >
                  <OrgLogo
                    name={workspace.name}
                    logo={workspace.logo}
                    website={workspace.website ?? ""}
                    className="size-8 shrink-0 rounded-[8px] text-base"
                    imgClassName="object-contain"
                    transparentWhenLoaded
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {workspace.name}
                  </span>
                  {switchingTo === key ? (
                    <span
                      role="status"
                      className="text-muted-foreground text-base"
                    >
                      Opening…
                    </span>
                  ) : null}
                </button>
              );
            })}
            {!workspaces.length ? (
              <p className="text-muted-foreground py-2 text-base leading-6">
                No saved workspaces available.
              </p>
            ) : null}
          </div>
          {connectionSettings}
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setChoosing(false);
              setActionError(null);
            }}
            className="mt-6 h-[39px] w-full rounded-lg text-base"
          >
            Back
          </Button>
        </>
      ) : (
        <>
          <p className="text-muted-foreground mt-3 text-base leading-6">
            {workspaceRecoveryMessage(status)}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(onRetry)}
            className={cn(handoffPrimaryClassName, "text-base")}
          >
            {busy ? "Connecting…" : "Try again"}
          </button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setChoosing(true);
              setActionError(null);
            }}
            className="mt-3 h-[39px] w-full rounded-lg text-base"
          >
            Change workspace
          </Button>
          {status === 401 || status === 403 ? (
            <button
              type="button"
              onClick={onSignIn}
              disabled={busy}
              className="text-muted-foreground hover:text-foreground mt-2 flex h-10 w-full items-center justify-center text-base"
            >
              Sign in again
            </button>
          ) : null}
        </>
      )}
      {actionError ? (
        <p role="alert" className="text-destructive mt-3 text-base leading-6">
          {actionError}
        </p>
      ) : null}
    </HandoffCard>
  );
}
