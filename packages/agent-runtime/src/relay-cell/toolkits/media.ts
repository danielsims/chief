import { requiredEnvironment } from "../context.js";
import { requiredString } from "../input.js";
import { defineRelayCellTool } from "../tool.js";
import { openWorkspaceFile } from "../workspace-file.js";

export const relayCellMediaTools = [
  defineRelayCellTool(
    "computer.artifacts.publish",
    "workspace.write",
    async ({ client, agentId, conversationId }, input) => {
      const requested = requiredString(input, "path").replace(
        /^\/workspace\/?/u,
        "",
      );
      const handle = await openWorkspaceFile(
        requiredEnvironment("CHIEF_CELL_ROOT"),
        requested,
      );
      try {
        const stat = await handle.stat();
        const maximum = 8 * 1024 * 1024;
        if (!stat.isFile() || stat.size > maximum)
          throw new Error("Publish a file of 8 MB or smaller.");
        const content = Buffer.alloc(maximum + 1);
        let bytesRead = 0;
        while (bytesRead < content.length) {
          const next = await handle.read(
            content,
            bytesRead,
            content.length - bytesRead,
            bytesRead,
          );
          if (next.bytesRead === 0) break;
          bytesRead += next.bytesRead;
        }
        if (bytesRead > maximum)
          throw new Error("Files must be 8 MB or smaller.");
        const file = await client.publishWorkspaceAsset(agentId, {
          name: requiredString(input, "name"),
          contentType: requiredString(input, "contentType"),
          contentBase64: content.subarray(0, bytesRead).toString("base64"),
          conversationId,
        });
        return {
          fileId: file.id,
          name: file.title,
          path: file.path,
          bytes: bytesRead,
          message: "Saved to the workspace Files library.",
        };
      } finally {
        await handle.close();
      }
    },
  ),
];
