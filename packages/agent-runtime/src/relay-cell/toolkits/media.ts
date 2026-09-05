import { open, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { requiredEnvironment } from "../context.js";
import { requiredString } from "../input.js";
import { defineRelayCellTool } from "../tool.js";

export const relayCellMediaTools = [
  defineRelayCellTool(
    "computer.artifacts.publish",
    "workspace.write",
    async ({ client, agentId, conversationId }, input) => {
      const root = await realpath(requiredEnvironment("CHIEF_CELL_ROOT"));
      const requested = requiredString(input, "path").replace(
        /^\/workspace\/?/u,
        "",
      );
      const path = await realpath(resolve(root, requested));
      const scoped = relative(root, path);
      if (
        !scoped ||
        scoped === ".." ||
        scoped.startsWith(`..${sep}`) ||
        resolve(root, scoped) !== path
      ) {
        throw new Error(
          "Published files must stay inside the agent workspace.",
        );
      }
      const handle = await open(path, "r");
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
