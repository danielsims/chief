import type { ExecutorArtifactSummary } from "@chief/agent-runtime/artifact-types";

import type { WorkspaceChannelId } from "./workspace-channels";
import { channelForText } from "./workspace-channels";

export interface ChiefArtifact extends ExecutorArtifactSummary {
  channelId: WorkspaceChannelId;
}

/**
 * Chief adds product meaning to Executor's durable artifact primitive without
 * changing the local service contract. The same type follows an output across
 * channels, search, and product surfaces.
 */
export function classifyArtifact(
  artifact: ExecutorArtifactSummary,
): WorkspaceChannelId {
  return channelForText(`${artifact.title} ${artifact.description ?? ""}`);
}

export function chiefArtifacts(
  artifacts: ExecutorArtifactSummary[],
): ChiefArtifact[] {
  return artifacts.map((artifact) => ({
    ...artifact,
    channelId: classifyArtifact(artifact),
  }));
}
