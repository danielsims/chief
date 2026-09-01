import { useState } from "react";
import {
  Check,
  ChevronUp,
  LogOut,
  Plus,
  Server,
  Settings as SettingsIcon,
  Smile,
} from "lucide-react";
import { useNavigate } from "react-router";

import { isJsonString } from "@chief/relay-contracts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@chief/ui/components/dropdown-menu";
import { Popover, PopoverAnchor } from "@chief/ui/components/popover";

import type { RelayAccountIdentity } from "../lib/auth/account-directory";
import type { AuthOrganization } from "../lib/auth/better-auth-client";
import type { ConnectedWorkspace } from "../lib/relay-connection";
import { connectedRelayIdentities } from "../lib/auth/account-directory";
import { useAuth } from "../lib/auth/auth-context";
import { chiefAccountConnection } from "../lib/auth/auth-session-flow";
import { parseOrganizationMetadata } from "../lib/auth/better-auth-client";
import { CHIEF_CLOUD_RELAY_URL, RELAY_URL } from "../lib/config";
import {
  knownRelayConnections,
  knownWorkspacesForRelayIdentities,
  resolveRelayConnection,
} from "../lib/relay-connection";
import { useRelaySession } from "../lib/relay-session";
import { userStatusLabel, useUserStatus } from "../lib/user-status";
import { pendingCreateRelayKey } from "../lib/workspace-entry";
import { ChiefMark } from "./chief-mark";
import { OrgLogo } from "./org-logo";
import { RelayConnectionDialog } from "./relay-connection-control";
import { SetStatusDialog } from "./set-status-dialog";
import {
  nextWorkspaceMenuId,
  WorkspaceActionsPopover,
} from "./workspace-action-menu";

