import type { ContentBlock } from "@chief/agent-runtime/types";
import type { JsonValue } from "@chief/relay-contracts";
import { isJsonObject, isJsonString } from "@chief/relay-contracts";

type ToolUse = Extract<ContentBlock, { type: "tool_use" }>;
type ToolResult = Extract<ContentBlock, { type: "tool_result" }>;

/** One file edit an agent made, as a unified patch or a before/after pair. */
export type SessionChange =
  | { id: string; file: string; kind: "patch"; patch: string }
  | {
      id: string;
      file: string;
      kind: "contents";
      before: string;
      after: string;
    };

const editTools = new Set([
  "edit",
  "editfile",
  "multiedit",
  "str_replace",
  "str_replace_editor",
  "apply_patch",
  "computer.edit",
]);
const writeTools = new Set([
  "write",
  "writefile",
  "create_file",
  "createfile",
  "computer.write",
]);

function text(value: JsonValue | undefined): string {
  if (isJsonString(value)) return value;
  if (Array.isArray(value)) {
    return value
      .map((part) =>
        isJsonObject(part) && isJsonString(part.text) ? part.text : "",
      )
      .join("");
  }
  return "";
}

function field(input: JsonValue | undefined, ...names: string[]): string {
  if (!isJsonObject(input)) return "";
  for (const name of names) {
    const value = input[name];
    if (isJsonString(value)) return value;
  }
  return "";
}

/** A diff body without file headers still renders once it has them. */
function withHeaders(file: string, diff: string): string {
  return /^(---|diff --git) /mu.test(diff)
    ? diff
    : `--- a/${file}\n+++ b/${file}\n${diff}`;
}

function looksLikePatch(value: string): boolean {
  return /^@@ .* @@/mu.test(value);
}

/**
 * The file change a single tool call produced, if any. Recognises the relay's
 * hosted `computer.*` toolkit as well as the common coding-agent tool names.
 */
export function changeForTool(
  tool: ToolUse,
  result?: ToolResult,
): SessionChange | undefined {
  const name = tool.name.toLocaleLowerCase();
  const file = field(tool.input, "file", "file_path", "path", "filePath");
  if (editTools.has(name)) {
    const patch = field(tool.input, "patch", "diff");
    const output = text(result?.content);
    if (patch.trim() || looksLikePatch(output)) {
      const target = file || "workspace file";
      return {
        id: tool.id,
        file: target,
        kind: "patch",
        patch: withHeaders(target, patch.trim() || output),
      };
    }
    const before = field(
      tool.input,
      "oldText",
      "old_string",
      "oldString",
      "old",
    );
    const after = field(
      tool.input,
      "newText",
      "new_string",
      "newString",
      "new",
    );
    if (file && (before || after)) {
      return { id: tool.id, file, kind: "contents", before, after };
    }
    return undefined;
  }
  if (writeTools.has(name) && file) {
    return {
      id: tool.id,
      file,
      kind: "contents",
      before: "",
      after: field(tool.input, "content", "contents", "text"),
    };
  }
  return undefined;
}
