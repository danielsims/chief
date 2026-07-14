import { useCallback, useEffect, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useNavigate } from "react-router";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@chief/ui/components/tooltip";
import { cn } from "@chief/ui/lib/utils";

import type { AuthOrganization } from "../lib/auth/better-auth-client";
import { useAuth } from "../lib/auth/auth-context";
import {
  listAuthOrganizations,
  parseOrganizationMetadata,
  setActiveAuthOrganization,
} from "../lib/auth/better-auth-client";
import { OrgLogo } from "./org-logo";

export function WorkspaceSwitcher() {
  const { isAuthenticated, cloudOrganizationId } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [organizations, setOrganizations] = useState<AuthOrganization[]>([]);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const refresh = useCallback((force = false) => {
    void listAuthOrganizations(force).then(setOrganizations);
  }, []);

  useEffect(() => {
    if (isAuthenticated) refresh();
  }, [isAuthenticated, refresh]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) refresh(true);
    },
    [refresh],
  );

  const handleSwitch = useCallback(
    async (org: AuthOrganization) => {
      if (org.id === cloudOrganizationId || switchingTo) return;
      setSwitchingTo(org.id);
      try {
        await setActiveAuthOrganization(org.id);
        // Full reload re-keys all org-scoped app state on the new workspace.
        window.location.assign("/");
      } catch (err) {
        console.error("[Workspace] Switch failed:", err);
        setSwitchingTo(null);
      }
    },
    [cloudOrganizationId, switchingTo],
  );

  if (!isAuthenticated) return null;

  const activeOrg =
    organizations.find((org) => org.id === cloudOrganizationId) ??
    organizations[0] ??
    null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          {/* PopoverTrigger renders a plain button; keep className a plain
              string (Radix Slot/asChild stringifies function classNames). */}
          <PopoverTrigger className="text-muted-foreground hover:text-foreground data-[state=open]:border-border data-[state=open]:text-foreground block h-10 w-10 border border-transparent transition-colors">
            {activeOrg ? (
              <OrgLogo
                name={activeOrg.name}
                logo={activeOrg.logo}
                website={String(
                  parseOrganizationMetadata(activeOrg).websiteUrl ?? "",
                )}
                className="h-full w-full text-base"
              />
            ) : (
              <span className="bg-accent flex h-full w-full items-center justify-center border">
                <Plus size={16} strokeWidth={1.75} />
              </span>
            )}
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">
          {activeOrg ? activeOrg.name : "Create workspace"}
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="right" align="end" sideOffset={14}>
        <div className="flex flex-col">
          {organizations.length > 0 ? (
            <>
              {organizations.map((org) => {
                const isActive = org.id === activeOrg?.id;
                return (
                  <button
                    key={org.id}
                    type="button"
                    onClick={() => void handleSwitch(org)}
                    disabled={switchingTo !== null}
                    className={cn(
                      "hover:bg-accent flex w-full items-center gap-2.5 px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-50",
                      switchingTo === org.id && "opacity-50",
                    )}
                  >
                    <OrgLogo
                      name={org.name}
                      logo={org.logo}
                      website={String(
                        parseOrganizationMetadata(org).websiteUrl ?? "",
                      )}
                      className="h-6 w-6 shrink-0 text-xs"
                    />
                    <span className="min-w-0 flex-1 truncate">{org.name}</span>
                    {isActive ? (
                      <Check
                        size={14}
                        strokeWidth={1.75}
                        className="text-muted-foreground shrink-0"
                      />
                    ) : null}
                  </button>
                );
              })}
              <div className="my-1 border-t" />
            </>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate("/workspaces/new");
            }}
            className="text-muted-foreground hover:bg-accent hover:text-foreground flex w-full items-center gap-2.5 px-2 py-1.5 text-left text-sm transition-colors"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center border">
              <Plus size={13} strokeWidth={1.75} />
            </span>
            Create workspace
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
