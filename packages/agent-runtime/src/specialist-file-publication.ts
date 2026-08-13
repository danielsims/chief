import { createHash } from "node:crypto";

import type { SessionManager } from "./manager.js";
import type { WorkspaceFileRecord } from "./types.js";

interface SpecialistFileContext {
  manager: SessionManager;
  workspaceId: string;
  conversationId: string;
  threadRootId?: string;
}

/** Publishes a file version in the exact thread owned by its calling agent. */
export async function publishSpecialistFileToThread(
  input: SpecialistFileContext,
  file: WorkspaceFileRecord,
) {
  if (!input.threadRootId) return;
  const threadIdentity = createHash("sha256")
    .update(input.threadRootId)
    .digest("hex")
    .slice(0, 16);
  const documentId = `document-${threadIdentity}-${file.id}-${file.currentVersionId}`;
  const alreadyPublished = (
    await input.manager.messages(input.workspaceId, input.conversationId)
  ).some(
    (message) =>
      message.metadata?.threadRootId === input.threadRootId &&
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
      id:
        `specialist-file:${threadIdentity}:${file.id}:` + file.currentVersionId,
      threadRootId: input.threadRootId,
    },
  );
  await input.manager.waitForChatPersistence(
    input.workspaceId,
    input.conversationId,
  );
}