export function SidebarProfileMenu() {
  const { cloudOrganizationId, connectRelay, signOut, user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [workspaceMenuId, setWorkspaceMenuId] = useState<string | null>(null);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const relay = useRelaySession();
  const userStatus = useUserStatus(cloudOrganizationId, user?.id ?? null);
  const activeWorkspaceId = relay.snapshot?.id ?? null;
  const identities = connectedRelayIdentities().sort((left, right) => {
    const cloudOrder =
      Number(isChiefCloud(right.relayUrl)) -
      Number(isChiefCloud(left.relayUrl));
    return cloudOrder || right.lastUsedAt - left.lastUsedAt;
  });

  const setProfileMenuOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setWorkspaceMenuId(null);
  };

  const switchWorkspace = async (
    organization: AuthOrganization,
    location: ConnectedWorkspace,
  ) => {
    if (isActiveWorkspace(location, activeWorkspaceId) || switchingTo) return;
    setSwitchingTo(organization.id);
    void navigate("/", { replace: true });
    try {
      await relay.switchWorkspace(organization.id, location);
      setProfileMenuOpen(false);
    } catch (error) {
      console.error("[Workspace] Switch failed:", error);
      setSwitchingTo(null);
    }
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setProfileMenuOpen}>
        <div className="group/profile hover:bg-sidebar-accent/70 flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors">
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Relay connections and workspaces"
              className="focus-visible:ring-ring/30 bg-sidebar-accent flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold outline-none focus-visible:ring-2"
            >
              <ProfileImage user={user} />
            </button>
          </DropdownMenuTrigger>
          <button
            type="button"
            onClick={() => setProfileMenuOpen(!open)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] leading-4 font-semibold">
                {user?.name ?? "Chief"}
              </span>
              <span className="text-sidebar-muted block truncate text-[12px] leading-4">
                {userStatusLabel(
                  userStatus.status,
                  user?.email ?? "Set a status",
                )}
              </span>
            </span>
            <ChevronUp
              size={13}
              className={`text-sidebar-muted shrink-0 opacity-70 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        </div>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-[310px] p-1.5"
        >
          <div className="px-2 py-2">
            <div className="flex min-h-11 items-center gap-3">
              <ProfileImage user={user} className="size-9" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] leading-4 font-semibold">
                  {user?.name ?? "Chief"}
                </span>
                <span className="text-muted-foreground mt-0.5 block truncate text-[12px] leading-4">
                  {user?.email ?? ""}
                </span>
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setProfileMenuOpen(false);
                window.requestAnimationFrame(() => setStatusDialogOpen(true));
              }}
              className="border-border/60 hover:bg-accent mt-2 flex min-h-9 w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[13px] transition-colors"
            >
              {userStatus.status?.emoji ? (
                <span className="w-[15px] shrink-0 text-center leading-none">
                  {userStatus.status.emoji}
                </span>
              ) : (
                <Smile size={15} className="text-muted-foreground shrink-0" />
              )}
              <span
                className={
                  userStatus.status ? "truncate" : "text-muted-foreground"
                }
              >
                {userStatus.status?.text ?? "Update your status"}
              </span>
            </button>
          </div>

          <div className="max-h-[390px] overflow-y-auto overscroll-contain">
            {identities.map((identity) => (
              <RelaySection
                key={identity.relayUrl}
                identity={identity}
                activeWorkspaceId={activeWorkspaceId}
                switchingTo={switchingTo}
                workspaceMenuId={workspaceMenuId}
                setWorkspaceMenuId={setWorkspaceMenuId}
                onSwitchWorkspace={switchWorkspace}
                onClose={() => setProfileMenuOpen(false)}
                onAddWorkspace={async () => {
                  window.sessionStorage.setItem(
                    pendingCreateRelayKey,
                    identity.relayUrl,
                  );
                  if (identity.relayUrl !== new URL(RELAY_URL).origin) {
                    const connection = resolveRelayConnection(
                      identity.relayUrl,
                      knownRelayConnections(),
                      chiefAccountConnection,
                    );
                    if (!connection) return;
                    await connectRelay(connection);
                    return;
                  }
                  setProfileMenuOpen(false);
                  void navigate("/workspaces/new?intent=add");
                }}
                onSignOut={() => {
                  setProfileMenuOpen(false);
                  signOut(identity.relayUrl);
                }}
              />
            ))}
          </div>

          <DropdownMenuSeparator />
          <RelayConnectionDialog>
            <button
              type="button"
              className="hover:bg-accent focus:bg-accent flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] transition-colors outline-none"
            >
              <Plus className="text-muted-foreground size-4 shrink-0" />
              Connect another relay
            </button>
          </RelayConnectionDialog>
          <button
            type="button"
            onClick={() => {
              setProfileMenuOpen(false);
              void navigate("/settings");
            }}
            className="hover:bg-accent focus:bg-accent flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] transition-colors outline-none"
          >
            <SettingsIcon className="text-muted-foreground size-4 shrink-0" />
            Settings
          </button>
        </DropdownMenuContent>
      </DropdownMenu>
      {statusDialogOpen ? (
        <SetStatusDialog
          open
          onOpenChange={setStatusDialogOpen}
          status={userStatus.status}
          onSave={userStatus.setStatus}
          onClear={userStatus.clearStatus}
        />
      ) : null}
    </>
  );
}

function RelaySection({
  identity,
  activeWorkspaceId,
  switchingTo,
  workspaceMenuId,
  setWorkspaceMenuId,
  onSwitchWorkspace,
  onClose,
  onAddWorkspace,
  onSignOut,
}: {
  identity: RelayAccountIdentity;
  activeWorkspaceId: string | null;
  switchingTo: string | null;
  workspaceMenuId: string | null;
  setWorkspaceMenuId: (value: string | null) => void;
  onSwitchWorkspace: (
    organization: AuthOrganization,
    location: ConnectedWorkspace,
  ) => Promise<void>;
  onClose: () => void;
  onAddWorkspace: () => Promise<void>;
  onSignOut: () => void;
}) {
  const navigate = useNavigate();
  const workspaces = knownWorkspacesForRelayIdentities([identity]);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="h-9">
        {isChiefCloud(identity.relayUrl) ? (
          <ChiefMark className="size-3.5 shrink-0" />
        ) : (
          <Server className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">
          {relayLabel(identity.relayUrl)}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-[420px] w-[280px] overflow-y-auto overscroll-contain">
        {workspaces.map((location) => {
          const organization = workspaceOrganization(location);
          const metadata = parseOrganizationMetadata(organization);
          const active = isActiveWorkspace(location, activeWorkspaceId);
          const menuKey = workspaceMenuKey(location);
          return (
            <Popover
              key={menuKey}
              open={workspaceMenuId === menuKey}
              onOpenChange={(nextOpen) =>
                setWorkspaceMenuId(
                  nextWorkspaceMenuId(workspaceMenuId, menuKey, nextOpen),
                )
              }
            >
              <PopoverAnchor asChild>
                <DropdownMenuItem
                  disabled={switchingTo !== null}
                  onSelect={() =>
                    void onSwitchWorkspace(organization, location)
                  }
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setWorkspaceMenuId(menuKey);
                  }}
                  className="h-9 gap-2.5"
                >
                  <OrgLogo
                    name={organization.name}
                    logo={organization.logo}
                    website={
                      isJsonString(metadata.websiteUrl)
                        ? metadata.websiteUrl
                        : ""
                    }
                    className="size-6 shrink-0 text-[10px]"
                    transparentWhenLoaded
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {organization.name}
                  </span>
                  {active ? <Check className="size-3.5 shrink-0" /> : null}
                </DropdownMenuItem>
              </PopoverAnchor>
              <WorkspaceActionsPopover
                showOpenWorkspace={!active}
                actionsDisabled={switchingTo !== null}
                onOpenWorkspace={() => {
                  setWorkspaceMenuId(null);
                  void onSwitchWorkspace(organization, location);
                }}
                onWorkspaceSettings={() => {
                  setWorkspaceMenuId(null);
                  if (active) {
                    onClose();
                    void navigate("/settings/workspace");
                    return;
                  }
                  void onSwitchWorkspace(organization, location).then(() => {
                    onClose();
                    void navigate("/settings/workspace", { replace: true });
                  });
                }}
                workspaceName={organization.name}
                relayUrl={location.relayUrl}
              />
            </Popover>
          );
        })}
        <DropdownMenuItem
          onSelect={() => void onAddWorkspace()}
          className="h-9"
        >
          <Plus className="text-muted-foreground size-4" />
          Add a workspace
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onSignOut}
          className="text-muted-foreground h-9"
        >
          <LogOut className="size-4" />
          Sign out of {relayLabel(identity.relayUrl)}
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function ProfileImage({
  user,
  className = "size-full",
}: {
  user: { name: string; image?: string } | null;
  className?: string;
}) {
  return (
    <span
      className={`bg-muted flex shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold ${className}`}
    >
      {user?.image ? (
        <img src={user.image} alt="" className="size-full object-cover" />
      ) : (
        (user?.name.trim().charAt(0) ?? "C").toLocaleUpperCase()
      )}
    </span>
  );
}

function workspaceOrganization(location: ConnectedWorkspace): AuthOrganization {
  return {
    id: location.summary.id,
    name: location.summary.name,
    slug: location.summary.id,
    logo: location.summary.imageURL,
    metadata: { websiteUrl: location.summary.website },
  };
}

function workspaceMenuKey(location: ConnectedWorkspace): string {
  return `${location.relayUrl}:${location.summary.id}`;
}

function relayLabel(relayUrl: string): string {
  return isChiefCloud(relayUrl) ? "Chief Cloud" : new URL(relayUrl).host;
}

function isChiefCloud(relayUrl: string): boolean {
  return new URL(relayUrl).origin === new URL(CHIEF_CLOUD_RELAY_URL).origin;
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
