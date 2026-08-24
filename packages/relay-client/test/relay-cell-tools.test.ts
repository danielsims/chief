import assert from "node:assert/strict";
import test from "node:test";

import { isJsonString } from "@chief/relay-contracts";

import { RelayClient } from "../src/relay-client";

const timestamp = "2026-08-21T00:00:00.000Z";
const message = {
  id: "message-1",
  workspaceId: "workspace-a",
  conversationId: "general",
  body: "Message 1",
  author: { kind: "agent" as const, id: "chief" },
  createdAt: timestamp,
  sequence: 1,
  mentions: [],
  components: [],
  reactions: [],
  edited: false,
  deleted: false,
};
const file = {
  id: "brand-profile",
  path: "brand/profile.md",
  title: "Brand profile",
  mimeType: "text/markdown",
  content: "# Brand",
  conversationId: "marketing",
  authorAgentId: "brand",
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const project = {
  id: "project-1",
  organizationId: "workspace-a",
  name: "Chief",
  repositoryKind: "cloned" as const,
  providerId: "github" as const,
  canonicalRemoteUrl: "https://github.com/latent/chief.git",
  repositoryWebUrl: "https://github.com/latent/chief",
  defaultBranch: "main",
  createdAt: timestamp,
  updatedAt: timestamp,
};

void test("exposes the shared cell read and conversation tool routes", async () => {
  const requests: { method: string; url: string; body: unknown }[] = [];
  const client = new RelayClient({
    relayUrl: "https://relay.test",
    workspaceId: "workspace-a",
    getAuthorization: () => Promise.resolve("Nostr signed-request"),
    fetch: (input, init) => {
      const url = new URL(
        isJsonString(input)
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );
      requests.push({
        method: init?.method ?? "GET",
        url: `${url.pathname}${url.search}`,
        body: isJsonString(init?.body) ? JSON.parse(init.body) : null,
      });
      if (url.pathname.endsWith("/data/brand-profile")) {
        return Promise.resolve(
          jsonResponse({
            markdown: "# Brand",
            sourceUrls: ["https://example.com"],
            version: 1,
            authorAgentId: "brand",
            updatedAt: timestamp,
          }),
        );
      }
      if (url.pathname.endsWith("/files")) {
        return Promise.resolve(
          jsonResponse(init?.method === "POST" ? file : { files: [file] }),
        );
      }
      if (url.pathname.endsWith("/projects")) {
        return Promise.resolve(
          jsonResponse(
            init?.method === "POST" ? project : { projects: [project] },
          ),
        );
      }
      if (url.pathname.endsWith("/reactions")) {
        return Promise.resolve(
          jsonResponse({ add: init?.method === "POST", message }),
        );
      }
      return Promise.resolve(
        jsonResponse({ messages: [message], nextSequence: null }),
      );
    },
  });

  assert.equal((await client.loadBrandProfile())?.version, 1);
  assert.equal(
    (await client.listWorkspaceFiles())[0]?.path,
    "brand/profile.md",
  );
  await client.listThreadReplies("general", "message-1", { after: 4 });
  await client.searchMessages("general", "launch plan", { limit: 25 });
  await client.reactToMessage("general", "message-1", "👍", true);
  await client.saveWorkspaceFile({
    path: "brand/profile.md",
    title: "Brand profile",
    mimeType: "text/markdown",
    content: "# Brand",
    conversationId: "marketing",
  });
  assert.equal((await client.listProjects())[0]?.id, "project-1");
  await client.createProject({
    name: "Chief",
    repositoryKind: "cloned",
    providerId: "github",
    canonicalRemoteUrl: "https://github.com/latent/chief.git",
    repositoryWebUrl: "https://github.com/latent/chief",
    defaultBranch: "main",
  });

  assert.deepEqual(requests, [
    {
      method: "GET",
      url: "/v1/workspaces/workspace-a/data/brand-profile",
      body: null,
    },
    {
      method: "GET",
      url: "/v1/workspaces/workspace-a/files",
      body: null,
    },
    {
      method: "GET",
      url: "/v1/workspaces/workspace-a/conversations/general/messages/message-1/replies?after=4",
      body: null,
    },
    {
      method: "GET",
      url: "/v1/workspaces/workspace-a/conversations/general/messages?q=launch+plan&limit=25",
      body: null,
    },
    {
      method: "POST",
      url: "/v1/workspaces/workspace-a/conversations/general/messages/message-1/reactions",
      body: { messageId: "message-1", emoji: "👍" },
    },
    {
      method: "POST",
      url: "/v1/workspaces/workspace-a/files",
      body: {
        path: "brand/profile.md",
        title: "Brand profile",
        mimeType: "text/markdown",
        content: "# Brand",
        conversationId: "marketing",
      },
    },
    {
      method: "GET",
      url: "/v1/workspaces/workspace-a/projects",
      body: null,
    },
    {
      method: "POST",
      url: "/v1/workspaces/workspace-a/projects",
      body: {
        name: "Chief",
        repositoryKind: "cloned",
        providerId: "github",
        canonicalRemoteUrl: "https://github.com/latent/chief.git",
        repositoryWebUrl: "https://github.com/latent/chief",
        defaultBranch: "main",
      },
    },
  ]);
});

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
