import type {
  AgentBrowser,
  AgentComputer,
  AgentInference,
  AgentInferenceMessage,
} from "@chief/agent-computer";
import type {
  AgentConfig,
  AgentJob,
  AgentJobCompletionResult,
  AgentPrincipal,
  ConversationMessage,
} from "@chief/relay-contracts";
import { runPortableAgentTurn } from "@chief/agent-runtime/portable-agent-runner";
import {
  conversationIdSchema,
  isJsonString,
  messageIdSchema,
} from "@chief/relay-contracts";

import {
  executeHostedAgentTool,
  hostedAgentToolDefinitions,
  recentConversationMessages,
} from "./hosted-agent-tools";
import { withTrustedContext } from "./internal-context";
import { WORKSPACE_ONBOARDING_OPENING_MESSAGE } from "./workspace-onboarding-job";

interface HostingContext {
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

export async function runHostedAgentJob(
  computer: AgentComputer,
  browser: AgentBrowser,
  inference: AgentInference,
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  context: HostingContext,
): Promise<AgentJobCompletionResult> {
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
  ).catch(() => [] satisfies ConversationMessage[]);
  const messageId = stringPayload(job, "messageId");
  const messages: AgentInferenceMessage[] = [
    { role: "system", content: systemPrompt(job, context, browserEnabled) },
    ...history
      .filter((message) => message.id !== messageId)
      .slice(-30)
      .map((message) => historyMessage(message, job.agentId)),
    {
      role: "user",
      content:
        stringPayload(job, "instruction") ??
        "Respond helpfully to the latest message.",
    },
  ];

  const finalText = await runPortableAgentTurn({
    inference,
    messages,
    tools: hostedAgentToolDefinitions(browserEnabled),
    execute: async (call) =>
      await executeHostedAgentTool(
        computer,
        browserEnabled ? browser : undefined,
        env,
        job,
        principal,
        call.name,
        call.arguments,
      ),
  });
  if (job.kind === "workspace.onboarding") {
    return { openingMessage: WORKSPACE_ONBOARDING_OPENING_MESSAGE };
  }
  return {
    publishedMessage: {
      conversationId,
      ...(threadRootId ? { threadRootId } : undefined),
      body: finalText.slice(0, 4_000),
      components: [],
    },
  };
}

function systemPrompt(
  job: AgentJob,
  context: HostingContext,
  browserEnabled: boolean,
) {
  const agentName = context.agent?.name ?? job.agentId;
  const agentRole = context.agent?.role ?? "workspace agent";
  const workspace = context.workspace;
  const website = workspace?.website.trim();
  const selectedApps = workspace?.selectedApps.join(", ");
  return `You are ${agentName}, the workspace's ${agentRole}. You are the same durable agent whether your cell runs on a phone, desktop, or in Chief Cloud.
Reply naturally to casual conversation without calling tools. For substantive requests, own the outcome and use the tools available in this turn before you answer. Never claim a tool succeeded unless its result says so.
Workspace: ${workspace?.name ?? job.workspaceId}. Website: ${nonEmptyOr(website, "not supplied")}. Selected apps: ${nonEmptyOr(selectedApps, "none")}.
The durable computer provides files, shell commands, Git, and artifacts. Use it when the request needs work, not for ordinary chat.${browserEnabled ? " The browser tools provide a real remote browser for public web pages." : " Do not imply that you inspected a live web page."}
Use plugins_list to inspect the real catalog and plugins_recommend to place plugin cards in chat. A recommendation is not an installed or authorized connection.
If one part of a request is impossible with the tools in this turn, complete every useful part that is possible. Then name the exact missing operation. Never return a generic capability refusal, and never invent research, messages, sources, or tool results.
Your final answer is posted verbatim to the target conversation unless this is workspace onboarding.`;
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
