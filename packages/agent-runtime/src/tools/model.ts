import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import type { AgentInferenceTool } from "@chief/agent-computer";
import type { JsonObject } from "@chief/relay-contracts";
import {
  isJsonString,
  parseJsonObject,
  toJsonObject,
} from "@chief/relay-contracts";

import type { AgentToolDefinition } from "./definition.js";
import { hostedAgentToolDefinitions } from "./hosted.js";

export { hostedAgentToolDefinitions };
export type { AgentToolDefinition } from "./definition.js";

export function agentToolName(operationId: string) {
  return operationId
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replaceAll(".", "_")
    .toLowerCase();
}

export function localAgentToolName(tool: AgentToolDefinition) {
  return agentToolName(tool.operation.operationId);
}

export function localAgentToolDefinitions(
  tools: readonly AgentToolDefinition[],
): AgentInferenceTool[] {
  return tools.map((tool) => ({
    name: localAgentToolName(tool),
    description: tool.operation.description ?? tool.operation.summary,
    parameters: localAgentToolParameters(tool),
  }));
}

export function localAgentToolsByOperation(
  operationIds: readonly string[],
): AgentToolDefinition[] {
  const available: readonly AgentToolDefinition[] = [
    ...hostedAgentToolDefinitions.base,
    ...hostedAgentToolDefinitions.browser,
  ];
  const toolsByOperation = new Map(
    available.map((tool) => [tool.operation.operationId, tool]),
  );
  return operationIds.map((operationId) => {
    const tool = toolsByOperation.get(operationId);
    if (!tool) throw new Error(`Unknown local tool operation: ${operationId}`);
    return tool;
  });
}

export function parseLocalAgentToolCall(
  tools: readonly AgentToolDefinition[],
  name: string,
  value: unknown,
) {
  const tool = tools.find(
    (candidate) => localAgentToolName(candidate) === name,
  );
  if (!tool) throw new Error(`Unknown agent tool: ${name}`);
  const raw = parseJsonObject(
    isJsonString(value) ? parseJsonObjectString(value) : value,
  );
  if (!raw) throw new Error("Agent tool arguments must be a JSON object.");
  const input = { ...raw };
  for (const parameter of pathParameterNames(tool.path)) {
    const parameterValue = input[parameter];
    if (!isJsonString(parameterValue) || parameterValue.length === 0) {
      throw new Error(`${parameter} is required.`);
    }
    delete input[parameter];
  }
  const schema = tool.inputSchema ?? tool.querySchema;
  const parsed = schema ? schema.parse(input) : input;
  const parsedInput = parseJsonObject(parsed);
  if (!parsedInput) {
    throw new Error(`${tool.operation.operationId} produced invalid input.`);
  }
  const combined = parseJsonObject({
    ...parsedInput,
    ...pathValues(tool.path, raw),
  });
  if (!combined) throw new Error("Agent tool input could not be represented.");
  return { tool, input: combined };
}

function localAgentToolParameters(tool: AgentToolDefinition) {
  const schema = toJsonObject(
    zodToJsonSchema(tool.inputSchema ?? tool.querySchema ?? z.object({}), {
      $refStrategy: "none",
      target: "openApi3",
    }),
  );
  const names = pathParameterNames(tool.path);
  if (names.length === 0) return schema;
  return {
    type: "object",
    allOf: [
      schema,
      {
        type: "object",
        properties: Object.fromEntries(
          names.map((name) => [name, { type: "string", minLength: 1 }]),
        ),
        required: names,
      },
    ],
  };
}

function pathParameterNames(path: string) {
  return [...path.matchAll(/\{([^}]+)\}/gu)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

function pathValues(path: string, input: JsonObject) {
  return Object.fromEntries(
    pathParameterNames(path).map((name) => [name, input[name]]),
  );
}

function parseJsonObjectString(value: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(value);
    const object = parseJsonObject(parsed);
    if (!object) throw new Error("Agent tool arguments must be a JSON object.");
    return object;
  } catch {
    throw new Error("Agent tool arguments must contain valid JSON.");
  }
}
