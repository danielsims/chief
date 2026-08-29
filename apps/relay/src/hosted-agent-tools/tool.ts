import type { ToolEffect } from "@chief/agent-runtime/durable-turn";
import type { JsonObject, JsonValue } from "@chief/relay-contracts";
import {
  localAgentToolName,
  localAgentToolsByOperation,
} from "@chief/agent-runtime/local-tools";
import { jsonValueSchema } from "@chief/relay-contracts";

import type { HostedAgentToolContext } from "./context";

export interface HostedAgentTool {
  definition: ReturnType<typeof localAgentToolsByOperation>[number];
  requiresBrowser: boolean;
  requiresComputer: boolean;
  effect: ToolEffect;
  execute: (
    context: HostedAgentToolContext,
    input: JsonObject,
  ) => Promise<JsonValue>;
}

export function defineHostedAgentTool(
  operationId: string,
  execute: (
    context: HostedAgentToolContext,
    input: JsonObject,
  ) => Promise<object>,
  options: {
    effect: ToolEffect;
    requiresBrowser?: boolean;
    requiresComputer?: boolean;
  },
): HostedAgentTool {
  const definition = localAgentToolsByOperation([operationId])[0];
  if (!definition) throw new Error(`Unknown hosted agent tool: ${operationId}`);
  return {
    definition,
    requiresBrowser: options.requiresBrowser ?? false,
    requiresComputer: options.requiresComputer ?? false,
    effect: options.effect,
    execute: async (context, input) =>
      jsonValueSchema.parse(await execute(context, input)),
  };
}

export function hostedAgentToolName(tool: HostedAgentTool) {
  return localAgentToolName(tool.definition);
}
