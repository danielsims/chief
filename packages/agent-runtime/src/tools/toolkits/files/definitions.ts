import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { boundedText, optionalBoundedText } from "../../input.js";

export const listFilesDefinition = defineAgentTool({
  method: "GET",
  path: "/local-tools/files",
  operation: {
    operationId: "files.list",
    summary:
      "List documents and published media visible to you in this workspace",
  },
});
export const readFileDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/files/read",
  operation: {
    operationId: "files.read",
    summary: "Read a workspace document or published media metadata",
  },
  inputSchema: z.object({ fileId: boundedText(120) }),
});
export const writeFileDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/files/write",
  operation: {
    operationId: "files.write",
    summary: "Create or revise a workspace document",
    description:
      "Saves a versioned document in the current conversation. For revisions, pass the file's version as expectedVersionId, converted to a string. Use computer.artifacts.publish for existing images, PDFs, recordings, and other binary files.",
  },
  inputSchema: z.object({
    id: optionalBoundedText(120),
    name: boundedText(160),
    path: optionalBoundedText(240),
    content: boundedText(200_000),
    kind: z.enum(["document", "email"]).default("document"),
    expectedVersionId: optionalBoundedText(120),
    agentId: optionalBoundedText(80),
    sourceSessionId: optionalBoundedText(120),
  }),
});
