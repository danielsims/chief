import { useEffect, useState } from "react";

import type {
  AgentEvent,
  ChiefUIMessage,
  ContentBlock,
  DiagnosticEventRecord,
  SessionRecord,
} from "@chief/agent-runtime/types";
import { parseJsonValue } from "@chief/relay-contracts";

import { useRuntime } from "./runtime-provider";
import { useWorkspaceCapability } from "./workspace-capability";

/** Durable NIP-29 events for channel timelines and message search. */

interface DiagnosticsState {
  sessions: SessionRecord[];
  events: DiagnosticEventRecord[];
}

const diagnosticsCache = new Map<string, DiagnosticsState>();

export function useDiagnostics(workspaceId: string | null) {
  const { client, status } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const [state, setState] = useState<
    DiagnosticsState & { workspaceId: string | null; loaded: boolean }
  >(() => {
    const cached = workspaceId ? diagnosticsCache.get(workspaceId) : undefined;
    return {
      workspaceId,
      sessions: cached?.sessions ?? [],
      events: cached?.events ?? [],
      loaded: Boolean(cached),
    };
  });
  const cached = workspaceId ? diagnosticsCache.get(workspaceId) : undefined;
  const active =
    state.workspaceId === workspaceId
      ? state
      : {
          workspaceId,
          sessions: cached?.sessions ?? [],
          events: cached?.events ?? [],
          loaded: Boolean(cached),
        };

  useEffect(() => {
    if (
      !workspaceId ||
      workspaceId !== cloudOrganizationId ||
      !capability ||
      status !== "connected"
    ) {
      return;
    }
    const unsubscribe = client.subscribe((message) => {
      if (
        message.type === "diagnostics" &&
        message.workspaceId === workspaceId
      ) {
        const next = {
          sessions: message.sessions,
          events: message.events,
        };
        diagnosticsCache.set(workspaceId, next);
        setState({ workspaceId, ...next, loaded: true });
      }
    });
    client.send({
      type: "listDiagnostics",
      workspaceId,
      executorCapability: capability,
    });
    return () => {
      unsubscribe();
    };
  }, [capability, client, cloudOrganizationId, status, workspaceId]);

  return {
    sessions: active.sessions,
    events: active.events,
    loading: Boolean(workspaceId && !active.loaded),
  };
}

/**
 * Which required secret keys already exist on this machine, and a way to
 * store new ones, with no agent session involved. Used to gate Connect
 * buttons behind credential collection for integrations that are known to
 * need values only the user can provide.
 */
export {
  useAgentPreferences,
  useWorkspaceEmailPreview,
  useWorkspaceFile,
  useWorkspaceFiles,
} from "./runtime-files";
export {
  useDisconnectGoogleAnalytics,
  useStoredInputs,
  useWorkspaceEnvironmentVariables,
} from "./runtime-settings";

export type {
  ChatControlState,
  PendingApproval,
  PendingQuestion,
} from "./runtime-chat-controls";

export function messageBlocks(message: ChiefUIMessage): ContentBlock[] {
  return message.parts.flatMap((part): ContentBlock[] => {
    if (part.type === "text") return [{ type: "text", text: part.text }];
    if (part.type === "file" && part.mediaType.startsWith("image/")) {
      return [
        {
          type: "image",
          name: part.filename ?? "Image",
          mediaType: part.mediaType,
          url: part.url,
        },
      ];
    }
    if (part.type === "reasoning") {
      return [{ type: "thinking", thinking: part.text }];
    }
    if (part.type === "dynamic-tool") {
      const use: ContentBlock = {
        type: "tool_use",
        id: part.toolCallId,
        name: part.toolName,
        input: parseJsonValue(part.input),
      };
      if (part.state === "output-available") {
        return [
          use,
          {
            type: "tool_result",
            tool_use_id: part.toolCallId,
            content: parseJsonValue(part.output) ?? null,
          },
        ];
      }
      if (part.state === "output-error") {
        return [
          use,
          {
            type: "tool_result",
            tool_use_id: part.toolCallId,
            content: part.errorText,
            is_error: true,
          },
        ];
      }
      return [use];
    }
    if (
      part.type === "data-chart" ||
      part.type === "data-table" ||
      part.type === "data-document" ||
      part.type === "data-plugin-recommendations"
    ) {
      return [part];
    }
    return [];
  });
}

export function replayStreamingText(events: AgentEvent[]) {
  let text = "";
  for (const event of events) {
    if (event.type === "stream") text += event.text;
    if (
      event.type === "message" ||
      event.type === "result" ||
      event.type === "error" ||
      event.type === "exit"
    ) {
      text = "";
    }
  }
  return text;
}
