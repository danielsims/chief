import assert from "node:assert/strict";
import test from "node:test";

import type {
  SpecialistFileManager,
  SpecialistFilePart,
} from "../src/specialist-file-publication.js";
import type { WorkspaceFileRecord } from "../src/types.js";
import { publishSpecialistFileToThread } from "../src/specialist-file-publication.js";

void test("agent-created file versions publish only in their owning threads", async () => {
  const published: {
    id: string;
    metadata: { threadRootId?: string };
    parts: SpecialistFilePart[];
  }[] = [];
  const session = {
    recordAssistantMessage(
      parts: SpecialistFilePart[],
      metadata: { id: string; threadRootId?: string },
    ) {
      published.push({ id: metadata.id, metadata, parts });
    },
  };
  const manager = {
    messages: () => Promise.resolve(published),
    rootChat: () => Promise.resolve({ session }),
    waitForChatPersistence: () => Promise.resolve(),
  } satisfies SpecialistFileManager;
  const file: WorkspaceFileRecord = {
    id: "report",
    name: "Research report.md",
    path: "research/report.md",
    mimeType: "text/markdown",
    kind: "document",
    provider: "local",
    currentVersionId: "version-1",
    createdBy: "agent",
    sourceAgentId: "researcher",
    sourceSessionId: "specialist-researcher",
    createdAt: 1,
    updatedAt: 1,
  };

  const context = {
    manager,
    workspaceId: "workspace",
    conversationId: "channel:research",
  };
  await publishSpecialistFileToThread(
    { ...context, threadRootId: "thread-a" },
    file,
  );
  await publishSpecialistFileToThread(
    { ...context, threadRootId: "thread-a" },
    file,
  );
  await publishSpecialistFileToThread(
    { ...context, threadRootId: "thread-b" },
    file,
  );
  await publishSpecialistFileToThread(
    { ...context, threadRootId: "thread-a" },
    { ...file, currentVersionId: "version-2", updatedAt: 2 },
  );

  assert.equal(published.length, 3);
  assert.deepEqual(
    published.map((message) => message.metadata.threadRootId),
    ["thread-a", "thread-b", "thread-a"],
  );
  assert.notEqual(published[0]?.id, published[1]?.id);
  assert.match(published[0]?.id ?? "", /:report:version-1$/u);
  assert.match(published[1]?.id ?? "", /:report:version-1$/u);
  assert.match(published[2]?.id ?? "", /:report:version-2$/u);
});
