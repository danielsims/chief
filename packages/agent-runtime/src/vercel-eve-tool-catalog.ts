import { channelApiOperations } from "@chief/channel-api";

type ChannelOperationId = (typeof channelApiOperations)[number]["operationId"];

export type EveChiefToolExecute = "relay";

export interface EveChiefToolSpec {
  operationId: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  description: string;
  execute: EveChiefToolExecute;
  input: Readonly<Record<string, string>>;
}

function channelOperation(operationId: ChannelOperationId) {
  const match = channelApiOperations.find(
    (operation) => operation.operationId === operationId,
  );
  if (!match) {
    throw new Error(`Unknown channel operation: ${operationId}`);
  }
  return match;
}

function defineEveChannelTool<Id extends ChannelOperationId>(input: {
  operationId: Id;
  input: Readonly<Record<string, string>>;
  description?: string;
}): EveChiefToolSpec {
  const canonical = channelOperation(input.operationId);
  return {
    operationId: canonical.operationId,
    method: canonical.method,
    path: canonical.path,
    description: input.description ?? canonical.description,
    execute: "relay",
    input: input.input,
  };
}

export function eveToolFileSlug(operationId: string) {
  return operationId.replaceAll(".", "_");
}

export const eveChiefChannelTools: readonly EveChiefToolSpec[] = [
  defineEveChannelTool({
    operationId: "channels.list",
    input: {
      includeArchived: 'z.enum(["true", "false"]).optional()',
      query: "z.string().min(1).max(120).optional()",
    },
  }),
  defineEveChannelTool({
    operationId: "channels.get",
    input: { channelId: "z.string().min(1)" },
  }),
  defineEveChannelTool({
    operationId: "channels.members.list",
    description:
      "Lists people and agents in this channel with name, role, and principal id. Use those names and ids when addressing someone. People are users, not the Chief agent.",
    input: { channelId: "z.string().min(1)" },
  }),
  defineEveChannelTool({
    operationId: "channels.messages.list",
    input: {
      channelId: "z.string().min(1)",
      cursor: "z.string().min(1).max(240).optional()",
      limit: "z.number().int().min(1).max(100).optional()",
    },
  }),
  defineEveChannelTool({
    operationId: "channels.messages.get",
    input: {
      channelId: "z.string().min(1)",
      messageId: "z.string().min(1)",
    },
  }),
  defineEveChannelTool({
    operationId: "channels.messages.post",
    description:
      "Publishes a user-visible Chief message or thread reply. Address people and agents with @Name and include their principal IDs in mentions. Channel members.list returns each person's name, role, and id. Never invent a @chief (user) tag — mention the actual person.",
    input: {
      channelId: "z.string().min(1)",
      content: "z.string().min(1).max(8000)",
      threadRootId: "z.string().min(1).max(160).optional()",
      mentions: "z.array(z.string().min(1).max(120)).max(20).optional()",
      idempotencyKey: "z.string().min(1).max(120).optional()",
    },
  }),
  defineEveChannelTool({
    operationId: "channels.messages.replies",
    input: {
      channelId: "z.string().min(1)",
      messageId: "z.string().min(1)",
      cursor: "z.string().min(1).max(240).optional()",
      limit: "z.number().int().min(1).max(100).optional()",
    },
  }),
  defineEveChannelTool({
    operationId: "channels.reactions.list",
    input: {
      channelId: "z.string().min(1)",
      messageId: "z.string().min(1)",
    },
  }),
  defineEveChannelTool({
    operationId: "channels.reactions.add",
    description:
      "Adds one idempotent emoji reaction as this agent. Use emoji 👀 on the triggering user message before any other work tool.",
    input: {
      channelId: "z.string().min(1)",
      messageId: "z.string().min(1)",
      emoji: "z.string().min(1).max(80)",
    },
  }),
  defineEveChannelTool({
    operationId: "channels.reactions.remove",
    description:
      "Removes this agent's matching reaction without changing anybody else's reactions.",
    input: {
      channelId: "z.string().min(1)",
      messageId: "z.string().min(1)",
      emoji: "z.string().min(1).max(80)",
    },
  }),
];

export const eveChiefLocalTools: readonly EveChiefToolSpec[] = [
  {
    operationId: "projects.list",
    method: "GET",
    path: "/local-tools/projects",
    description:
      "Lists Git projects attached to this workspace, including each repository's canonical remote URL. Clone, fetch, and push with Eve bash against those remotes. If this returns zero projects, call projects.recommend so the user can attach a repository from a card — do not ask them to paste a URL in chat.",
    execute: "relay",
    input: {},
  },
  {
    operationId: "projects.recommend",
    method: "POST",
    path: "/local-tools/channels/{channelId}/projects/recommend",
    description:
      "Publishes a durable connect-repository card in the current conversation. Use this when projects.list is empty or the user still needs to attach the repo. Optional remoteUrl prefills the card.",
    execute: "relay",
    input: {
      channelId: "z.string().min(1)",
      content: "z.string().min(1).max(1000)",
      remoteUrl: "z.string().url().max(2048).optional()",
      threadRootId: "z.string().min(1).max(160).optional()",
      idempotencyKey: "z.string().min(1).max(120)",
    },
  },
];

export const eveChiefTools: readonly EveChiefToolSpec[] = [
  ...eveChiefChannelTools,
  ...eveChiefLocalTools,
];

export const eveChiefToolOperationIds = eveChiefTools.map(
  (tool) => tool.operationId,
);
