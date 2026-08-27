import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import {
  Check,
  ChevronRight,
  ChevronUp,
  LogOut,
  Plus,
  Server,
  Settings as SettingsIcon,
} from "lucide-react";
import { useNavigate } from "react-router";

import { isJsonString } from "@chief/relay-contracts";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";

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
import { pendingCreateRelayKey } from "../lib/workspace-entry";
import { ChiefMark } from "./chief-mark";
import { OrgLogo } from "./org-logo";
import { RelayConnectionDialog } from "./relay-connection-control";
import {
  nextWorkspaceMenuId,
  WorkspaceActionsPopover,
} from "./workspace-action-menu";

export function SidebarProfileMenu() {
  const { connectRelay, signOut, user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [workspaceMenuId, setWorkspaceMenuId] = useState<string | null>(null);
  const relay = useRelaySession();
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
    <Popover open={open} onOpenChange={setProfileMenuOpen}>
      <div className="group/profile hover:bg-sidebar-accent/70 flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Relay connections and workspaces"
            className="focus-visible:ring-ring/30 bg-sidebar-accent flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold outline-none focus-visible:ring-2"
          >
            <ProfileImage user={user} />
          </button>
        </PopoverTrigger>
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
              {relayLabel(RELAY_URL)}
            </span>
          </span>
          <ChevronUp
            size={13}
            className={`text-sidebar-muted shrink-0 opacity-70 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[310px] p-1.5"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex min-h-14 items-center gap-3 px-2 py-2">
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

        <div className="max-h-[390px] overflow-y-auto overscroll-contain">
          {identities.map((identity, index) => (
            <RelaySection
              key={identity.relayUrl}
              identity={identity}
              separated={index > 0}
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

        <div className="bg-border/60 my-1 h-px" />
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
      </PopoverContent>
    </Popover>
  );
}

function RelaySection({
  identity,
  separated,
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
  separated: boolean;
  activeWorkspaceId: string | null;
  switchingTo: string | null;
  workspaceMenuId: string | null;
  setWorkspaceMenuId: Dispatch<SetStateAction<string | null>>;
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
    <section className={separated ? "border-border/60 border-t pt-1" : ""}>
      <div className="text-muted-foreground flex h-8 items-center gap-2 px-2 text-[12px] leading-4">
        {isChiefCloud(identity.relayUrl) ? (
          <ChiefMark className="size-3.5 shrink-0" />
        ) : (
          <Server className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">
          {relayLabel(identity.relayUrl)}
        </span>
      </div>
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
              setWorkspaceMenuId((currentId) =>
                nextWorkspaceMenuId(currentId, menuKey, nextOpen),
              )
            }
          >
            <PopoverAnchor asChild>
              <button
                type="button"
                onClick={() => void onSwitchWorkspace(organization, location)}
                disabled={switchingTo !== null}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setWorkspaceMenuId(menuKey);
                }}
                className="hover:bg-accent flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors outline-none disabled:opacity-50"
              >
                <OrgLogo
                  name={organization.name}
                  logo={organization.logo}
                  website={
                    isJsonString(metadata.websiteUrl) ? metadata.websiteUrl : ""
                  }
                  className="size-6 shrink-0 text-[10px]"
                  transparentWhenLoaded
                />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                  {organization.name}
                </span>
                {active ? (
                  <Check className="size-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                )}
              </button>
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
      <button
        type="button"
        onClick={() => void onAddWorkspace()}
        className="hover:bg-accent flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] transition-colors"
      >
        <Plus className="text-muted-foreground size-4 shrink-0" />
        Add a workspace
      </button>
      <button
        type="button"
        onClick={onSignOut}
        className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] transition-colors"
      >
        <LogOut className="size-4 shrink-0" />
        Sign out of {relayLabel(identity.relayUrl)}
      </button>
    </section>
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
