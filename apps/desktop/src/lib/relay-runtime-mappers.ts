import type {
  AgentPluginSummary,
  ChannelEvent,
  ChiefUIMessage,
  ContentBlock,
  PluginAuthorizationAction,
  ServerMessage,
} from "@chief/agent-runtime/types";
import type {
  ConversationMessage,
  MessageComponent,
  WorkspaceSnapshot,
} from "@chief/relay-contracts";
import {
  isJsonObject,
  isJsonString,
  pluginAuthorizationPayloadSchema,
  pluginRecommendationPayloadSchema,
} from "@chief/relay-contracts";

import { channelActionFromComponent } from "./channel-actions";

const activityComponentKinds = new Set([
  "agent.activity",
  "thinking",
  "tool",
  "error",
  "browser",
]);

export function browserRuntimeEvent(
  message: ConversationMessage,
): ServerMessage | undefined {
  const component = message.components.find(
    (candidate) => candidate.kind === "browser" && candidate.version === 1,
  );
  if (!component || message.author.kind !== "agent") return undefined;
  const browserRunId = component.payload.browserRunId;
  const status = component.payload.status;
  if (!isJsonString(browserRunId)) return undefined;
  if (status === "closed") {
    return {
      type: "browserClosed",
      browserRunId,
      workspaceId: message.workspaceId,
      conversationId: message.conversationId,
    };
  }
  const url = component.payload.url;
  const streamUrl = component.payload.streamUrl;
  if (status !== "active" || !isJsonString(url) || !isJsonString(streamUrl)) {
    return undefined;
  }
  const event = {
    type: "browserNavigate",
    browserRunId,
    workspaceId: message.workspaceId,
    conversationId: message.conversationId,
    anchorMessageId: message.id,
    url,
    streamUrl,
  } as const;
  return message.threadRootId
    ? { ...event, threadRootId: message.threadRootId }
    : event;
}

export function isAgentActivityProjection(message: ConversationMessage) {
  return (
    message.author.kind === "agent" &&
    !message.body.trim() &&
    message.components.length > 0 &&
    message.components.every((component) =>
      activityComponentKinds.has(component.kind),
    )
  );
}

export function agentRunEvent(message: ConversationMessage) {
  if (isAgentActivityProjection(message)) {
    const error = message.components.find(
      (component) => component.kind === "error",
    );
    if (error) {
      return {
        type: "error" as const,
        agentId: message.author.id,
        ...(isJsonString(error.payload.code)
          ? { code: error.payload.code }
          : undefined),
        ...(isJsonString(error.payload.title)
          ? { title: error.payload.title }
          : undefined),
        message: isJsonString(error.payload.message)
          ? error.payload.message
          : "The agent run was interrupted.",
      };
    }
    return { type: "status" as const, status: "running" as const };
  }
  return message.author.kind === "agent"
    ? { type: "result" as const, ok: true }
    : undefined;
}

export function toChiefMessage(message: ConversationMessage): ChiefUIMessage {
  const channelAction = message.components
    .map(channelActionFromComponent)
    .find((action) => action !== undefined);
  return {
    id: message.id,
    role: message.author.kind === "user" ? "user" : "assistant",
    metadata: {
      createdAt: Date.parse(message.createdAt),
      ...(message.author.kind === "agent"
        ? { agentId: message.author.id }
        : undefined),
      ...(message.threadRootId
        ? { threadRootId: message.threadRootId }
        : undefined),
      ...(message.mentions.length > 0
        ? { mentions: message.mentions }
        : undefined),
      ...(channelAction ? { channelAction } : undefined),
    },
    parts: [
      { type: "text", text: message.deleted ? "" : message.body },
      ...messageComponentParts(message),
    ],
  };
}

