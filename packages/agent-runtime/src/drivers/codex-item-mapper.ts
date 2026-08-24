import {
  isJsonNumber,
  isJsonObject,
  isJsonString,
} from "@chief/relay-contracts";

import type { ContentBlock } from "../types.js";

export interface CodexItemMappingState {
  activeToolUseIds: Set<string>;
  nextId: () => string;
  takeStream: () => string;
}

export function codexItemToBlocks(
  item: Record<string, unknown>,
  state: CodexItemMappingState,
): ContentBlock[] {
  switch (item.type) {
    case "agentMessage":
    case "agent_message": {
      const streamed = state.takeStream();
      const text = isJsonString(item.text)
        ? item.text
        : isJsonString(item.content)
          ? item.content
          : streamed;
      return text ? [{ type: "text", text }] : [];
    }
    case "reasoning": {
      const text = isJsonString(item.text)
        ? item.text
        : isJsonString(item.summary)
          ? item.summary
          : Array.isArray(item.summary)
            ? item.summary
                .map((part) => textValue(record(part)?.text))
                .join("\n")
            : "";
      return text ? [{ type: "thinking", thinking: text }] : [];
    }
    case "commandExecution":
    case "command_execution": {
      const id = idValue(item.id, state.nextId);
      const output = textValue(
        item.output ?? item.aggregatedOutput ?? item.aggregated_output,
      );
      const exitCode = item.exitCode ?? item.exit_code;
      return [
        {
          type: "tool_use",
          id,
          name: "bash",
          input: { command: textValue(item.command) },
        },
        {
          type: "tool_result",
          tool_use_id: id,
          content: output.trim()
            ? output
            : `Command completed${isJsonNumber(exitCode) ? ` with exit code ${exitCode}` : ""}.`,
          is_error: isJsonNumber(exitCode) && exitCode !== 0,
        },
      ];
    }
    case "fileChange":
    case "file_change": {
      const id = idValue(item.id, state.nextId);
      return [
        {
          type: "tool_use",
          id,
          name: "editFile",
          input: {
            file: textValue(item.filePath ?? item.file),
            changes: item.changes,
          },
        },
        {
          type: "tool_result",
          tool_use_id: id,
          content:
            textValue(item.diff) ||
            `Updated ${textValue(item.filePath ?? item.file) || "workspace files"}.`,
        },
      ];
    }
    case "mcpToolCall":
    case "mcp_tool_call": {
      const id = idValue(item.id, state.nextId);
      const result = codexMcpResultText(item);
      const status = textValue(item.status).toLowerCase();
      const failed =
        Boolean(item.error) ||
        [
          "failed",
          "aborted",
          "cancelled",
          "canceled",
          "declined",
          "interrupted",
        ].includes(status);
      state.activeToolUseIds.delete(id);
      return [
        {
          type: "tool_result",
          tool_use_id: id,
          content:
            result ||
            (failed ? "Tool stopped before completing." : "Tool completed."),
          is_error: failed,
        },
      ];
    }
    case "webSearch":
    case "web_search": {
      const id = idValue(item.id, state.nextId);
      state.activeToolUseIds.delete(id);
      return [
        {
          type: "tool_result",
          tool_use_id: id,
          content:
            textValue(item.result) ||
            textValue(item.output) ||
            (textValue(item.query)
              ? `Searched for ${textValue(item.query)}`
              : "Search complete"),
        },
      ];
    }
    default:
      return [];
  }
}

export function codexItemStartedToBlocks(
  item: Record<string, unknown>,
  state: CodexItemMappingState,
): ContentBlock[] {
  if (item.type === "commandExecution" || item.type === "command_execution") {
    return [
      {
        type: "tool_use",
        id: idValue(item.id, state.nextId),
        name: "bash",
        input: { command: textValue(item.command) },
      },
    ];
  }
  if (item.type === "fileChange" || item.type === "file_change") {
    return [
      {
        type: "tool_use",
        id: idValue(item.id, state.nextId),
        name: "editFile",
        input: { file: textValue(item.filePath ?? item.file) },
      },
    ];
  }
  if (
    ["mcpToolCall", "mcp_tool_call", "webSearch", "web_search"].includes(
      textValue(item.type),
    )
  ) {
    const id = idValue(item.id, state.nextId);
    state.activeToolUseIds.add(id);
    const isSearch = item.type === "webSearch" || item.type === "web_search";
    return [
      {
        type: "tool_use",
        id,
        name: isSearch ? "web_search" : textValue(item.tool) || "tool",
        input: isSearch
          ? {
              query: textValue(item.query ?? record(item.action)?.query),
            }
          : (record(item.arguments ?? item.input) ?? {}),
      },
    ];
  }
  return [];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && isJsonObject(value)
    ? (value)
    : null;
}

function textValue(value: unknown): string {
  return isJsonString(value) ? value : "";
}

function idValue(value: unknown, fallback: () => string): string {
  return isJsonString(value) || isJsonNumber(value)
    ? String(value)
    : fallback();
}

export function codexMcpResultText(item: Record<string, unknown>): string {
  const result = record(item.result);
  const structured = result?.structuredContent ?? item.structuredContent;
  if (structured !== undefined) return JSON.stringify(structured);
  const content = result?.content ?? item.content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      const value = record(part);
      if (!value) return [];
      if (value.type === "text" && isJsonString(value.text)) {
        return [value.text];
      }
      if (value.type === "resource" || value.type === "resource_link") {
        return [JSON.stringify(value)];
      }
      return [];
    })
    .join("\n");
}
