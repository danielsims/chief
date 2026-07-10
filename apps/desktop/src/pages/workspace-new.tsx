import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@marketer/ui/components/button";
import { Input } from "@marketer/ui/components/input";
import {
  createAuthOrganization,
  setActiveAuthOrganization,
  updateAuthOrganization,
} from "../lib/auth/better-auth-client";
import { faviconLoads, faviconUrl } from "../components/org-logo";

/**
 * Full-page workspace creation. Visually this is step one of onboarding.
 */

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Random suffix avoids collisions with slugs taken by other accounts.
  const suffix = Math.random().toString(36).slice(2, 8);
  return base ? `${base}-${suffix}` : suffix;
}

export function CreateWorkspacePage() {
  const navigate = useNavigate();
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
        // Only persist the favicon as the logo when it is a real one; the
        // favicon service returns a 16px generic globe for sites without one.
        let logo = faviconUrl(website);
        if (logo && !(await faviconLoads(logo))) logo = null;
        const org = await createAuthOrganization({
          name: trimmed,
          slug: slugify(trimmed),
          ...(logo ? { logo } : {}),
        });
        await updateAuthOrganization(org.id, {
          metadata: { websiteUrl: website.trim() },
        });
        await setActiveAuthOrganization(org.id);
        // Full reload re-keys all org-scoped app state on the new workspace.
        window.location.assign("/onboarding");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setIsCreating(false);
      }
    },
    [name, website, isCreating],
  );

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Drag strip under the macOS window controls */}
      <header data-tauri-drag-region className="h-[92px] shrink-0" />

      <main className="flex flex-1 items-center justify-center px-8 pb-[92px]">
        <div className="w-full max-w-sm">
          <h1 className="font-serif text-3xl leading-tight">
            Create a workspace
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A workspace holds one company and its agents.
          </p>
          <form
            onSubmit={handleSubmit}
            className="mt-8 space-y-5 border bg-card p-5"
          >
            <div className="space-y-1.5">
              <label
                className="text-xs text-muted-foreground"
                htmlFor="new-workspace-name"
              >
                Company name
              </label>
              <Input
                id="new-workspace-name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Acme Inc"
                disabled={isCreating}
              />
            </div>
            <div className="space-y-1.5">
              <label
                className="text-xs text-muted-foreground"
                htmlFor="new-workspace-website"
              >
                Company website
              </label>
              <Input
                id="new-workspace-website"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                placeholder="acme.com"
                disabled={isCreating}
              />
              <p className="text-xs text-muted-foreground">
                The workspace logo defaults to this site's favicon.
              </p>
            </div>
            {error ? (
              <p className="text-xs text-destructive break-words">{error}</p>
            ) : null}
            <Button
              type="submit"
              className="w-full"
              disabled={!name.trim() || isCreating}
            >
              {isCreating ? "Creating..." : "Create workspace"}
            </Button>
          </form>
          <button
            type="button"
            onClick={() => navigate(-1)}
            disabled={isCreating}
            className="mt-4 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </main>
    </div>
  );
}
