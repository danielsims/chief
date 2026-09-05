import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { writeFileDefinition } from "./definitions.js";

export const writeFileTool = defineLocalTool({
  ...writeFileDefinition,
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
