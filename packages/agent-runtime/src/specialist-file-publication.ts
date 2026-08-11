import type { SessionManager } from "./manager.js";
import type { WorkspaceFileRecord } from "./types.js";

interface SpecialistFileContext {
  manager: SessionManager;
  workspaceId: string;
  conversationId: string;
  threadRootId?: string;
}

export async function persistInitialBrandProfileFile(
  input: SpecialistFileContext,
  sessionId: string,
  markdown: string,
) {
  const path = "brand/working-brand-profile.md";
  const existing = (
    await input.manager.listWorkspaceFiles(input.workspaceId)
  ).find((file) => file.path === path);
  if (existing) return existing;
  return input.manager.saveWorkspaceFile(input.workspaceId, {
    name: "Working brand profile.md",
    path,
    content: markdown,
    kind: "document",
    createdBy: "agent",
    sourceAgentId: "brand",
    sourceSessionId: sessionId,
  });
}

/** Publishes one stable document component beside its specialist thread. */
export async function publishSpecialistFileToThread(
  input: SpecialistFileContext,
  file: WorkspaceFileRecord,
) {
  if (!input.threadRootId) return;
  const documentId = `document-${file.id}`;
  const alreadyPublished = (
    await input.manager.messages(input.workspaceId, input.conversationId)
  ).some((message) =>
    message.parts.some(
      (part) => part.type === "data-document" && part.id === documentId,
    ),
  );
  if (alreadyPublished) return;
  const root = await input.manager.rootChat(
    input.workspaceId,
    input.conversationId,
  );
  root.session?.recordAssistantMessage(
    [
      {
        type: "data-document",
        id: documentId,
        data: {
          fileId: file.id,
          title: file.name,
          path: file.path,
          kind: file.kind,
          versionId: file.currentVersionId,
        },
      },
    ],
    {
      id: `specialist-file:${file.id}`,
      threadRootId: input.threadRootId,
    },
  );
  await input.manager.waitForChatPersistence(
    input.workspaceId,
    input.conversationId,
  );
}
