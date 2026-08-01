import { ArrowRight, LayoutTemplate, Plus } from "lucide-react";
import { useNavigate } from "react-router";

import type { ExecutorArtifactSummary } from "@chief/agent-runtime/artifact-types";
import { Button } from "@chief/ui/components/button";

import type { WorkspaceChannelId } from "../lib/workspace-channels";
import { ArtifactPreview } from "../components/artifact-preview";
import { useAuth } from "../lib/auth/auth-context";
import { createChat } from "../lib/chat-log";
import { chiefArtifacts } from "../lib/chief-artifacts";
import { useExecutorArtifacts } from "../lib/executor-artifacts";
import { WORKSPACE_CHANNELS } from "../lib/workspace-channels";

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

function ArtifactCard({
  artifact,
  onContinue,
}: {
  artifact: ExecutorArtifactSummary;
  onContinue: () => void;
}) {
  return (
    <article className="group bg-card hover:border-foreground/25 overflow-hidden rounded-xl border transition-colors">
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
        <Button
          onClick={onContinue}
          variant="ghost"
          size="xs"
          className="text-muted-foreground mt-3 -ml-2"
        >
          Continue with Chief <ArrowRight size={12} />
        </Button>
      </div>
    </article>
  );
}

export function ArtifactsPage() {
  const { cloudOrganizationId } = useAuth();
  const { artifacts, loading, error, retry } =
    useExecutorArtifacts(cloudOrganizationId);
  const navigate = useNavigate();

  const typedArtifacts = chiefArtifacts(artifacts);
  const askChief = (channelId: WorkspaceChannelId, prompt?: string) => {
    const chat = createChat();
    const params = new URLSearchParams({ channel: channelId, chat: chat.id });
    if (prompt) params.set("prompt", prompt);
    void navigate(`/conversations?${params.toString()}`);
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] pt-5 pb-20">
      <header className="flex items-end justify-between gap-6 border-b pb-6">
        <div>
          <h1 className="font-serif text-[34px] leading-none tracking-[-0.035em]">
            Created work
          </h1>
          <p className="text-muted-foreground mt-3 max-w-xl text-sm leading-6">
            Interfaces Chief makes while working with you, saved so they can be
            reopened and improved instead of disappearing into a transcript.
          </p>
        </div>
        <Button
          onClick={() =>
            askChief(
              "general",
              "Create a useful interactive output for this workspace.",
            )
          }
          size="sm"
        >
          <Plus size={13} /> Ask Chief to make one
        </Button>
      </header>

      {loading ? (
        <div className="text-muted-foreground flex items-center gap-2 py-10 text-xs">
          <span className="bg-foreground/25 size-1.5 animate-pulse rounded-full" />
          Loading created work…
        </div>
      ) : error && artifacts.length === 0 ? (
        <div className="mt-7 flex items-center justify-between rounded-xl border px-4 py-3">
          <div>
            <p className="text-xs font-medium">Created work is not ready yet</p>
            <p className="text-muted-foreground mt-1 text-xs">{error}</p>
          </div>
          <Button variant="outline" size="sm" onClick={retry}>
            Try again
          </Button>
        </div>
      ) : artifacts.length > 0 ? (
        <div className="mt-7 space-y-9">
          {WORKSPACE_CHANNELS.map((channel) => {
            const channelArtifacts = typedArtifacts.filter(
              (artifact) => artifact.channelId === channel.id,
            );
            if (channelArtifacts.length === 0) return null;
            return (
              <section key={channel.id}>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-medium capitalize">
                      {channel.label}
                    </h2>
                    <p className="text-muted-foreground mt-0.5 text-[11px]">
                      {channel.description}
                    </p>
                  </div>
                  <span className="text-muted-foreground font-mono text-[10px]">
                    {channelArtifacts.length}
                  </span>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {channelArtifacts.map((artifact) => (
                    <ArtifactCard
                      key={artifact.id}
                      artifact={artifact}
                      onContinue={() =>
                        askChief(
                          channel.id,
                          `Open the output “${artifact.title}” (${artifact.id}) and help me improve it.`,
                        )
                      }
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <section className="border-border mt-7 flex min-h-72 items-center justify-center rounded-2xl border border-dashed px-8 text-center">
          <div className="max-w-md">
            <span className="bg-card mx-auto flex size-11 items-center justify-center rounded-xl border">
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => askChief("general")}
              className="mt-5"
            >
              Start in a channel
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
