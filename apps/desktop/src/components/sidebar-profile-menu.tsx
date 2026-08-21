import { useMemo, useState } from "react";
import { ChevronRight, ChevronUp, Smile } from "lucide-react";
import { useNavigate } from "react-router";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";

import type { AuthOrganization } from "../lib/auth/better-auth-client";
import { useAuth } from "../lib/auth/auth-context";
import { parseOrganizationMetadata } from "../lib/auth/better-auth-client";
import { useRelaySession } from "../lib/relay-session";
import { useUserStatus } from "../lib/user-status";
import { OrgLogo } from "./org-logo";
import { SetStatusDialog } from "./set-status-dialog";
import {
  nextWorkspaceMenuId,
  WorkspaceActionsPopover,
} from "./workspace-action-menu";

export function SidebarProfileMenu() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [workspaceMenuId, setWorkspaceMenuId] = useState<string | null>(null);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const relay = useRelaySession();
  const cloudOrganizationId = relay.snapshot?.id ?? null;
  const userStatus = useUserStatus(cloudOrganizationId, user?.id ?? null);
  const organizations = useMemo<AuthOrganization[]>(
    () =>
      relay.workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        slug: workspace.id,
        logo: workspace.imageURL,
        metadata: { websiteUrl: workspace.website },
      })),
    [relay.workspaces],
  );

  const setProfileMenuOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setWorkspaceMenuId(null);
  };

  const switchWorkspace = async (organization: AuthOrganization) => {
    if (organization.id === cloudOrganizationId || switchingTo) return;
    setSwitchingTo(organization.id);
    try {
      await relay.switchWorkspace(organization.id);
      window.location.assign("/");
    } catch (error) {
      console.error("[Workspace] Switch failed:", error);
      setSwitchingTo(null);
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={setProfileMenuOpen}>
        <div className="group/profile hover:bg-sidebar-accent/70 flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors">
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Account and workspaces"
              className="focus-visible:ring-ring/30 bg-sidebar-accent flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold outline-none focus-visible:ring-2"
            >
              {user?.image ? (
                <img
                  src={user.image}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                (user?.name.trim().charAt(0) ?? "C").toLocaleUpperCase()
              )}
            </button>
          </PopoverTrigger>
          <button
            type="button"
            onClick={() => setProfileMenuOpen(!open)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] leading-4 font-semibold">
                {user?.name ?? "Chief workspace"}
              </span>
              <span className="text-sidebar-muted block truncate text-[12px] leading-4">
                {userStatus.status
                  ? `${userStatus.status.emoji} ${userStatus.status.text}`.trim()
                  : (user?.email ?? "Account and preferences")}
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
          className="w-[280px] p-1"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="px-2 py-1.5">
            <p className="truncate text-sm leading-4 font-semibold">
              {user?.name ?? "Chief workspace"}
            </p>
            <p className="text-muted-foreground mt-0.5 truncate text-[12px] leading-4">
              {user?.email}
            </p>
          </div>
          <div className="px-1 pb-1">
            <button
              type="button"
              onClick={() => {
                setProfileMenuOpen(false);
                window.requestAnimationFrame(() => setStatusDialogOpen(true));
              }}
              className="border-border/60 hover:bg-accent flex min-h-9 w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[13px] transition-colors"
            >
              <Smile size={15} className="text-muted-foreground shrink-0" />
              {userStatus.status ? (
                <span className="min-w-0 flex-1 truncate">
                  {userStatus.status.emoji} {userStatus.status.text}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Update your status
                </span>
              )}
            </button>
          </div>
          <div className="bg-border/60 my-1 h-px" />
          <div className="px-1 py-1">
            {organizations.map((organization) => {
              const active = organization.id === cloudOrganizationId;
              const metadata = parseOrganizationMetadata(organization);
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
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      onPointerEnter={() => setWorkspaceMenuId(organization.id)}
                      className="hover:bg-accent data-[state=open]:bg-accent flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors outline-none"
                    >
                      <OrgLogo
                        name={organization.name}
                        logo={organization.logo}
                        website={
                          typeof metadata.websiteUrl === "string"
                            ? metadata.websiteUrl
                            : ""
                        }
                        className="size-6 shrink-0 text-[10px]"
                        transparentWhenLoaded
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                        {organization.name}
                      </span>
                      <ChevronRight
                        className="text-muted-foreground shrink-0"
                        size={13}
                      />
                    </button>
                  </PopoverTrigger>
                  <WorkspaceActionsPopover
                    primaryLabel={
                      active ? "Workspace settings" : "Open workspace"
                    }
                    primaryDisabled={!active && switchingTo !== null}
                    onPrimaryAction={() => {
                      setProfileMenuOpen(false);
                      if (active) {
                        void navigate("/settings/workspace");
                      } else {
                        void switchWorkspace(organization);
                      }
                    }}
                    onAddWorkspace={() => {
                      setProfileMenuOpen(false);
                      void navigate("/workspaces/new?intent=add");
                    }}
                  />
                </Popover>
              );
            })}
          </div>
          <div className="bg-border/60 my-1 h-px" />
          <button
            type="button"
            onClick={() => {
              setProfileMenuOpen(false);
              void navigate("/settings");
            }}
            className="hover:bg-accent focus:bg-accent flex h-9 w-full items-center rounded-lg px-2 text-left text-[13px] transition-colors outline-none"
          >
            Settings
          </button>
        </PopoverContent>
      </Popover>
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
