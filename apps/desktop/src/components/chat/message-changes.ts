import { parseDiffFromFile, parsePatchFiles } from "@pierre/diffs";

import type { ChiefUIMessage, ContentBlock } from "@chief/agent-runtime/types";

import type { SessionChange } from "./session-work";
import { changeForTool } from "./session-work";
import { toolPartJsonSchema } from "./tool-part-json";

/** One file an agent changed, with every edit it made to it and its size. */
export interface FileChanges {
  file: string;
  changes: SessionChange[];
  added: number;
  removed: number;
}

/** The file edits finished in one activity message. */
export function messageFileEdits(message: ChiefUIMessage): SessionChange[] {
  return message.parts.flatMap((part) => {
    if (part.type !== "dynamic-tool" || part.state !== "output-available")
      return [];
    const input = toolPartJsonSchema.safeParse(part.input);
    const output = toolPartJsonSchema.safeParse(part.output);
    const use: Extract<ContentBlock, { type: "tool_use" }> = {
      type: "tool_use",
      id: part.toolCallId,
      name: part.toolName,
      input: input.success ? input.data : undefined,
    };
    const result: Extract<ContentBlock, { type: "tool_result" }> = {
      type: "tool_result",
      tool_use_id: part.toolCallId,
      content: output.success ? output.data : "",
    };
    const change = changeForTool(use, result);
    return change ? [change] : [];
  });
}

function lineCounts(change: SessionChange) {
  try {
    const files =
      change.kind === "patch"
        ? parsePatchFiles(change.patch).flatMap((patch) => patch.files)
        : [
            parseDiffFromFile(
              { name: change.file, contents: change.before },
              { name: change.file, contents: change.after },
            ),
          ];
    return files
      .flatMap((file) => file.hunks)
      .reduce(
        (sum, hunk) => ({
          added: sum.added + hunk.additionLines,
          removed: sum.removed + hunk.deletionLines,
        }),
        { added: 0, removed: 0 },
      );
  } catch {
    return { added: 0, removed: 0 };
  }
}

/** Edits grouped by file, in the order each file was first touched. */
export function groupFileChanges(edits: readonly SessionChange[]) {
  const files = new Map<string, FileChanges>();
  for (const change of edits) {
    const counts = lineCounts(change);
    const current = files.get(change.file) ?? {
      file: change.file,
      changes: [],
      added: 0,
      removed: 0,
    };
    files.set(change.file, {
      ...current,
      changes: [...current.changes, change],
      added: current.added + counts.added,
      removed: current.removed + counts.removed,
    });
  }
  return [...files.values()];
}
