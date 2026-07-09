import { useCallback, useEffect, useState } from "react";
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
import { Button } from "@marketer/ui/components/button";
import { Input } from "@marketer/ui/components/input";
import { cn } from "@marketer/ui/lib/utils";
import { useAuth } from "../lib/auth/auth-context";
import {
  createAuthOrganization,
  listAuthOrganizations,
  setActiveAuthOrganization,
  type AuthOrganization,
} from "../lib/auth/better-auth-client";

/**
 * Default workspace logo: the favicon of the workspace's website, via
 * Google's favicon service. Persisted to the org `logo` field on create.
 */
function faviconUrl(website: string): string | null {
  const trimmed = website.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`);
    return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=64`;
  } catch {
    return null;
  }
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Random suffix avoids collisions with slugs taken by other accounts.
  const suffix = Math.random().toString(36).slice(2, 8);
  return base ? `${base}-${suffix}` : suffix;
}

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
        <span className="font-serif leading-none select-none">{initial}</span>
      )}
    </span>
  );
}

function CreateWorkspaceForm({ onCancel }: { onCancel: () => void }) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = name.trim();
      if (!trimmed || isCreating) return;
      setIsCreating(true);
      setError(null);
      try {
        const logo = faviconUrl(website);
        const org = await createAuthOrganization({
          name: trimmed,
          slug: slugify(trimmed),
          ...(logo ? { logo } : {}),
        });
        await setActiveAuthOrganization(org.id);
        // Full reload re-keys all org-scoped app state on the new workspace.
        window.location.assign("/");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setIsCreating(false);
      }
    },
    [name, website, isCreating],
  );

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 p-2">
      <Input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Workspace name"
        className="h-8 text-xs"
        disabled={isCreating}
      />
      <Input
        value={website}
        onChange={(event) => setWebsite(event.target.value)}
        placeholder="Website URL (optional)"
        className="h-8 text-xs"
        disabled={isCreating}
      />
      {error ? (
        <p className="text-xs text-destructive break-words">{error}</p>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          className="h-7 flex-1 text-xs"
          disabled={!name.trim() || isCreating}
        >
          {isCreating ? "Creating..." : "Create"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={onCancel}
          disabled={isCreating}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function WorkspaceSwitcher() {
  const { isAuthenticated, cloudOrganizationId } = useAuth();
  const [open, setOpen] = useState(false);
  const [organizations, setOrganizations] = useState<AuthOrganization[]>([]);
  const [isCreating, setIsCreating] = useState(false);
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
      if (next) {
        setIsCreating(false);
        refresh();
      }
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
        {isCreating ? (
          <CreateWorkspaceForm onCancel={() => setIsCreating(false)} />
        ) : (
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
                      <span className="min-w-0 flex-1 truncate">
                        {org.name}
                      </span>
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
              onClick={() => setIsCreating(true)}
              className="flex w-full items-center gap-2.5 px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center border">
                <Plus size={13} strokeWidth={1.75} />
              </span>
              Create workspace
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
