import { ArrowUpRight, PanelsTopLeft } from "lucide-react";

import type { ExecutorArtifactSummary } from "@chief/agent-runtime/artifact-types";
import { Button } from "@chief/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";

import type { WorkspaceChannelId } from "../lib/workspace-channels";
import { useAuth } from "../lib/auth/auth-context";
import { chiefArtifacts } from "../lib/chief-artifacts";
import { useExecutorArtifacts } from "../lib/executor-artifacts";
import { ArtifactPreview } from "./artifact-preview";

export function ChannelArtifactsMenu({
  channelId,
  onContinue,
}: {
  channelId: WorkspaceChannelId;
  onContinue: (artifact: ExecutorArtifactSummary) => void;
}) {
  const { cloudOrganizationId } = useAuth();
  const { artifacts } = useExecutorArtifacts(cloudOrganizationId);
  const relevant = chiefArtifacts(artifacts).filter(
    (artifact) => artifact.channelId === channelId,
  );

  if (relevant.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`${relevant.length} created outputs in this channel`}
        >
          <PanelsTopLeft size={13} />
          {relevant.length} {relevant.length === 1 ? "output" : "outputs"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] p-2">
        <div className="px-2 pt-1 pb-2">
          <p className="text-xs font-medium">Created in #{channelId}</p>
          <p className="text-muted-foreground mt-0.5 text-[11px]">
            Durable work Chief can reopen and improve with you.
          </p>
        </div>
        <div className="max-h-[440px] space-y-1 overflow-y-auto">
          {relevant.map((artifact) => (
            <button
              key={artifact.id}
              type="button"
              onClick={() => onContinue(artifact)}
              className="hover:bg-accent group flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors"
            >
              <span className="bg-muted/40 relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border">
                <ArtifactPreview artifact={artifact} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {artifact.title}
                </span>
                <span className="text-muted-foreground mt-1 line-clamp-2 text-[11px] leading-4">
                  {artifact.description ?? "Created by Chief in this channel."}
                </span>
              </span>
              <ArrowUpRight
                size={14}
                className="text-muted-foreground shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
