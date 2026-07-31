import { ArrowRight, LayoutTemplate, Plus, Sparkles } from "lucide-react";
import { useNavigate } from "react-router";

import type { ExecutorArtifactSummary } from "@chief/agent-runtime/artifact-types";

import { useAuth } from "../lib/auth/auth-context";
import { createChat } from "../lib/chat-log";
import { useExecutorArtifacts } from "../lib/executor-artifacts";

function relativeTime(timestamp: number) {
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

function ArtifactPreview({ artifact }: { artifact: ExecutorArtifactSummary }) {
  if (artifact.preview) {
    return (
      <div
        aria-hidden
        className="chief-artifact-preview pointer-events-none absolute top-0 left-0 origin-top-left"
        // Executor only returns markup that passed its inert-element and
        // attribute allowlist; the local daemon is the trust boundary here.
        dangerouslySetInnerHTML={{ __html: artifact.preview.markup }}
      />
    );
  }

  return (
    <div aria-hidden className="absolute inset-0 grid grid-cols-3 gap-2 p-5">
      <div className="border-border bg-background col-span-2 border p-3">
        <span className="bg-foreground/15 block h-1.5 w-14" />
        <span className="bg-foreground/8 mt-4 block h-12" />
        <span className="bg-foreground/10 mt-2 block h-1.5 w-3/4" />
      </div>
      <div className="space-y-2">
        <span className="border-border bg-background block h-[58px] border" />
        <span className="border-border bg-background block h-[58px] border" />
      </div>
    </div>
  );
}

function ArtifactCard({
  artifact,
  onContinue,
}: {
  artifact: ExecutorArtifactSummary;
  onContinue: () => void;
}) {
  return (
    <article className="group bg-card hover:border-foreground/35 overflow-hidden border transition-colors">
      <div className="bg-muted/40 relative aspect-[16/10] overflow-hidden border-b">
        <ArtifactPreview artifact={artifact} />
        <div className="from-background/0 to-background/35 absolute inset-0 bg-gradient-to-b" />
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium">{artifact.title}</h2>
            <p className="text-muted-foreground mt-1 line-clamp-2 min-h-9 text-xs leading-[18px]">
              {artifact.description ?? "A reusable interface made by Chief."}
            </p>
          </div>
          <span className="text-muted-foreground shrink-0 font-mono text-[9px]">
            {relativeTime(artifact.updatedAt)}
          </span>
        </div>
        <button
          type="button"
          onClick={onContinue}
          className="text-muted-foreground hover:text-foreground mt-4 flex items-center gap-1.5 text-[11px] transition-colors"
        >
          Continue with Chief <ArrowRight size={12} />
        </button>
      </div>
    </article>
  );
}

export function ArtifactsPage() {
  const { cloudOrganizationId } = useAuth();
  const { artifacts, loading, error, retry } =
    useExecutorArtifacts(cloudOrganizationId);
  const navigate = useNavigate();

  const askChief = (prompt?: string) => {
    const chat = createChat();
    const params = new URLSearchParams({ chat: chat.id });
    if (prompt) params.set("prompt", prompt);
    void navigate(`/conversations?${params.toString()}`);
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] pt-5 pb-20">
      <header className="flex items-end justify-between gap-6 border-b pb-6">
        <div>
          <div className="text-muted-foreground flex items-center gap-2 text-[10px] font-semibold tracking-[0.08em] uppercase">
            <Sparkles size={12} /> Work library
          </div>
          <h1 className="mt-3 font-serif text-[34px] leading-none tracking-[-0.035em]">
            Artifacts
          </h1>
          <p className="text-muted-foreground mt-3 max-w-xl text-sm leading-6">
            Interfaces Chief makes while working with you, saved so they can be
            reopened and improved instead of disappearing into a transcript.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            askChief("Create a useful interactive artifact for this workspace.")
          }
          className="bg-foreground text-background flex h-9 shrink-0 items-center gap-2 px-3 text-xs transition-opacity hover:opacity-85"
        >
          <Plus size={13} /> Ask Chief to make one
        </button>
      </header>

      {loading ? (
        <div className="text-muted-foreground flex items-center gap-2 py-10 text-xs">
          <span className="bg-foreground/25 size-1.5 animate-pulse" />
          Loading saved artifacts…
        </div>
      ) : error && artifacts.length === 0 ? (
        <div className="mt-7 flex items-center justify-between border px-4 py-3">
          <div>
            <p className="text-xs font-medium">Artifacts are not ready yet</p>
            <p className="text-muted-foreground mt-1 text-xs">{error}</p>
          </div>
          <button
            type="button"
            onClick={retry}
            className="hover:bg-accent border px-3 py-2 text-xs"
          >
            Try again
          </button>
        </div>
      ) : artifacts.length > 0 ? (
        <section className="mt-7">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-medium">Saved artifacts</h2>
            <span className="text-muted-foreground font-mono text-[10px]">
              {artifacts.length} {artifacts.length === 1 ? "item" : "items"}
            </span>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {artifacts.map((artifact) => (
              <ArtifactCard
                key={artifact.id}
                artifact={artifact}
                onContinue={() =>
                  askChief(
                    `Open the artifact “${artifact.title}” (${artifact.id}) and help me improve it.`,
                  )
                }
              />
            ))}
          </div>
        </section>
      ) : (
        <section className="border-border mt-7 flex min-h-72 items-center justify-center border border-dashed px-8 text-center">
          <div className="max-w-md">
            <span className="bg-card mx-auto flex size-11 items-center justify-center border">
              <LayoutTemplate size={18} className="text-muted-foreground" />
            </span>
            <h2 className="mt-5 font-serif text-2xl">
              Made in the work, not in a builder
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              Ask for a dashboard, review surface, calculator, or other useful
              interface in any channel. Chief can create it and it will collect
              here automatically.
            </p>
            <button
              type="button"
              onClick={() => askChief()}
              className="hover:bg-accent mt-5 border px-3 py-2 text-xs transition-colors"
            >
              Start in a channel
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
