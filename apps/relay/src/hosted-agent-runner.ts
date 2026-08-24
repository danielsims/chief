import type {
  AgentJob,
  AgentJobCompletionResult,
  AgentPrincipal,
  ConversationMessage,
} from "@chief/relay-contracts";
import {
  conversationIdSchema,
  isJsonObject,
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
  runtime: "phone" | "mac" | "cloud" | null;
  workspace?: {
    id: string;
    name: string;
    website: string;
    selectedApps: string[];
  };
  agent?: { id: string; name: string; role: string };
  config?: { enabled: boolean };
}

type ChatMessage = Record<string, unknown> & {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
};

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
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  context: HostingContext,
): Promise<AgentJobCompletionResult> {
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
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(job, context) },
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
    const response = await env.AI.run(
      env.HOSTED_CELL_MODEL ?? "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      {
        messages,
        tools: hostedAgentToolDefinitions,
        tool_choice: "auto",
        parallel_tool_calls: false,
        max_tokens: 1_500,
        temperature: 0.3,
      },
    );
    const assistant = firstAssistantMessage(response);
    messages.push({
      role: "assistant",
      content: assistant.content,
      ...(assistant.toolCalls.length > 0
        ? { tool_calls: assistant.toolCalls }
        : undefined),
    });
    if (assistant.toolCalls.length === 0) {
      finalText = assistant.content?.trim() ?? "";
      break;
    }
    for (const call of assistant.toolCalls) {
      try {
        const output = await executeHostedAgentTool(
          env,
          job,
          principal,
          call.function.name,
          call.function.arguments,
        );
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify(output).slice(0, 20_000),
        });
      } catch (error) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
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

function systemPrompt(job: AgentJob, context: HostingContext) {
  const agentName = context.agent?.name ?? job.agentId;
  const workspace = context.workspace;
  const website = workspace?.website.trim();
  const selectedApps = workspace?.selectedApps.join(", ");
  return `You are ${agentName}, a durable Chief workspace agent running in a Cloudflare cell.
You are the same logical agent as the celld-backed phone and desktop cell: preserve continuity, be concise, and never claim a tool succeeded unless its result says so.
Workspace: ${workspace?.name ?? job.workspaceId}. Website: ${nonEmptyOr(website, "not supplied")}. Selected apps: ${nonEmptyOr(selectedApps, "none")}.
Use relay tools whenever the instruction asks for an action. Execute required calls now; do not replace them with prose. Tool calls are durable and permission checked.
The canonical plugin tools are plugins_list, plugins_recommend, plugins_install, plugins_authorize, and plugins_uninstall. Use plugins_list and plugins_recommend to place real cards in chat. Cloudflare can execute the durable agent and publish cards; provider OAuth and secrets deliberately require a compatible signed celld phone or desktop, so report a signed_cell_required tool result plainly instead of claiming the provider connected.
If a capability is not exposed as a tool, say so plainly. Do not invent browser access, plugin authorization, files, research, messages, or sources.
Your final answer is posted verbatim to the target conversation unless this is workspace onboarding.`;
}

function historyMessage(message: ConversationMessage): ChatMessage {
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

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string | Record<string, unknown> };
}

function firstAssistantMessage(raw: unknown): {
  content: string | null;
  toolCalls: ToolCall[];
} {
  const value = raw as {
    choices?: {
      message?: { content?: unknown; tool_calls?: unknown };
    }[];
  };
  const message = value.choices?.[0]?.message;
  const content = isJsonString(message?.content) ? message.content : null;
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const toolCalls = calls.flatMap((entry) => {
    const call = entry as {
      id?: unknown;
      type?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    if (
      !isJsonString(call.id) ||
      !isJsonString(call.function?.name) ||
      (!isJsonString(call.function.arguments) &&
        (!call.function.arguments || !isJsonObject(call.function.arguments)))
    ) {
      return [];
    }
    return [
      {
        id: call.id,
        type: "function" as const,
        function: {
          name: call.function.name,
          arguments: call.function.arguments,
        },
      },
    ];
  });
  return { content, toolCalls };
}
