import type {
  AgentBrowser,
  AgentComputer,
  AgentInference,
  AgentInferenceMessage,
} from "@chief/agent-computer";
import type {
  AgentJob,
  AgentJobCompletionResult,
  AgentPrincipal,
  ConversationMessage,
} from "@chief/relay-contracts";
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
  config?: { enabled: boolean; toolPermissions: string[] };
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
  const messages: AgentInferenceMessage[] = [
    { role: "system", content: systemPrompt(job, context, browserEnabled) },
    ...history.slice(-30).map(historyMessage),
    {
      role: "user",
      content:
        stringPayload(job, "instruction") ??
        "Respond helpfully to the latest message.",
    },
  ];

  let finalText = "";
  for (let round = 0; round < 12; round += 1) {
    const response = await inference.complete({
      messages,
      tools: hostedAgentToolDefinitions(browserEnabled),
      maxTokens: 1_500,
      temperature: 0.3,
    });
    messages.push({
      role: "assistant",
      content: response.content,
      ...(response.toolCalls.length > 0
        ? { toolCalls: response.toolCalls }
        : undefined),
    });
    if (response.toolCalls.length === 0) {
      finalText = response.content?.trim() ?? "";
      break;
    }
    for (const call of response.toolCalls) {
      try {
        const output = await executeHostedAgentTool(
          computer,
          browserEnabled ? browser : undefined,
          env,
          job,
          principal,
          call.name,
          call.arguments,
        );
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify(output).slice(0, 20_000),
        });
      } catch (error) {
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            ok: false,
            error:
              error instanceof Error ? error.message : "Tool execution failed.",
          }),
        });
      }
    }
  }
  if (job.kind === "workspace.onboarding") {
    return { openingMessage: WORKSPACE_ONBOARDING_OPENING_MESSAGE };
  }
  if (!finalText) {
    throw new Error("The hosted agent finished without a final response.");
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
  const workspace = context.workspace;
  const website = workspace?.website.trim();
  const selectedApps = workspace?.selectedApps.join(", ");
  return `You are ${agentName}, a durable Chief workspace agent running in a Cloudflare cell.
Preserve the agent's continuity across deployment targets. Be concise and never claim a tool succeeded unless its result says so.
Workspace: ${workspace?.name ?? job.workspaceId}. Website: ${nonEmptyOr(website, "not supplied")}. Selected apps: ${nonEmptyOr(selectedApps, "none")}.
Use relay and computer tools whenever the instruction asks for an action. Execute required calls now; do not replace them with prose. The durable computer provides files, bounded shell commands, Git, and authenticated artifacts.${browserEnabled ? " The browser tools provide a real remote browser for public web pages." : " Browser access is not granted to this agent."}
Use plugins_list to inspect the real catalog and plugins_recommend to place plugin cards in chat. Installation and authorization are not available to this deployment, so never claim a provider is connected.
If a capability is not exposed as a tool, say so plainly. Do not invent plugin authorization, research, messages, or sources.
Your final answer is posted verbatim to the target conversation unless this is workspace onboarding.`;
}

function historyMessage(message: ConversationMessage): AgentInferenceMessage {
  return {
    role: message.author.kind === "agent" ? "assistant" : "user",
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
