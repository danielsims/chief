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
    operationId: "channels.create",
    description:
      "Create a channel for a feature, campaign, or mission. Reuse a stable operationKey on retries. You are added as its owner. Use channels.members.add next to invite the mission team and relevant people before creating the mission.",
    input: {
      name: "z.string().trim().min(1).max(60)",
      operationKey: "z.string().regex(/^[a-z0-9][a-z0-9-]{5,79}$/)",
      visibility: 'z.enum(["public", "private"]).default("public")',
    },
  }),
  defineEveChannelTool({
    operationId: "channels.members.add",
    input: {
      channelId: "z.string().min(1).max(160)",
      members:
        'z.array(z.object({ type: z.enum(["user", "agent"]), id: z.string().min(1).max(120) })).min(1).max(20)',
      idempotencyKey: "z.string().min(1).max(120).optional()",
    },
  }),

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
    operationId: "files.list",
    method: "GET",
    path: "/local-tools/files",
    execute: "relay",
    description:
      "List documents and published media visible to you in this workspace. Private channel files require membership.",
    input: {},
  },
  {
    operationId: "files.read",
    method: "POST",
    path: "/local-tools/files/read",
    execute: "relay",
    description:
      "Read a workspace document and its current version, or metadata for a published media file.",
    input: { fileId: "z.string().min(1).max(160)" },
  },
  {
    operationId: "files.write",
    method: "POST",
    path: "/local-tools/files/write",
    execute: "relay",
    description:
      "Save a document to Files in the current conversation or a specified channel you can access. Read before revising; provide id and the current version converted to a string as expectedVersionId. Reuse the path for future revisions.",
    input: {
      id: "z.string().min(1).max(160).optional()",
      name: "z.string().min(1).max(240)",
      path: "z.string().min(1).max(512).optional()",
      content: "z.string().min(1).max(200000)",
      kind: 'z.enum(["document", "email"]).default("document")',
      conversationId: "z.string().min(1).max(160).optional()",
      expectedVersionId: "z.string().min(1).max(120).optional()",
    },
  },
  {
    operationId: "missions.list",
    method: "GET",
    path: "/local-tools/missions",
    execute: "relay",
    description:
      "Read this business's visible missions, status, and experiment history.",
    input: {},
  },
  {
    operationId: "missions.reportRunStep",
    method: "POST",
    path: "/local-tools/missions/run-step",
    execute: "relay",
    description:
      "Report your scheduled step completed with concrete evidence, or blocked with what is needed. Only the assigned agent can report an active step.",
    input: {
      runId: "z.string().min(1).max(256)",
      stepId: "z.string().uuid()",
      status: 'z.enum(["completed", "blocked"])',
      evidence: "z.string().min(1).max(4000)",
    },
  },
  {
    operationId: "missions.create",
    method: "POST",
    path: "/local-tools/missions",
    execute: "relay",
    description:
      "Record a bounded business mission. Create its channel and invite the owner and collaborators first. Metric missions need a measured baseline, evidence source, and evaluation window. A mission record does not schedule execution; propose recurring work separately for the user's approval.",
    input: {
      id: "z.string().regex(/^[a-z0-9][a-z0-9-]{4,99}$/)",
      conversationId: "z.string().min(1).max(160)",
      title: "z.string().min(1).max(200)",
      objective: "z.string().min(1).max(4000)",
      ownerAgentId: "z.string().min(1).max(120)",
      collaborators: "z.array(z.string().min(1).max(120)).max(12).default([])",
      projectId: "z.string().min(1).max(160).optional()",
      success:
        'z.discriminatedUnion("kind", [z.object({ kind: z.literal("deliverable"), description: z.string().min(1).max(2000) }).strict(), z.object({ kind: z.literal("metric"), name: z.string().min(1).max(120), unit: z.string().max(40), direction: z.enum(["increase", "decrease"]), baseline: z.number().finite(), target: z.number().finite(), source: z.string().min(1).max(2000), evaluationWindow: z.string().min(1).max(1000) }).strict()])',
      maxExperiments: "z.number().int().min(1).max(100)",
      deadline: "z.string().datetime()",
      constraints: "z.string().min(1).max(4000)",
    },
  },
  {
    operationId: "missions.recordExperiment",
    method: "POST",
    path: "/local-tools/missions/{missionId}/experiments",
    execute: "relay",
    description:
      "Record one mission experiment with a stable id, actual change, measurement, and evidence. Keep only measured improvements. Use a null value and inconclusive decision when evidence is insufficient.",
    input: {
      missionId: "z.string().min(1).max(100)",
      id: "z.string().min(1).max(120)",
      hypothesis: "z.string().min(1).max(2000)",
      change: "z.string().min(1).max(4000)",
      value: "z.number().finite().nullable()",
      evidence: "z.string().min(1).max(4000)",
      decision: 'z.enum(["keep", "discard", "inconclusive"])',
    },
  },
  {
    operationId: "missions.updateStatus",
    method: "POST",
    path: "/local-tools/missions/{missionId}/status",
    execute: "relay",
    description:
      "Pause, resume, or complete a mission with evidence. The relay enforces its deadline, experiment budget, and measured target.",
    input: {
      missionId: "z.string().min(1).max(100)",
      status: 'z.enum(["active", "paused", "completed"])',
      evidence: "z.string().min(1).max(4000)",
    },
  },
  {
    operationId: "recurringWork.list",
    method: "GET",
    path: "/local-tools/recurring-work",
    execute: "relay",
    description: "List visible schedules and their approval state.",
    input: {},
  },
  {
    operationId: "recurringWork.propose",
    method: "POST",
    path: "/local-tools/recurring-work",
    execute: "relay",
    description:
      "Propose recurring or one-time agent work. Reuse a stable id when revising. The agent must belong to the destination channel. The proposal stays awaiting user approval; this tool cannot approve, activate, or run it.",
    input: {
      collaborators: "z.array(z.string().min(1).max(120)).max(12).default([])",
      expectedOutcome: 'z.string().max(2000).default("")',
      constraints: 'z.string().max(4000).default("")',
      maxDurationMinutes: "z.number().int().min(5).max(1440).default(60)",
      triggerMode: 'z.enum(["cron", "webhook"]).default("cron")',
      id: "z.string().min(1).max(120).optional()",
      conversationId: "z.string().min(1).max(160).optional()",
      agentId: "z.string().min(1).max(120)",
      missionId: "z.string().min(1).max(120).optional()",
      title: "z.string().min(1).max(200)",
      instructions: "z.string().min(1).max(8000)",
      cron: 'z.string().max(120).default("0 9 * * *")',
      timezone: "z.string().min(1).max(120)",
      onceAt:
        "z.union([z.number().int().positive(), z.string().datetime()]).optional()",
      approvalSummary: "z.string().min(1).max(2000)",
      proposedToolPatterns: "z.array(z.string().max(300)).max(30).default([])",
    },
  },

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
