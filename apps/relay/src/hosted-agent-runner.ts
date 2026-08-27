import type { AgentInferenceMessage } from "@chief/agent-computer";
import type {
  AgentConfig,
  AgentJob,
  AgentJobCompletionResult,
  AgentPrincipal,
  ConversationMessage,
} from "@chief/relay-contracts";
import { getAgent } from "@chief/agent-runtime/agents";
import { assembleAgentPrompt } from "@chief/agent-runtime/prompts";
import {
  conversationIdSchema,
  isJsonString,
  messageIdSchema,
} from "@chief/relay-contracts";

import { recentConversationMessages } from "./hosted-agent-tools";
import { withTrustedContext } from "./internal-context";
import { WORKSPACE_ONBOARDING_OPENING_MESSAGE } from "./workspace-onboarding-job";

export const HOSTED_HISTORY_MESSAGE_LIMIT = 8;
export const HOSTED_TOOL_SELECTION_GUIDANCE =
  "The durable computer is only for inspecting or changing files, repositories, commands, and artifacts. Never use it for ordinary questions or plugin setup. For plugin discovery or setup, call plugins_list first. When a matching plugin exists, call plugins_recommend in the current conversation and let the user authorize it from the card. Do not browse provider documentation or use the computer to reconstruct a setup flow.";

export interface HostingContext {
  managed: boolean;
  runtime: "phone" | "desktop" | "cloud" | null;
  workspace?: {
    id: string;
    name: string;
    website: string;
    selectedApps: string[];
  };
  agent?: { id: string; name: string; role: string };
  config?: AgentConfig;
}

export async function loadAgentHostingContext(
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
) {
  const response = await env.WORKSPACES.get(
    env.WORKSPACES.idFromName(job.workspaceId),
  ).fetch(
    withTrustedContext(
      new Request("https://workspace.internal", {
        method: "POST",
        headers: { "x-chief-internal-operation": "agent-hosting-context" },
      }),
      {
        principal,
        requestId: crypto.randomUUID(),
        workspaceId: job.workspaceId,
      },
    ),
  );
  if (!response.ok) return null;
  const context: HostingContext = await response.json();
  return context;
}

export async function prepareHostedAgentTurn(
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  context: HostingContext,
) {
  const browserEnabled =
    context.config?.toolPermissions.includes("browser.use") ?? false;
  const conversationId = conversationIdSchema.parse(
    stringPayload(job, "conversationId") ?? "mission-control",
  );
  const rawThreadRootId = stringPayload(job, "threadRootId");
  const threadRootId = rawThreadRootId
    ? messageIdSchema.parse(rawThreadRootId)
    : undefined;
  const history = await recentConversationMessages(
    env,
    job,
    principal,
    conversationId,
    threadRootId,
  ).catch(() => [] satisfies ConversationMessage[]);
  const messageId = stringPayload(job, "messageId");
  const instruction =
    stringPayload(job, "instruction") ??
    "Respond helpfully to the latest message.";
  const completion = hostedCompletionContract(instruction, browserEnabled);
  return {
    jobId: job.id,
    conversationId,
    ...(threadRootId ? { threadRootId } : undefined),
    instruction,
    systemPrompt: `${systemPrompt(job, context, browserEnabled)}\n\nThe latest relevant messages from this conversation are already attached to the turn. Use them directly. Only call channels_messages_list when you genuinely need older context.\n\nFor multi-step work, maintain the durable todo plan with todo_set, todo_add, todo_update, and todo_list. Do not claim completion while work you can perform remains open. When the next action genuinely belongs to the user or an external event, mark that task waiting, give the user one concise handoff, and end the turn. A later event or message starts fresh work. Always finish with the concise update the user should receive; the relay durably posts that final response to the originating conversation.`,
    browserEnabled,
    completion,
    history: boundedHostedHistory(history, messageId).map((message) =>
      historyMessage(message, job.agentId),
    ),
  };
}

export function boundedHostedHistory(
  messages: ConversationMessage[],
  triggeringMessageId?: string,
) {
  return messages
    .filter((message) => message.id !== triggeringMessageId)
    .slice(-HOSTED_HISTORY_MESSAGE_LIMIT);
}

