import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Check, Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@marketer/ui/components/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@marketer/ui/components/tooltip";
import { cn } from "@marketer/ui/lib/utils";
import { useAuth } from "../lib/auth/auth-context";
import {
  listAuthOrganizations,
  setActiveAuthOrganization,
  type AuthOrganization,
} from "../lib/auth/better-auth-client";

/**
 * Square logo-or-initial tile. Falls back to the workspace's first initial
 * (serif, matching the wordmark) when there is no logo or the image 404s.
 */
function OrgTile({
  org,
  className,
}: {
  org: Pick<AuthOrganization, "name" | "logo">;
  className?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const initial = org.name.trim().charAt(0).toUpperCase() || "?";
  const showImage = Boolean(org.logo) && !imageFailed;
  return (
    <span
      className={cn(
        "flex items-center justify-center overflow-hidden border bg-accent",
        className,
      )}
    >
      {showImage ? (
        <img
          src={org.logo ?? undefined}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          onError={() => setImageFailed(true)}
        />
      ) : (
        /* translate-y compensates for Newsreader's tall ascender space so the
           initial sits optically centered. Em-based so it scales with both
           tile sizes (h-10 trigger, h-6 popover rows). */
        <span className="translate-y-[0.055em] font-serif leading-none select-none">
          {initial}
        </span>
      )}
    </span>
  );
}

export function WorkspaceSwitcher() {
  const { isAuthenticated, cloudOrganizationId } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [organizations, setOrganizations] = useState<AuthOrganization[]>([]);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void listAuthOrganizations().then(setOrganizations);
  }, []);

  useEffect(() => {
    if (isAuthenticated) refresh();
  }, [isAuthenticated, refresh]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) refresh();
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
          <PopoverTrigger className="block h-10 w-10 border border-transparent text-muted-foreground transition-colors hover:text-foreground data-[state=open]:border-border data-[state=open]:text-foreground">
            {activeOrg ? (
              <OrgTile org={activeOrg} className="h-full w-full text-base" />
            ) : (
              <span className="flex h-full w-full items-center justify-center border bg-accent">
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
                      "flex w-full items-center gap-2.5 px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50",
                      switchingTo === org.id && "opacity-50",
                    )}
                  >
                    <OrgTile org={org} className="h-6 w-6 shrink-0 text-xs" />
                    <span className="min-w-0 flex-1 truncate">{org.name}</span>
                    {isActive ? (
                      <Check
                        size={14}
                        strokeWidth={1.75}
                        className="shrink-0 text-muted-foreground"
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
            className="flex w-full items-center gap-2.5 px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
