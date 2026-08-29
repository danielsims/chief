import type { UIMessage } from "ai";

import type {
  AgentPluginSummary,
  PluginAuthorizationAction,
} from "@chief/plugin-api";
import type { JsonValue } from "@chief/relay-contracts";

export type AgentStatus = "idle" | "running" | "waiting" | "error";

export interface AgentQuestionOption {
  label: string;
  description?: string;
  /** Selecting this option asks the user to provide their own answer. */
  allowsFreeText?: boolean;
}

export interface AgentQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  allowFreeform?: boolean;
  dismissible?: boolean;
  options: AgentQuestionOption[];
}

export interface GenerativeChartPoint {
  x: string;
  value: number;
}

export interface GenerativeChartSeries {
  id: string;
  label: string;
  points: GenerativeChartPoint[];
}

export interface GenerativeChartData {
  kind: "line";
  title: string;
  subtitle?: string;
  xLabel?: string;
  yLabel: string;
  series: GenerativeChartSeries[];
}

export interface GenerativeTableData {
  title: string;
  subtitle?: string;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | boolean | null>[];
}

export type AnalyticsMetricFormat =
  "number" | "currency" | "percent" | "duration";

export interface AnalyticsMetricDefinition {
  key: string;
  label: string;
  format: AnalyticsMetricFormat;
  unit?: string;
  currency?: string;
}

export interface AnalyticsDimensionDefinition {
  key: string;
  label: string;
}

export interface AnalyticsMetricValue {
  metric: string;
  value: number;
}

export interface AnalyticsDatasetPeriod {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  values: AnalyticsMetricValue[];
}

export interface AnalyticsDatasetRow {
  dimensions: { dimension: string; value: string }[];
  values: AnalyticsMetricValue[];
}

export interface AnalyticsDatasetSeries extends GenerativeChartSeries {
  metric: string;
}

export interface AnalyticsDatasetChart {
  kind: "line";
  title: string;
  subtitle?: string;
  xLabel?: string;
  yLabel: string;
  series: string[];
}

export interface AnalyticsDataset {
  provider: string;
  key: string;
  sourceId?: string;
  title: string;
  description?: string;
  metrics: AnalyticsMetricDefinition[];
  dimensions: AnalyticsDimensionDefinition[];
  periods: AnalyticsDatasetPeriod[];
  rows?: AnalyticsDatasetRow[];
  series?: AnalyticsDatasetSeries[];
  charts?: AnalyticsDatasetChart[];
  provenance?: {
    operation?: string;
    query?: { key: string; value: string }[];
    notes?: string;
  };
  capturedAt: number;
}

