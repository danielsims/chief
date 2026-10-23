import { z } from "zod";

import type { AgentComputer } from "@chief/agent-computer";
import {
  agentIdSchema,
  agentJobSchema,
  conversationIdSchema,
  jsonObjectSchema,
} from "@chief/relay-contracts";

import type { readTrustedContext } from "./internal-context";
import { hostedPrincipal } from "./agent-object-values";
import { automationChiefTool } from "./automation-tools";
import { executeHostedAgentTool } from "./hosted-agent-tools";
import { HttpError, json, parseJson } from "./http";

const automationToolRequestSchema = z.object({
  agentId: agentIdSchema,
  /** Stable per run step, so retried calls reuse the same idempotency keys. */
  jobId: z.uuid(),
  conversationId: conversationIdSchema,
  threadRootId: z.uuid(),
  name: z.string().min(1).max(128),
  arguments: jsonObjectSchema,
});

/**
 * Runs one of Chief's own tools for an automation step, as the agent that
 * owns the automation. Only the run engine can call this: the principal is a
 * relay service identity that no client request can carry. The engine has
 * already checked the approval and the agent's permissions.
 */
export async function runAutomationTool(
  env: Env,
  computer: AgentComputer,
  request: Request,
  context: ReturnType<typeof readTrustedContext>,
) {
  if (
    context.principal.kind !== "service" ||
    context.principal.service !== "automation"
  )
    throw new HttpError(
      403,
      "automation_only",
      "Only automations can run this.",
    );
  const input = automationToolRequestSchema.parse(await parseJson(request));
  const tool = automationChiefTool(input.name);
  if (!tool)
    throw new HttpError(
      404,
      "automation_tool_unknown",
      `${input.name} cannot run in an automation.`,
    );
  const now = new Date().toISOString();
  const job = agentJobSchema.parse({
    id: input.jobId,
    workspaceId: context.workspaceId,
    agentId: input.agentId,
    kind: "automation.tool",
    payload: {
      conversationId: input.conversationId,
      threadRootId: input.threadRootId,
    },
    status: "leased",
    attempt: 0,
    lastError: null,
    availableAt: now,
    leaseExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  });
  const output = await executeHostedAgentTool(
    computer,
    undefined,
    false,
    env,
    job,
    hostedPrincipal(job),
    tool.toolName,
    input.arguments,
  );
  return json({ output });
}
