import type * as schema from "./db/schema.js";
import type {
  AgentMessageMetadata,
  ChatStatus,
  LocalChatRecord,
  LocalMessage,
} from "./local-store.js";
import type {
  AgentEvent,
  ChiefUIMessage,
  ContentBlock,
  DriverType,
  SessionRecord,
} from "./types.js";

function userTexts(events: AgentEvent[]) {
  const texts: string[] = [];
  for (const event of events) {
    if (event.type !== "message" || event.role !== "user") continue;
    const text = event.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim();
    if (text) texts.push(text);
  }
  return texts;
}

function durableEvents(events: AgentEvent[]) {
  return events.filter(
    (event) =>
      event.type === "message" ||
      event.type === "result" ||
      event.type === "error" ||
      event.type === "permissionResolved",
  );
}

function eventMessage(event: AgentEvent) {
  if (event.type === "message") {
    return {
      role: event.role,
      parts: event.content,
      ...(event.threadRootId || event.mentions?.length || event.channelAction
        ? {
            metadata: {
              type: "channel" as const,
              ...(event.threadRootId
                ? { threadRootId: event.threadRootId }
                : undefined),
              ...(event.mentions?.length
                ? { mentions: event.mentions }
                : undefined),
              ...(event.channelAction
                ? { channelAction: event.channelAction }
                : undefined),
            } satisfies AgentMessageMetadata,
          }
        : undefined),
    } as const;
  }
  if (
    event.type === "result" ||
    event.type === "error" ||
    event.type === "permissionResolved"
  ) {
    return {
      role: "assistant" as const,
      parts: [],
      metadata: event satisfies AgentMessageMetadata,
    };
  }
  return undefined;
}

function uiParts(blocks: ContentBlock[]): ChiefUIMessage["parts"] {
  return blocks.map((block): ChiefUIMessage["parts"][number] => {
    switch (block.type) {
      case "image":
        return {
          type: "file",
          mediaType: block.mediaType,
          filename: block.name,
          url: block.url,
        };
      case "thinking":
        return { type: "reasoning", text: block.thinking };
      case "tool_use":
        return {
          type: "dynamic-tool",
          toolName: block.name,
          toolCallId: block.id,
          state: "input-available",
          input: block.input,
        };
      case "tool_result":
        return block.is_error
          ? {
              type: "dynamic-tool",
              toolName: "tool",
              toolCallId: block.tool_use_id,
              state: "output-error",
              input: undefined,
              errorText: String(block.content),
            }
          : {
              type: "dynamic-tool",
              toolName: "tool",
              toolCallId: block.tool_use_id,
              state: "output-available",
              input: undefined,
              output: block.content,
            };
      default:
        return block;
    }
  });
}

function contentBlocks(parts: ChiefUIMessage["parts"]): ContentBlock[] {
  return parts.flatMap((part): ContentBlock[] => {
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
        input: part.input,
      };
      if (part.state === "output-available") {
        return [
          use,
          {
            type: "tool_result",
            tool_use_id: part.toolCallId,
            content: part.output,
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
      part.type === "data-document"
    ) {
      return [part];
    }
    return [];
  });
}

function uiEventMessages(events: AgentEvent[]) {
  const messages: {
    sourceId?: string;
    role: "user" | "assistant";
    parts: ChiefUIMessage["parts"];
    metadata?: AgentMessageMetadata;
  }[] = [];
  for (const event of events) {
    const converted = eventMessage(event);
    if (!converted) continue;
    if (event.type !== "message") {
      messages.push({
        role: converted.role,
        parts: [],
        metadata: converted.metadata,
      });
      continue;
    }

    let mergedToolTarget: (typeof messages)[number] | undefined;
    const remaining = event.content.filter((block) => {
      if (
        mergedToolTarget &&
        (block.type === "data-chart" ||
          block.type === "data-table" ||
          block.type === "data-document")
      ) {
        const part = uiParts([block])[0];
        if (
          part &&
          !mergedToolTarget.parts.some(
            (candidate) =>
              candidate.type === part.type &&
              "id" in candidate &&
              "id" in part &&
              candidate.id === part.id,
          )
        ) {
          mergedToolTarget.parts.push(part);
        }
        return false;
      }
      mergedToolTarget = undefined;
      if (block.type !== "tool_result") return true;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const prior = messages[index];
        if (prior?.role !== "assistant") continue;
        const partIndex = prior.parts.findIndex(
          (part) =>
            part.type === "dynamic-tool" &&
            part.toolCallId === block.tool_use_id,
        );
        if (partIndex < 0) continue;
        const part = prior.parts[partIndex];
        if (part?.type !== "dynamic-tool") return false;
        prior.parts = prior.parts.map((candidate, candidateIndex) =>
          candidateIndex === partIndex
            ? block.is_error
              ? {
                  ...part,
                  state: "output-error" as const,
                  input: part.input,
                  errorText: String(block.content),
                }
              : {
                  ...part,
                  state: "output-available" as const,
                  input: part.input,
                  output: block.content,
                }
            : candidate,
        ) as ChiefUIMessage["parts"];
        mergedToolTarget = prior;
        return false;
      }
      return true;
    });
    if (remaining.length === 0) continue;
    const nextParts = uiParts(remaining).filter((part, index, parts) => {
      if (part.type !== "dynamic-tool") return true;
      const matching = (candidate: ChiefUIMessage["parts"][number]) =>
        candidate.type === "dynamic-tool" &&
        candidate.toolCallId === part.toolCallId;
      let matchingIndex = -1;
      let completedIndex = -1;
      for (
        let candidateIndex = parts.length - 1;
        candidateIndex >= 0;
        candidateIndex--
      ) {
        const candidate = parts[candidateIndex];
        if (!candidate || !matching(candidate)) continue;
        if (matchingIndex < 0) matchingIndex = candidateIndex;
        if (
          candidate.type === "dynamic-tool" &&
          (candidate.state === "output-available" ||
            candidate.state === "output-error")
        ) {
          completedIndex = candidateIndex;
          break;
        }
      }
      return index === (completedIndex >= 0 ? completedIndex : matchingIndex);
    });
    let prior: (typeof messages)[number] | undefined;
    if (event.id) {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const candidate = messages[index];
        if (candidate?.sourceId === event.id && candidate.role === event.role) {
          prior = candidate;
          break;
        }
      }
    }
    if (prior) {
      for (const part of nextParts) {
        if (part.type === "dynamic-tool") {
          const index = prior.parts.findIndex(
            (candidate) =>
              candidate.type === "dynamic-tool" &&
              candidate.toolCallId === part.toolCallId,
          );
          if (index >= 0) {
            const existing = prior.parts[index];
            const existingDone =
              existing?.type === "dynamic-tool" &&
              (existing.state === "output-available" ||
                existing.state === "output-error");
            if (!existingDone) prior.parts[index] = part;
            continue;
          }
        }
        if (
          part.type === "text" &&
          prior.parts.some(
            (candidate) =>
              candidate.type === "text" && candidate.text === part.text,
          )
        ) {
          continue;
        }
        prior.parts.push(part);
      }
      continue;
    }
    messages.push({
      sourceId: event.id,
      role: event.role,
      parts: nextParts,
      metadata: converted.metadata,
    });
  }
  return messages;
}

