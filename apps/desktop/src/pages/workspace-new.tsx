import { useCallback, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router";

import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";

import { resolveFaviconUrl } from "../components/org-logo";
import {
  createAuthOrganization,
  setActiveAuthOrganization,
  updateAuthOrganization,
} from "../lib/auth/better-auth-client";

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
        const logo = await resolveFaviconUrl(website);
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
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <header data-tauri-drag-region className="h-12 shrink-0" />

      <main className="flex min-h-0 flex-1 overflow-y-auto px-6 pb-12">
        <div className="mx-auto flex min-h-full w-full max-w-[480px] flex-col justify-center py-10">
          <button
            type="button"
            onClick={() => navigate(-1)}
            disabled={isCreating}
            className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/30 mb-7 flex h-8 w-fit items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
          >
            <ArrowLeft size={14} />
            Back
          </button>

          <div>
            <h1 className="text-[30px] leading-[1.08] font-normal tracking-[-0.04em]">
              Create a workspace
            </h1>
            <p className="text-muted-foreground mt-2 max-w-md text-[13px] leading-5">
              Give your company, channels, agents, and shared work a home.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="bg-background mt-8 space-y-5 rounded-2xl p-6 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_9%,transparent),0_12px_32px_color-mix(in_srgb,var(--foreground)_3%,transparent)] dark:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_12%,transparent),0_12px_32px_rgba(0,0,0,0.14)]"
          >
            <div className="space-y-2">
              <label
                className="text-[13px] font-medium"
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
                className="bg-background h-10 rounded-xl border-0 px-3.5 shadow-[inset_0_0_0_1px_var(--input),inset_0_1px_rgba(255,255,255,0.06),0_1px_2px_rgba(0,0,0,0.025)]"
              />
            </div>
            <div className="space-y-2">
              <label
                className="text-[13px] font-medium"
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
                className="bg-background h-10 rounded-xl border-0 px-3.5 shadow-[inset_0_0_0_1px_var(--input),inset_0_1px_rgba(255,255,255,0.06),0_1px_2px_rgba(0,0,0,0.025)]"
              />
              <p className="text-muted-foreground text-[11px] leading-4">
                Chief will use the website favicon as the workspace image when
                one is available.
              </p>
            </div>
            {error ? (
              <p className="text-destructive text-xs leading-5 break-words">
                {error}
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate(-1)}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="min-w-36"
                disabled={!name.trim() || isCreating}
                loading={isCreating}
              >
                Create workspace
              </Button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
