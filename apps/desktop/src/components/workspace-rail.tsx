import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { Popover, PopoverAnchor } from "@chief/ui/components/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@chief/ui/components/tooltip";
import { cn } from "@chief/ui/lib/utils";

import type { AuthOrganization } from "../lib/auth/better-auth-client";
import { useAuth } from "../lib/auth/auth-context";
import { parseOrganizationMetadata } from "../lib/auth/better-auth-client";
import { useChannelReadState } from "../lib/channel-read-state-context";
import { useRelaySession } from "../lib/relay-session";
import { activeFirstOrganizations } from "../lib/workspace-organizations";
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
  const organizations = useMemo(
    () => relay.workspaces.map(relayWorkspaceOrganization),
    [relay.workspaces],
  );
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [workspaceMenuId, setWorkspaceMenuId] = useState<string | null>(null);

  const orderedOrganizations = useMemo(
    () => activeFirstOrganizations(organizations, cloudOrganizationId),
    [cloudOrganizationId, organizations],
  );
  const switchWorkspace = useCallback(
    async (organization: AuthOrganization) => {
      if (organization.id === cloudOrganizationId || switchingTo) return;
      setSwitchingTo(organization.id);
      try {
        await relay.switchWorkspace(organization.id);
        window.location.assign("/");
      } catch (error) {
        console.error("[Workspace] Switch failed:", error);
        setSwitchingTo(null);
      }
    },
    [cloudOrganizationId, relay, switchingTo],
  );
  const openWorkspaceSettings = useCallback(
    async (organization: AuthOrganization) => {
      setWorkspaceMenuId(null);
      if (organization.id === cloudOrganizationId) {
        void navigate("/settings/workspace");
        return;
      }
      if (switchingTo) return;
      setSwitchingTo(organization.id);
      try {
        await relay.switchWorkspace(organization.id);
        window.location.assign("/settings/workspace");
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
        {relay.loading ? (
          <span
            aria-hidden
            className="bg-sidebar-accent size-8 shrink-0 animate-pulse rounded-[11px]"
          />
        ) : null}
        {orderedOrganizations.map((organization) => {
          const active = organization.id === cloudOrganizationId;
          const metadata = parseOrganizationMetadata(organization);
          const unreadCount = workspaceUnreadCounts.get(organization.id) ?? 0;
          return (
            <Popover
              key={organization.id}
              open={workspaceMenuId === organization.id}
              onOpenChange={(nextOpen) =>
                setWorkspaceMenuId((currentId) =>
                  nextWorkspaceMenuId(currentId, organization.id, nextOpen),
                )
              }
            >
              <Tooltip
                delayDuration={0}
                open={workspaceMenuId === organization.id ? false : undefined}
              >
                <PopoverAnchor asChild>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-current={active ? "page" : undefined}
                      aria-label={`${organization.name}${active ? ", current workspace" : ""}`}
                      disabled={switchingTo !== null}
                      onClick={() => void switchWorkspace(organization)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setWorkspaceMenuId(organization.id);
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
                          typeof metadata.websiteUrl === "string"
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
                primaryLabel="Workspace settings"
                primaryDisabled={switchingTo !== null}
                onPrimaryAction={() => void openWorkspaceSettings(organization)}
                onAddWorkspace={() => {
                  setWorkspaceMenuId(null);
                  void navigate("/workspaces/new?intent=add");
                }}
              />
            </Popover>
          );
        })}
      </div>
    </nav>
  );
}

function relayWorkspaceOrganization(
  workspace: ReturnType<typeof useRelaySession>["workspaces"][number],
): AuthOrganization {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.id,
    logo: workspace.imageURL,
    metadata: { websiteUrl: workspace.website },
  };
}