function hostedCompletionContract(
  instruction: string,
  browserEnabled: boolean,
) {
  const normalized = instruction.toLowerCase();
  const asksForVisibleBrowser =
    browserEnabled &&
    normalized.includes("browser") &&
    /\b(open|show|display|navigate|visit|load|bring up)\b/u.test(normalized);
  return {
    requiredToolNames: asksForVisibleBrowser ? ["browser_open"] : [],
    browserMustRemainOpen: asksForVisibleBrowser,
  };
}

export function hostedTurnResult(job: AgentJob, finalText: string) {
  if (job.kind === "workspace.onboarding") {
    return { openingMessage: WORKSPACE_ONBOARDING_OPENING_MESSAGE };
  }
  const conversationId = conversationIdSchema.parse(
    stringPayload(job, "conversationId") ?? "mission-control",
  );
  const rawThreadRootId = stringPayload(job, "threadRootId");
  const threadRootId = rawThreadRootId
    ? messageIdSchema.parse(rawThreadRootId)
    : undefined;
  const publishesToThread = !job.kind.startsWith("workspace.kickoff.");
  return {
    publishedMessage: {
      conversationId,
      ...(publishesToThread && threadRootId ? { threadRootId } : undefined),
      body: finalText.slice(0, 4_000),
      components: [],
    },
  } satisfies AgentJobCompletionResult;
}

function systemPrompt(
  job: AgentJob,
  context: HostingContext,
  browserEnabled: boolean,
) {
  const agentId = job.agentId;
  const definition = getAgent(agentId);
  const identity = definition?.instructions ?? genericIdentity(job, context);
  const permissions = context.config?.toolPermissions ?? [];
  const workspaceContext = workspaceContextBlock(job, context, browserEnabled);
  return assembleAgentPrompt({
    identity,
    capabilities: context.config?.capabilities,
    permissions,
    deployment: "cloud",
    workspaceContext,
  }).text;
}

function genericIdentity(job: AgentJob, context: HostingContext) {
  const agentName = context.agent?.name ?? job.agentId;
  const agentRole = context.agent?.role ?? "workspace agent";
  return `# Identity

You are ${agentName}, the workspace's ${agentRole}. You are the same durable agent whether your cell runs on a phone, desktop, or in Chief Cloud.
Reply naturally to casual conversation without calling tools. For substantive requests, own the outcome and use the tools available in this turn before you answer. Never claim a tool succeeded unless its result says so.
If one part of a request is impossible with the tools in this turn, complete every useful part that is possible. Then name the exact missing operation. Never return a generic capability refusal, and never invent research, messages, sources, or tool results.
Your final answer is posted verbatim to the target conversation unless this is workspace onboarding.`;
}

function workspaceContextBlock(
  job: AgentJob,
  context: HostingContext,
  browserEnabled: boolean,
) {
  const workspace = context.workspace;
  const website = workspace?.website.trim();
  const selectedApps = workspace?.selectedApps.join(", ");
  const lines = [
    `Workspace: ${workspace?.name ?? job.workspaceId}.`,
    `Website: ${nonEmptyOr(website, "not supplied")}.`,
    `Selected apps: ${nonEmptyOr(selectedApps, "none")}.`,
    HOSTED_TOOL_SELECTION_GUIDANCE,
    browserEnabled
      ? "The browser tools provide a real remote browser for public web pages."
      : "Do not imply that you inspected a live web page.",
    "A plugin recommendation is not an installed or authorized connection. Do not claim setup is complete until the connection state confirms it.",
  ];
  return lines.join("\n");
}

function historyMessage(
  message: ConversationMessage,
  currentAgentId: string,
): AgentInferenceMessage {
  return {
    role:
      message.author.kind === "agent" && message.author.id === currentAgentId
        ? "assistant"
        : "user",
    content: `${message.author.id}: ${message.body}`,
  };
}

function stringPayload(job: AgentJob, key: string) {
  const value = job.payload[key];
  return isJsonString(value) && value.trim() ? value.trim() : undefined;
}

function nonEmptyOr(value: string | undefined, fallback: string) {
  if (value === undefined || value.length === 0) return fallback;
  return value;
}