export function toChannelMessageEvent(
  message: ConversationMessage,
  snapshot: WorkspaceSnapshot,
): ChannelEvent {
  const actor =
    message.author.kind === "agent"
      ? {
          type: "agent" as const,
          id: message.author.id,
          name:
            snapshot.agents.find((agent) => agent.id === message.author.id)
              ?.name ?? message.author.id,
        }
      : {
          type: "user" as const,
          id: message.author.id,
          name: message.author.kind === "system" ? "Chief" : "You",
        };
  return {
    protocol: "nip29",
    id: message.id,
    channelId: message.conversationId,
    pubkey: actor.id,
    tags: [
      ["h", message.conversationId],
      ...(message.threadRootId ? [["e", message.threadRootId]] : []),
      ...message.mentions.map((mention) => ["p", mention]),
    ],
    content: message.deleted ? "" : message.body,
    parts: messageComponentParts(message),
    actor,
    createdAt: Date.parse(message.createdAt),
    kind: 9,
  };
}

export function toChannelEvents(
  message: ConversationMessage,
  snapshot: WorkspaceSnapshot,
  currentPubkey: string | null,
): ChannelEvent[] {
  if (isAgentActivityProjection(message)) return [];
  const messageEvent = toChannelMessageEvent(message, snapshot);
  const reactions = message.reactions.flatMap((reaction) =>
    reaction.pubkeys.map((pubkey): ChannelEvent => ({
      protocol: "nip29",
      id: `reaction:${message.id}:${reaction.emoji}:${pubkey}`,
      channelId: message.conversationId,
      pubkey,
      tags: [
        ["h", message.conversationId],
        ["e", message.id],
      ],
      content: reaction.emoji,
      actor:
        pubkey === currentPubkey
          ? { type: "user", id: "workspace-owner", name: "You" }
          : { type: "user", id: pubkey, name: "Workspace member" },
      createdAt: Date.parse(message.createdAt),
      kind: 7,
    })),
  );
  return [messageEvent, ...reactions];
}

export function directAgentId(
  conversationId: string,
  snapshot: WorkspaceSnapshot,
) {
  const conversation = snapshot.conversations.find(
    (candidate) => candidate.id === conversationId,
  );
  return conversation?.kind === "direct"
    ? agentForDirect(conversation.name, snapshot)
    : undefined;
}

export function agentForDirect(name: string, snapshot: WorkspaceSnapshot) {
  const normalized = name.toLowerCase();
  return (
    snapshot.agents.find(
      (agent) =>
        normalized.includes(agent.id.toLowerCase()) ||
        normalized.includes(agent.name.toLowerCase()),
    )?.id ?? "chief"
  );
}

function messageComponentParts(
  message: ConversationMessage,
): ChiefUIMessage["parts"] {
  return [
    ...activityParts(message.components),
    ...pluginRecommendationParts(message),
  ];
}

function pluginRecommendationParts(
  message: ConversationMessage,
): ChiefUIMessage["parts"] {
  const recommended = message.components.flatMap((component) => {
    if (component.kind !== "plugin.recommendation") return [];
    const parsed = pluginRecommendationPayloadSchema.safeParse(
      component.payload,
    );
    if (!parsed.success) return [];
    const value = parsed.data;
    const domain =
      value.domain ?? pluginHostname(value.homepage) ?? value.pluginId;
    const source: AgentPluginSummary["source"] =
      value.sourceType === "setup"
        ? { type: "setup", domain }
        : { type: "discovery", registry: "chief-relay", domain };
    return [
      {
        id: value.pluginId,
        name: value.name,
        description: value.description,
        category: value.category,
        status: value.status,
        enabled: value.enabled,
        trusted: value.trusted,
        source,
        ...(value.homepage ? { homepage: value.homepage } : undefined),
        ...(value.iconUrl ? { iconUrl: value.iconUrl } : undefined),
        ...(value.domain ? { domains: [value.domain] } : undefined),
      } satisfies AgentPluginSummary,
    ];
  });
  const authorizations = message.components.flatMap((component) => {
    if (component.kind !== "plugin.authorization") return [];
    const parsed = pluginAuthorizationPayloadSchema.safeParse(
      component.payload,
    );
    if (!parsed.success) return [];
    const value = parsed.data;
    return [
      (value.status === "authorization_required"
        ? {
            kind: "plugin_authorization",
            pluginId: value.pluginId,
            pluginName: value.pluginName,
            description: value.description,
            provider: value.provider,
            authorizationUrl: value.authorizationUrl,
            status: value.status,
          }
        : {
            kind: value.kind,
            pluginId: value.pluginId,
            pluginName: value.pluginName,
            description: value.description,
            provider: value.provider,
            serverName: value.serverName,
            callbackUrl: value.callbackUrl,
            setupUrl: value.setupUrl,
            status: value.status,
          }) satisfies PluginAuthorizationAction,
    ];
  });
  const authorizationPlugins = authorizations.map(
    (authorization): AgentPluginSummary => ({
      id: authorization.pluginId,
      name: authorization.pluginName,
      description: authorization.description,
      category: "Integration",
      status: "waiting",
      enabled: true,
      trusted: true,
      source: {
        type: "discovery",
        registry: "chief-relay",
        domain: authorization.provider,
      },
      domains: [authorization.provider],
    }),
  );
  const plugins = [...recommended, ...authorizationPlugins];
  if (plugins.length === 0 || message.author.kind !== "agent") return [];
  return [
    {
      type: "data-plugin-recommendations",
      data: {
        plugins,
        ...(authorizations.length > 0 ? { authorizations } : undefined),
        workspaceId: message.workspaceId,
        conversationId: message.conversationId,
        ...(message.threadRootId
          ? { threadRootId: message.threadRootId }
          : undefined),
        agentId: message.author.id,
        recommendationId: message.id,
      },
    },
  ];
}