export interface WorkspaceFileRecord {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  kind: "document" | "email";
  provider: "local";
  currentVersionId: string;
  createdBy: "agent" | "user";
  sourceAgentId?: string;
  sourceSessionId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceFileSnapshot extends WorkspaceFileRecord {
  content: string;
}

export interface WorkspaceFileWrite {
  id?: string;
  name: string;
  path?: string;
  mimeType?: string;
  kind?: "document" | "email";
  content: string;
  expectedVersionId?: string;
  createdBy: "agent" | "user";
  sourceAgentId?: string;
  sourceSessionId?: string;
}

export interface GenerativeDocumentData {
  fileId: string;
  title: string;
  path: string;
  kind: "document" | "email";
  versionId: string;
}

export interface GenerativePluginRecommendationsData {
  plugins: AgentPluginSummary[];
  authorizations?: PluginAuthorizationAction[];
  workspaceId?: string;
  conversationId?: string;
  threadRootId?: string;
  agentId?: string;
  recommendationId?: string;
}

/**
 * Chief's persistent custom UI parts follow AI SDK 7's typed `data-*`
 * contract. The websocket transport remains provider-neutral; every driver
 * can emit the same chart part and every client can render it consistently.
 */
export type ChiefMessageEventMetadata =
  | {
      type: "result";
      ok: boolean;
      costUsd?: number;
      durationMs?: number;
      error?: string;
    }
  | {
      type: "error";
      message: string;
      title?: string;
      code?: string;
      agentId?: string;
    }
  | {
      type: "permissionResolved";
      requestId: string;
      behavior: "allow" | "deny";
    };

export interface ChiefMessageMetadata {
  createdAt: number;
  event?: ChiefMessageEventMetadata;
  /** Agent that authored a shared-channel message. */
  agentId?: string;
  /** The top-level channel message this reply belongs to. */
  threadRootId?: string;
  /** Stable user or agent identities explicitly addressed by this message. */
  mentions?: string[];
  /** Ephemeral desktop delivery intent. It is not copied into durable agent
   * events, but keeps a busy-turn follow-up attached to its own message while
   * the transport sends it. */
  interruptActive?: boolean;
  /** Durable channel lifecycle event rendered separately from authored chat. */
  channelAction?: {
    type: "member-added";
    actorName: string;
    actorId?: string;
    actorType?: "user" | "agent";
    agentIds: string[];
    userIds?: string[];
  };
}

export type ChiefUIMessage = UIMessage<
  ChiefMessageMetadata,
  {
    chart: GenerativeChartData;
    table: GenerativeTableData;
    document: GenerativeDocumentData;
    "plugin-recommendations": GenerativePluginRecommendationsData;
  }
>;

export type GenerativeChartBlock = Extract<
  ChiefUIMessage["parts"][number],
  { type: "data-chart" }
>;

export type GenerativeTableBlock = Extract<
  ChiefUIMessage["parts"][number],
  { type: "data-table" }
>;

export type GenerativeDocumentBlock = Extract<
  ChiefUIMessage["parts"][number],
  { type: "data-document" }
>;

export type GenerativePluginRecommendationsBlock = Extract<
  ChiefUIMessage["parts"][number],
  { type: "data-plugin-recommendations" }
>;

export interface MessageAttachment {
  name: string;
  mediaType: string;
  url: string;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | ({ type: "image" } & MessageAttachment)
  | { type: "thinking"; thinking: string }
  | GenerativeChartBlock
  | GenerativeTableBlock
  | GenerativeDocumentBlock
  | GenerativePluginRecommendationsBlock
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: JsonValue | undefined;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: JsonValue | undefined;
      is_error?: boolean;
    };

export type AgentEvent =
  | { type: "init"; sessionId: string; model?: string }
  | { type: "stream"; text: string }
  /** Provider reasoning delta. Transient by design: cells project it to the
   * relay, while session history stores only the completed thinking block. */
  | { type: "thinkingStream"; text: string }
  | {
      type: "toolProgress";
      toolUseId: string;
      text: string;
    }
  | {
      type: "message";
      id?: string;
      role: "assistant" | "user";
      content: ContentBlock[];
      threadRootId?: string;
      mentions?: string[];
      channelAction?: ChiefMessageMetadata["channelAction"];
    }
  | {
      type: "result";
      ok: boolean;
      costUsd?: number;
      durationMs?: number;
      error?: string;
    }
  | {
      type: "permission";
      requestId: string;
      toolName: string;
      input: unknown;
      /** Channel thread whose turn requested this decision. */
      threadRootId?: string;
    }
  /** Emitted once a permission request has been answered, so replayed
   * transcripts don't resurrect stale approval prompts. */
  | {
      type: "permissionResolved";
      requestId: string;
      behavior: "allow" | "deny";
    }
  /** The agent asked the user structured questions; the UI renders them and
   * answers via respondQuestion for any supported driver. */
  | {
      type: "question";
      requestId: string;
      questions: AgentQuestion[];
    }
  | { type: "questionResolved"; requestId: string }
  | { type: "status"; status: AgentStatus }
  | {
      type: "error";
      message: string;
      title?: string;
      code?: string;
      agentId?: string;
    }
  | { type: "exit"; code: number | null };