function agentEvent(message: LocalMessage): AgentEvent | undefined {
  if (message.metadata?.type === "channel") {
    return {
      type: "message",
      id: message.id,
      role: message.role === "system" ? "user" : message.role,
      content: contentBlocks(message.parts as ChiefUIMessage["parts"]),
      ...(message.metadata.threadRootId
        ? { threadRootId: message.metadata.threadRootId }
        : undefined),
      ...(message.metadata.mentions?.length
        ? { mentions: message.metadata.mentions }
        : undefined),
      ...(message.metadata.channelAction
        ? { channelAction: message.metadata.channelAction }
        : undefined),
    };
  }
  if (message.metadata) return message.metadata;
  if (message.role === "system") return undefined;
  return {
    type: "message",
    id: message.id,
    role: message.role,
    content: contentBlocks(message.parts as ChiefUIMessage["parts"]),
  };
}

function eventKey(message: {
  role: string;
  parts: unknown[];
  metadata?: unknown;
}) {
  return JSON.stringify([
    message.role,
    message.parts,
    message.metadata ?? null,
  ]);
}

function transcriptStatus(events: AgentEvent[]): ChatStatus | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (!event) continue;
    if (event.type === "error") return "failed";
    if (event.type === "result") return event.ok ? "completed" : "failed";
    if (event.type === "status")
      return event.status === "error" ? "failed" : event.status;
  }
  return undefined;
}

function driver(provider: string): DriverType | undefined {
  return provider === "claude" ||
    provider === "codex" ||
    provider === "opencode" ||
    provider === "remote"
    ? provider
    : undefined;
}

function localChatRecord(
  row: typeof schema.sessions.$inferSelect,
): LocalChatRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    parentId: row.parentId ?? undefined,
    triggerId: row.triggerId ?? undefined,
    triggerContext: row.triggerContext ?? undefined,
    scheduleId: row.scheduleId ?? undefined,
    kind: row.kind,
    visibility: row.visibility,
    agent: row.agent,
    title: row.title,
    lastText: row.lastText,
    provider: row.provider,
    model: row.model ?? undefined,
    providerState: row.providerState ?? undefined,
    eveState: row.eveState ?? undefined,
    status: row.status,
    scheduledFor: row.scheduledFor ?? undefined,
    startedAt: row.startedAt ?? undefined,
    finishedAt: row.finishedAt ?? undefined,
    attempt: row.attempt,
    summary: row.summary ?? undefined,
    error: row.error ?? undefined,
    artifacts: row.artifacts ?? undefined,
    blockedTools: row.blockedTools ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function sessionRecord(
  row: typeof schema.sessions.$inferSelect,
): SessionRecord {
  const chat = localChatRecord(row);
  return {
    id: chat.id,
    parentId: chat.parentId,
    triggerId: chat.triggerId,
    triggerContext: chat.triggerContext,
    scheduleId: chat.scheduleId,
    kind: chat.kind,
    visibility: chat.visibility,
    agent: chat.agent,
    title: chat.title,
    provider: chat.provider,
    model: chat.model,
    status: chat.status,
    scheduledFor: chat.scheduledFor,
    startedAt: chat.startedAt,
    finishedAt: chat.finishedAt,
    attempt: chat.attempt,
    summary: chat.summary,
    error: chat.error,
    artifacts: chat.artifacts,
    blockedTools: chat.blockedTools,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  };
}

export {
  agentEvent,
  driver,
  durableEvents,
  eventKey,
  localChatRecord,
  sessionRecord,
  transcriptStatus,
  uiEventMessages,
  userTexts,
};