function pluginHostname(value?: string) {
  if (!value) return undefined;
  try {
    return new URL(value).hostname.replace(/^www\./u, "");
  } catch {
    return undefined;
  }
}

function activityParts(
  components: readonly MessageComponent[],
): ChiefUIMessage["parts"] {
  const blocks = components.flatMap(componentActivityBlocks);
  const results = new Map(
    blocks.flatMap((block) =>
      block.type === "tool_result" ? [[block.tool_use_id, block] as const] : [],
    ),
  );
  return blocks.flatMap((block): ChiefUIMessage["parts"] => {
    if (block.type === "thinking") {
      return [{ type: "reasoning", text: block.thinking }];
    }
    if (block.type !== "tool_use") return [];
    const result = results.get(block.id);
    if (!result) {
      return [
        {
          type: "dynamic-tool",
          toolCallId: block.id,
          toolName: block.name,
          input: block.input,
          state: "input-available",
        },
      ];
    }
    return [
      result.is_error
        ? {
            type: "dynamic-tool",
            toolCallId: block.id,
            toolName: block.name,
            input: block.input,
            state: "output-error",
            errorText: isJsonString(result.content)
              ? result.content
              : JSON.stringify(result.content),
          }
        : {
            type: "dynamic-tool",
            toolCallId: block.id,
            toolName: block.name,
            input: block.input,
            state: "output-available",
            output: result.content,
          },
    ];
  });
}

function componentActivityBlocks(component: MessageComponent): ContentBlock[] {
  if (component.kind === "agent.activity") {
    const block = component.payload.block;
    return isContentBlock(block) ? [block] : [];
  }
  if (component.kind === "thinking") {
    const text = component.payload.text;
    return isJsonString(text) && text.trim()
      ? [{ type: "thinking", thinking: text }]
      : [];
  }
  if (component.kind !== "tool") return [];
  const name = component.payload.name;
  if (!isJsonString(name) || !name.trim()) return [];
  const id = component.id;
  const use: ContentBlock = {
    type: "tool_use",
    id,
    name,
    input: component.payload.input ?? {},
  };
  const status = component.payload.status;
  if (status === "running" || status === "working") return [use];
  return [
    use,
    {
      type: "tool_result",
      tool_use_id: id,
      content:
        component.payload.output ?? component.payload.error ?? "Completed",
      ...(component.payload.error ? { is_error: true } : undefined),
    },
  ];
}

function isContentBlock(value: unknown): value is ContentBlock {
  if (!value || !isJsonObject(value) || Array.isArray(value)) return false;
  const block = value;
  if (block.type === "thinking") return isJsonString(block.thinking);
  if (block.type === "tool_use") {
    return isJsonString(block.id) && isJsonString(block.name);
  }
  if (block.type === "tool_result") {
    return isJsonString(block.tool_use_id);
  }
  return false;
}
