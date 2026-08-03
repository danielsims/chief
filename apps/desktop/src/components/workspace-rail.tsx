import { useCallback, useEffect, useMemo, useState } from "react";

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
import { activeFirstOrganizations } from "../lib/workspace-organizations";
import { OrgLogo } from "./org-logo";

export function WorkspaceRail() {
  const { cloudOrganizationId, isAuthenticated } = useAuth();
  const [organizations, setOrganizations] = useState<AuthOrganization[] | null>(
    null,
  );
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    void listAuthOrganizations(true).then((next) => {
      if (!cancelled) {
        setOrganizations(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const orderedOrganizations = useMemo(
    () => activeFirstOrganizations(organizations ?? [], cloudOrganizationId),
    [cloudOrganizationId, organizations],
  );
  const switchWorkspace = useCallback(
    async (organization: AuthOrganization) => {
      if (organization.id === cloudOrganizationId || switchingTo) return;
      setSwitchingTo(organization.id);
      try {
        await setActiveAuthOrganization(organization.id);
        window.location.assign("/");
      } catch (error) {
        console.error("[Workspace] Switch failed:", error);
        setSwitchingTo(null);
      }
    },
    [cloudOrganizationId, switchingTo],
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
      <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto px-1.5">
        {organizations === null ? (
          <span
            aria-hidden
            className="bg-sidebar-accent size-9 shrink-0 animate-pulse rounded-[13px]"
          />
        ) : null}
        {orderedOrganizations.map((organization) => {
          const active = organization.id === cloudOrganizationId;
          const metadata = parseOrganizationMetadata(organization);
          return (
            <Tooltip key={organization.id} delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  aria-label={`${organization.name}${active ? ", current workspace" : ""}`}
                  disabled={switchingTo !== null}
                  onClick={() => void switchWorkspace(organization)}
                  className={cn(
                    "group relative size-9 shrink-0 rounded-[13px] transition-all outline-none hover:rounded-[10px] focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-50",
                    active && "rounded-[10px]",
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
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {organization.name}
                {active ? " · Current" : ""}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </nav>
  );
}
