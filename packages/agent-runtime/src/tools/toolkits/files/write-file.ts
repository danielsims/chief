import { z } from "zod";

import { boundedText, optionalBoundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

const writeFileInputSchema = z.object({
  id: optionalBoundedText(120),
  name: boundedText(160),
  path: optionalBoundedText(240),
  content: boundedText(1_000_000),
  kind: z.enum(["document", "email"]).default("document"),
  expectedVersionId: optionalBoundedText(120),
  agentId: optionalBoundedText(80),
  sourceSessionId: optionalBoundedText(120),
});

export const writeFileTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/files/write",
  operation: {
    operationId: "files.write",
    summary: "Create or revise a workspace document",
    description:
      "Saves an editable, versioned workspace document. Pass expectedVersionId when revising so newer edits are never overwritten.",
  },
  inputSchema: writeFileInputSchema,
  async execute({ context, input, manager, workspaceId }) {
    const file = await manager.saveWorkspaceFile(workspaceId, {
      id: input.id,
      name: input.name,
      path: input.path,
      content: input.content,
      kind: input.kind,
      expectedVersionId: input.expectedVersionId,
      createdBy: "agent",
      sourceAgentId: input.agentId,
      sourceSessionId: input.sourceSessionId,
    });
    await context.onFileWritten?.(file);
    return jsonResponse({ file });
  },
});
