import { ArrowRight } from "lucide-react";

import type { ExecutorArtifactSummary } from "@chief/agent-runtime/artifact-types";

import { useAuth } from "../../lib/auth/auth-context";
import { chiefArtifacts } from "../../lib/chief-artifacts";
import { useExecutorArtifacts } from "../../lib/executor-artifacts";
import { ArtifactPreview } from "../artifact-preview";

function CanvasArtifact({
  artifact,
  onContinue,
}: {
  artifact: ExecutorArtifactSummary;
  onContinue: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onContinue}
      className="bg-card hover:border-foreground/20 group overflow-hidden rounded-xl border text-left transition-colors"
    >
      <span className="bg-muted/35 relative block aspect-[16/9] overflow-hidden border-b">
        <ArtifactPreview artifact={artifact} />
      </span>
      <span className="flex items-center gap-3 p-3.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">
            {artifact.title}
          </span>
          <span className="text-muted-foreground mt-1 line-clamp-2 text-[11px] leading-4">
            {artifact.description ?? "Created by Chief in this channel."}
          </span>
        </span>
        <ArrowRight
          size={13}
          className="text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5"
        />
      </span>
    </button>
  );
}

export function ChannelCanvas({
  channelName,
  onContinueArtifact,
}: {
  channelName: string;
  onContinueArtifact: (artifact: ExecutorArtifactSummary) => void;
}) {
  const { cloudOrganizationId } = useAuth();
  const { artifacts, loading } = useExecutorArtifacts(cloudOrganizationId);
  const channelArtifacts = chiefArtifacts(artifacts).filter(
    (artifact) => artifact.channelId === channelName,
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <header>
          <h2 className="text-xl font-normal tracking-[-0.025em]">Artifacts</h2>
          <p className="text-muted-foreground mt-1.5 text-[12px] leading-5 font-normal">
            Files and durable outputs created in #{channelName} stay together
            here.
          </p>
        </header>

        {channelArtifacts.length > 0 ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {channelArtifacts.map((artifact) => (
              <CanvasArtifact
                key={artifact.id}
                artifact={artifact}
                onContinue={() => onContinueArtifact(artifact)}
              />
            ))}
          </div>
        ) : (
          <div className="text-muted-foreground mt-6 flex min-h-32 items-center justify-center rounded-xl border border-dashed px-6 text-center text-xs leading-5">
            {loading
              ? "Loading artifacts…"
              : `Artifacts created in #${channelName} will appear here.`}
          </div>
        )}
      </div>
    </div>
  );
}
