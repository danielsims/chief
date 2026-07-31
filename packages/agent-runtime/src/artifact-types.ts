export interface ExecutorArtifactSummary {
  id: string;
  title: string;
  description: string | null;
  preview: { kind: "layout"; markup: string } | null;
  createdAt: number;
  updatedAt: number;
}

export interface ListArtifactsMessage {
  type: "listArtifacts";
  workspaceId: string;
  executorCapability: { apiBaseUrl: string; token: string };
}

export interface ArtifactsMessage {
  type: "artifacts";
  workspaceId: string;
  artifacts: ExecutorArtifactSummary[];
}
