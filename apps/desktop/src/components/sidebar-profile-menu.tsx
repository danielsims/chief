import { useEffect, useState } from "react";
import { Check, ChevronRight, ChevronUp, Plus } from "lucide-react";
import { useNavigate } from "react-router";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";

import type { AuthOrganization } from "../lib/auth/better-auth-client";
import { useAuth } from "../lib/auth/auth-context";
import {
  listAuthOrganizations,
  parseOrganizationMetadata,
  setActiveAuthOrganization,
} from "../lib/auth/better-auth-client";
import { OrgLogo } from "./org-logo";

export function SidebarProfileMenu() {
  const { user, cloudOrganizationId, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [organizations, setOrganizations] = useState<AuthOrganization[]>([]);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [workspaceMenuId, setWorkspaceMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    void listAuthOrganizations(open).then((items) => {
      if (!cancelled) setOrganizations(items);
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, open]);

  const switchWorkspace = async (organization: AuthOrganization) => {
    if (organization.id === cloudOrganizationId || switchingTo) return;
    setSwitchingTo(organization.id);
    try {
      await setActiveAuthOrganization(organization.id);
      window.location.assign("/");
    } catch (error) {
      console.error("[Workspace] Switch failed:", error);
      setSwitchingTo(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Account and workspaces"
        className="group/profile hover:bg-sidebar-accent/70 data-[state=open]:bg-sidebar-accent/70 flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors"
      >
        <span className="bg-sidebar-accent flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-xl text-xs font-semibold">
          {user?.image ? (
            <img src={user.image} alt="" className="size-full object-cover" />
          ) : (
            (user?.name.trim().charAt(0) ?? "C").toLocaleUpperCase()
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-4 font-semibold">
            {user?.name ?? "Chief workspace"}
          </span>
          <span className="text-sidebar-muted block truncate text-[10px]">
            {user?.email ?? "Account and preferences"}
          </span>
        </span>
        <ChevronUp
          size={13}
          className="text-sidebar-muted shrink-0 opacity-70 transition-transform group-data-[state=open]/profile:rotate-180"
        />
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="end"
        sideOffset={10}
        className="w-64 p-1.5"
      >
        <div className="px-2 py-1.5">
          <p className="truncate text-xs font-medium">
            {user?.name ?? "Chief workspace"}
          </p>
          <p className="text-muted-foreground mt-0.5 truncate text-[11px]">
            {user?.email}
          </p>
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
                  setWorkspaceMenuId(nextOpen ? organization.id : null)
                }
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    onPointerEnter={() => setWorkspaceMenuId(organization.id)}
                    className="hover:bg-accent data-[state=open]:bg-accent flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors"
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
                    />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {organization.name}
                    </span>
                    {active ? (
                      <Check
                        aria-label="Current workspace"
                        className="text-muted-foreground shrink-0"
                        size={13}
                      />
                    ) : null}
                    <ChevronRight
                      className="text-muted-foreground shrink-0"
                      size={13}
                    />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="right"
                  align="start"
                  sideOffset={8}
                  className="w-52 p-1.5"
                >
                  {active ? (
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        void navigate("/settings/workspace");
                      }}
                      className="hover:bg-accent flex h-9 w-full items-center rounded-lg px-2 text-left text-xs transition-colors"
                    >
                      Workspace settings
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={switchingTo !== null}
                      onClick={() => void switchWorkspace(organization)}
                      className="hover:bg-accent flex h-9 w-full items-center rounded-lg px-2 text-left text-xs transition-colors disabled:opacity-50"
                    >
                      Open workspace
                    </button>
                  )}
                  <div className="bg-border/60 my-1 h-px" />
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      void navigate("/workspaces/new");
                    }}
                    className="hover:bg-accent flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors"
                  >
                    <Plus size={13} />
                    Add a workspace
                  </button>
                </PopoverContent>
              </Popover>
            );
          })}
        </div>
        <div className="bg-border/60 my-1 h-px" />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            void navigate("/settings");
          }}
          className="hover:bg-accent focus:bg-accent flex h-9 w-full items-center rounded-lg px-2 text-left text-xs font-medium transition-colors outline-none"
        >
          Settings
        </button>
      </PopoverContent>
    </Popover>
  );
}
