import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { ContentDraftRecord } from "../../../../types.js";
import { boundedText, optionalBoundedText, time } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

function fileSlug(input: string) {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 64) || "draft"
  );
}

const contentInputSchema = z.object({
  id: optionalBoundedText(120),
  agentId: optionalBoundedText(80),
  title: boundedText(200),
  body: boundedText(20_000).pipe(z.string().min(100)),
  platform: boundedText(80),
  status: z.enum(["draft", "approved", "scheduled", "published"]).optional(),
  scheduledFor: z.union([z.number(), z.string()]).optional(),
});

export const saveContentTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/content",
  operation: {
    operationId: "content.save",
    summary: "Create or update content",
    description:
      "Saves a complete platform-ready body and creates a linked editable workspace document.",
  },
  inputSchema: contentInputSchema,
  async execute({ input, manager, workspaceId }) {
    const data = await manager.workspaceData(workspaceId);
    const now = Date.now();
    const scheduledFor =
      input.scheduledFor === undefined ? undefined : time(input.scheduledFor);
    const id = input.id ?? randomUUID();
    const title = input.title;
    const content = input.body;
    const existingDraft = data.drafts.find((item) => item.id === id);
    const existingFile = existingDraft?.fileId
      ? await manager.workspaceFile(workspaceId, existingDraft.fileId)
      : null;
    const agentId = input.agentId ?? existingDraft?.agentId ?? "chief";
    const file = await manager.saveWorkspaceFile(workspaceId, {
      id: existingFile?.id,
      name: title,
      path:
        existingFile?.path ?? `content/${fileSlug(title)}-${id.slice(0, 8)}.md`,
      content,
      kind: "document",
      expectedVersionId: existingFile?.currentVersionId,
      createdBy: "agent",
      sourceAgentId: agentId,
    });
    const draft: ContentDraftRecord = {
      id,
      agentId,
      title,
      body: content,
      platform: input.platform,
      fileId: file.id,
      status: input.status ?? (scheduledFor ? "scheduled" : "draft"),
      scheduledFor: scheduledFor ?? existingDraft?.scheduledFor,
      createdAt: existingDraft?.createdAt ?? now,
      updatedAt: now,
    };
    await manager.saveDraft(workspaceId, draft);
    return jsonResponse({ draft, file });
  },
});
