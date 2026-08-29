import { useCallback, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router";

import { isJsonString } from "@chief/relay-contracts";
import { Popover, PopoverAnchor } from "@chief/ui/components/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@chief/ui/components/tooltip";
import { cn } from "@chief/ui/lib/utils";

import type { AuthOrganization } from "../lib/auth/better-auth-client";
import type { ConnectedWorkspace } from "../lib/relay-connection";
import { connectedRelayIdentities } from "../lib/auth/account-directory";
import { useAuth } from "../lib/auth/auth-context";
import { parseOrganizationMetadata } from "../lib/auth/better-auth-client";
import { useChannelReadState } from "../lib/channel-read-state-context";
import { RELAY_URL } from "../lib/config";
import { knownWorkspacesForRelayIdentities } from "../lib/relay-connection";
import { useRelaySession } from "../lib/relay-session";
import { OrgLogo } from "./org-logo";
import {
  nextWorkspaceMenuId,
  WorkspaceActionsPopover,
} from "./workspace-action-menu";

export function WorkspaceRail() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { workspaceUnreadCounts } = useChannelReadState();
  const relay = useRelaySession();
  const cloudOrganizationId = relay.snapshot?.id ?? null;
  const workspaceLocations = knownWorkspacesForRelayIdentities(
    connectedRelayIdentities(),
  );
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [workspaceMenuId, setWorkspaceMenuId] = useState<string | null>(null);

  const orderedWorkspaces = useMemo(
    () =>
      [...workspaceLocations]
        .sort(
          (left, right) =>
            Number(isActiveWorkspace(right, cloudOrganizationId)) -
            Number(isActiveWorkspace(left, cloudOrganizationId)),
        )
        .map((location) => ({
          location,
          organization: relayWorkspaceOrganization(location),
        })),
    [cloudOrganizationId, workspaceLocations],
  );
  const switchWorkspace = useCallback(
    async (organization: AuthOrganization, location: ConnectedWorkspace) => {
      if (isActiveWorkspace(location, cloudOrganizationId) || switchingTo)
        return;
      setSwitchingTo(organization.id);
      void navigate("/", { replace: true });
      try {
        await relay.switchWorkspace(organization.id, location);
      } catch (error) {
        console.error("[Workspace] Switch failed:", error);
        setSwitchingTo(null);
      }
    },
    [cloudOrganizationId, navigate, relay, switchingTo],
  );
  const openWorkspaceSettings = useCallback(
    async (organization: AuthOrganization, location: ConnectedWorkspace) => {
      setWorkspaceMenuId(null);
      if (isActiveWorkspace(location, cloudOrganizationId)) {
        void navigate("/settings/workspace");
        return;
      }
      if (switchingTo) return;
      setSwitchingTo(organization.id);
      try {
        await relay.switchWorkspace(organization.id, location);
        void navigate("/settings/workspace", { replace: true });
      } catch (error) {
        console.error("[Workspace] Switch failed:", error);
        setSwitchingTo(null);
      }
    },
    [cloudOrganizationId, navigate, relay, switchingTo],
  );

  if (!isAuthenticated) {
    return null;
  }

  return (
    <nav
      aria-label="Workspaces"
      className="bg-sidebar relative z-50 flex w-12 shrink-0 flex-col items-center"
    >
      <div className="h-10 shrink-0" data-tauri-drag-region />
      <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto px-1.5 pt-1">
        {orderedWorkspaces.map(({ location, organization }) => {
          const active = isActiveWorkspace(location, cloudOrganizationId);
          const metadata = parseOrganizationMetadata(organization);
          const unreadCount = workspaceUnreadCounts.get(organization.id) ?? 0;
          return (
            <Popover
              key={`${location.relayUrl}:${organization.id}`}
              open={workspaceMenuId === workspaceMenuKey(location)}
              onOpenChange={(nextOpen) =>
                setWorkspaceMenuId((currentId) =>
                  nextWorkspaceMenuId(
                    currentId,
                    workspaceMenuKey(location),
                    nextOpen,
                  ),
                )
              }
            >
              <Tooltip
                delayDuration={0}
                open={
                  workspaceMenuId === workspaceMenuKey(location)
                    ? false
                    : undefined
                }
              >
                <PopoverAnchor asChild>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-current={active ? "page" : undefined}
                      aria-label={`${organization.name}${active ? ", current workspace" : ""}`}
                      disabled={switchingTo !== null}
                      onClick={() =>
                        void switchWorkspace(organization, location)
                      }
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setWorkspaceMenuId(workspaceMenuKey(location));
                      }}
                      className={cn(
                        "group relative size-8 shrink-0 rounded-[12px] transition-all outline-none hover:rounded-[9px] focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-50",
                        active && "rounded-[9px]",
                        switchingTo === organization.id && "opacity-50",
                      )}
                    >
                      <span
                        className={cn(
                          "bg-sidebar-foreground absolute top-1/2 -left-1.5 w-0.5 -translate-y-1/2 rounded-r-full transition-[height]",
                          active ? "h-5" : "h-0 group-hover:h-2",
                        )}
                      />
                      <OrgLogo
                        name={organization.name}
                        logo={organization.logo}
                        website={
                          isJsonString(metadata.websiteUrl)
                            ? metadata.websiteUrl
                            : ""
                        }
                        className="size-full rounded-[inherit] text-sm"
                        imgClassName="object-contain"
                        transparentWhenLoaded
                      />
                      {unreadCount > 0 ? (
                        <span
                          aria-label={`${unreadCount} unread ${unreadCount === 1 ? "message" : "messages"}`}
                          className="bg-destructive ring-sidebar absolute -top-1 -right-1 z-10 flex min-w-4 items-center justify-center rounded-full px-1 text-[9px] leading-4 font-semibold text-white tabular-nums ring-2"
                        >
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      ) : null}
                    </button>
                  </TooltipTrigger>
                </PopoverAnchor>
                <TooltipContent side="right">
                  {organization.name}
                  {active ? " · Current" : ""}
                </TooltipContent>
              </Tooltip>
              <WorkspaceActionsPopover
                showOpenWorkspace={!active}
                actionsDisabled={switchingTo !== null}
                onOpenWorkspace={() => {
                  setWorkspaceMenuId(null);
                  void switchWorkspace(organization, location);
                }}
                onWorkspaceSettings={() =>
                  void openWorkspaceSettings(organization, location)
                }
                workspaceName={organization.name}
                relayUrl={location.relayUrl}
              />
            </Popover>
          );
        })}
      </div>
      <div className="flex shrink-0 flex-col items-center gap-1.5 px-1.5 pb-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => void navigate("/workspaces/new?intent=add")}
              className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 items-center justify-center rounded-[10px] transition-colors"
              aria-label="Add a workspace"
            >
              <Plus size={15} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Add a workspace</TooltipContent>
        </Tooltip>
      </div>
    </nav>
  );
}

function relayWorkspaceOrganization(
  workspace: ConnectedWorkspace,
): AuthOrganization {
  return {
    id: workspace.summary.id,
    name: workspace.summary.name,
    slug: workspace.summary.id,
    logo: workspace.summary.imageURL,
    metadata: { websiteUrl: workspace.summary.website },
  };
}

function workspaceMenuKey(workspace: ConnectedWorkspace): string {
  return `${workspace.relayUrl}:${workspace.summary.id}`;
}

function isActiveWorkspace(
  workspace: ConnectedWorkspace,
  activeWorkspaceId: string | null,
): boolean {
  return (
    workspace.summary.id === activeWorkspaceId &&
    workspace.relayUrl === new URL(RELAY_URL).origin
  );
}
