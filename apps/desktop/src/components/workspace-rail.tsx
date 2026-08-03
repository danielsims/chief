import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router";

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

export function WorkspaceRail({
  onVisibilityChange,
}: {
  onVisibilityChange?: (visible: boolean) => void;
}) {
  const navigate = useNavigate();
  const { cloudOrganizationId, isAuthenticated } = useAuth();
  const [organizations, setOrganizations] = useState<AuthOrganization[] | null>(
    null,
  );
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      onVisibilityChange?.(false);
      return;
    }
    let cancelled = false;
    void listAuthOrganizations(true).then((next) => {
      if (!cancelled) {
        setOrganizations(next);
        onVisibilityChange?.(next.length > 1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, onVisibilityChange]);

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

  if (!isAuthenticated || organizations === null || organizations.length < 2) {
    return null;
  }

  return (
    <nav
      aria-label="Workspaces"
      className="bg-sidebar relative z-50 flex w-12 shrink-0 flex-col items-center pb-3"
    >
      <div className="h-10 shrink-0" data-tauri-drag-region />
      <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto px-1.5">
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
      <div className="bg-sidebar-border my-2 h-px w-5 shrink-0" />
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Create workspace"
            onClick={() => navigate("/workspaces/new")}
            className="text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-9 shrink-0 items-center justify-center rounded-[13px] border border-dashed border-current/20 transition-all hover:rounded-[10px]"
          >
            <Plus size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Create workspace</TooltipContent>
      </Tooltip>
    </nav>
  );
}
