import { z } from "zod";

import type { ClientMessage } from "./types.js";
import { inputRequestSchema } from "./input-request-schema.js";

const executorCapabilitySchema = z.object({
  apiBaseUrl: z.string(),
  token: z.string(),
});
const workspaceMessageSchema = z.object({
  workspaceId: z.string(),
  executorCapability: executorCapabilitySchema,
});
const chatExecutionSchema = z.object({
  driver: z.enum(["claude", "codex", "opencode", "remote"]),
  model: z.string().optional(),
});
const stringMapSchema = z.record(z.string());
const recordSchema = z.record(z.unknown());
const browserRunMessageSchema = z.object({
  workspaceId: z.string(),
  conversationId: z.string(),
  browserRunId: z.string(),
});

function workspaceMessage(
  type: string,
  shape = {},
): z.ZodObject<z.ZodRawShape> {
  return workspaceMessageSchema.extend({ type: z.literal(type), ...shape });
}

const clientMessageWireSchema = z.union([
  z.object({ type: z.literal("listAgents") }),
  z.object({
    type: z.literal("listModels"),
    driver: z.enum(["claude", "codex", "opencode", "remote"]),
  }),
  ...[
    "listProjects",
    "listProjectAccessRequests",
    "listChannels",
    "listArtifacts",
    "listBrowserRuns",
    "listChats",
    "listWorkspaceData",
    "listDiagnostics",
    "listWorkspaceFiles",
    "listAgentPreferences",
    "inspectWorkspaceIntegrations",
    "listWorkspaceEnvironmentVariables",
    "getSlackChannel",
  ].map((type) => workspaceMessage(type)),
  workspaceMessage("attachProject", {
    requestId: z.string(),
    path: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
  }),
  workspaceMessage("cloneProject", {
    requestId: z.string(),
    remoteUrl: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
  }),
  workspaceMessage("browseProject", {
    requestId: z.string(),
    projectId: z.string(),
    ref: z.string().optional(),
    path: z.string().optional(),
  }),
  workspaceMessage("inspectProjectCommit", {
    requestId: z.string(),
    projectId: z.string(),
    ref: z.string().optional(),
    commit: z.string(),
  }),
  workspaceMessage("compareProjectBranches", {
    requestId: z.string(),
    projectId: z.string(),
    baseRef: z.string(),
    compareRef: z.string(),
  }),
  workspaceMessage("publishProjectCheckout", {
    requestId: z.string(),
    checkoutId: z.string(),
    targetBranch: z.string().optional(),
    correlationId: z.string().optional(),
    allowDefaultBranch: z.boolean().optional(),
  }),
  workspaceMessage("discardProjectCheckout", {
    requestId: z.string(),
    checkoutId: z.string(),
    confirmed: z.boolean(),
  }),
  workspaceMessage("createProjectPullRequest", {
    requestId: z.string(),
    projectId: z.string(),
    title: z.string(),
    description: z.string().optional(),
    headBranch: z.string(),
    baseBranch: z.string(),
  }),
  workspaceMessage("resolveProjectAccessRequest", {
    requestId: z.string(),
    accessRequestId: z.string(),
    decision: z.enum(["approved", "denied"]),
  }),
  workspaceMessage("setChannelPolicy", {
    requestId: z.string(),
    channelId: z.string(),
    agentPermissions: z.array(recordSchema),
    sessionToken: z.string(),
  }),
  workspaceMessage("setChannelArchived", {
    requestId: z.string(),
    channelId: z.string(),
    archived: z.boolean(),
    sessionToken: z.string(),
  }),
  workspaceMessage("listChannelEvents", { channelId: z.string() }),
  workspaceMessage("createChannel", {
    requestId: z.string(),
    name: z.string(),
    description: z.string().optional(),
  }),
  workspaceMessage("updateChannelAgents", {
    channelId: z.string(),
    agentIds: z.array(z.string()),
  }),
  workspaceMessage("updateChannel", {
    requestId: z.string(),
    channelId: z.string(),
    name: z.string(),
    topic: z.string(),
    description: z.string(),
    sessionToken: z.string(),
  }),
  workspaceMessage("deleteChannel", {
    requestId: z.string(),
    channelId: z.string(),
    sessionToken: z.string(),
  }),
  workspaceMessage("reactToChannelMessage", {
    channelId: z.string(),
    messageId: z.string(),
    reaction: z.string(),
  }),
  workspaceMessage("anchorBrowserRun", {
    browserRunId: z.string(),
    messageId: z.string(),
  }),
  workspaceMessage("getWorkspaceFile", {
    fileId: z.string(),
    requestId: z.string(),
  }),
  workspaceMessage("deleteWorkspaceFile", {
    fileId: z.string(),
    requestId: z.string(),
  }),
  workspaceMessage("renderWorkspaceEmail", {
    fileId: z.string(),
    requestId: z.string(),
  }),
  workspaceMessage("saveWorkspaceFile", {
    requestId: z.string(),
    file: recordSchema,
  }),
  workspaceMessage("saveWorkspaceWaysOfWorking", {
    requestId: z.string(),
    mode: z.enum(["mission-control", "channels", "calm"]),
    missionControlChannelId: z.string(),
    sessionToken: z.string(),
  }),
  workspaceMessage("runMissionControlHeartbeatNow", { requestId: z.string() }),
  workspaceMessage("bootstrapOnboardingWork", {
    requestId: z.string(),
    jobs: z.array(recordSchema),
    schedules: z.array(recordSchema),
    workspaceContext: z.string().optional(),
    driver: z.enum(["claude", "codex", "opencode", "remote"]).optional(),
    model: z.string().nullable().optional(),
  }),
  workspaceMessage("saveCampaign", { campaign: recordSchema }),
  workspaceMessage("saveRecurringWork", {
    requestId: z.string().optional(),
    work: recordSchema,
  }),
  workspaceMessage("rotateRecurringWorkWebhook", {
    requestId: z.string(),
    recurringWorkId: z.string(),
  }),
  workspaceMessage("runRecurringWorkNow", { recurringWorkId: z.string() }),
  workspaceMessage("deleteRecurringWork", { recurringWorkId: z.string() }),
  workspaceMessage("dismissActionItem", { actionItemId: z.string() }),
  workspaceMessage("resolveActionRequest", {
    actionItemId: z.string(),
    requestId: z.string(),
    answers: stringMapSchema,
    values: stringMapSchema,
    resolvedBy: z.object({ id: z.string(), name: z.string() }),
    setup: z.object({ chatId: z.string(), domain: z.string() }).optional(),
  }),
  workspaceMessage("expandRecurringWorkGrant", {
    recurringWorkId: z.string(),
    addTools: z.array(z.string()),
    rerun: z.boolean().optional(),
  }),
  workspaceMessage("saveAgentPreference", { preference: recordSchema }),
  workspaceMessage("openChat", {
    chatId: z.string(),
    workspaceContext: z.string().optional(),
    execution: chatExecutionSchema.optional(),
    access: z.enum(["full", "guarded"]).optional(),
    purpose: z.enum(["integration-setup", "analytics-report"]).optional(),
    integrationDomain: z.string().optional(),
    channelId: z.string().optional(),
    agentId: z.string().optional(),
    conversationSurface: z.enum(["direct", "channel"]).optional(),
  }),
  ...["observeChat", "closeChat", "deleteChat", "interruptChat"].map((type) =>
    workspaceMessage(type, { chatId: z.string() }),
  ),
  workspaceMessage("sendMessage", {
    chatId: z.string(),
    messageId: z.string(),
    text: z.string(),
    attachments: z
      .array(
        z.object({ name: z.string(), mediaType: z.string(), url: z.string() }),
      )
      .optional(),
    threadRootId: z.string().optional(),
    mentions: z.array(z.string()).optional(),
    components: z.array(z.unknown()).optional(),
    senderName: z.string().optional(),
    interruptActive: z.boolean().optional(),
    execution: chatExecutionSchema.optional(),
  }),
  workspaceMessage("respondPermission", {
    chatId: z.string(),
    requestId: z.string(),
    behavior: z.enum(["allow", "deny"]),
  }),
  workspaceMessage("respondQuestion", {
    chatId: z.string(),
    requestId: z.string(),
    answers: stringMapSchema.nullable(),
  }),
  workspaceMessage("provideInput", {
    chatId: z.string(),
    request: inputRequestSchema,
    values: stringMapSchema,
    recurringWorkId: z.string().optional(),
  }),
  workspaceMessage("storeInput", {
    request: inputRequestSchema,
    values: stringMapSchema,
  }),
  workspaceMessage("queryInputs", { keys: z.array(z.string()) }),
  workspaceMessage("saveWorkspaceEnvironmentVariable", {
    key: z.string(),
    value: z.string(),
  }),
  workspaceMessage("deleteWorkspaceEnvironmentVariable", { key: z.string() }),
  workspaceMessage("listPlugins", { refresh: z.boolean().optional() }),
  ...["installPlugin", "authorizePlugin", "uninstallPlugin"].map((type) =>
    workspaceMessage(type, { pluginId: z.string(), requestId: z.string() }),
  ),
  workspaceMessage("disconnectGoogleAnalytics", { requestId: z.string() }),
  workspaceMessage("saveSlackChannel", {
    settings: recordSchema,
    credentials: z
      .object({
        botToken: z.string().optional(),
        appToken: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("browserNavigateRequest"),
    workspaceId: z.string(),
    conversationId: z.string(),
    browserRunId: z.string().optional(),
    threadRootId: z.string().optional(),
    url: z.string(),
    width: z.number(),
    height: z.number(),
  }),
  browserRunMessageSchema.extend({ type: z.literal("browserReload") }),
  browserRunMessageSchema.extend({ type: z.literal("browserClose") }),
  browserRunMessageSchema.extend({
    type: z.literal("browserUrlChanged"),
    url: z.string(),
  }),
  browserRunMessageSchema.extend({
    type: z.literal("browserViewportResize"),
    width: z.number(),
    height: z.number(),
  }),
]);

const clientMessageSchema: z.ZodType<ClientMessage> = z.custom(
  (value) => clientMessageWireSchema.safeParse(value).success,
);

export function parseClientMessage(raw: string): ClientMessage | undefined {
  try {
    return clientMessageSchema.safeParse(JSON.parse(raw)).data;
  } catch {
    return undefined;
  }
}
