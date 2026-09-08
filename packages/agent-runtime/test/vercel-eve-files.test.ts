import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";

import {
  externalAgentToolCallSchema,
  missionCreateSchema,
} from "@chief/relay-contracts";

import { eveProjectFiles } from "../src/vercel-eve-provisioning.js";
import { eveChiefToolClientSource } from "../src/vercel-eve-tool-files.js";

const environment = {
  CHIEF_AGENT_ID: "researcher",
  CHIEF_CHANNEL_TOKEN: "channel-token",
  CHIEF_DELIVERY_SIGNING_KEY_ID: "dsk_researcher",
  CHIEF_DELIVERY_SIGNING_SECRET: "signing-secret",
  CHIEF_RELAY_URL: "https://relay.example.com",
  CHIEF_WORKSPACE_ID: "workspace-1",
};

void test("packages declared specialists as native Eve subagents", () => {
  const files = eveProjectFiles({
    teamId: "team_chief",
    project: { kind: "new", projectName: "chief" },
    agent: {
      id: "chief",
      name: "Chief",
      description: "Coordinates the workspace.",
      instructions: "# Identity\n\nCoordinate the work.",
      subagents: [
        {
          id: "prospector",
          name: "Prospector",
          role: "Research and outreach",
          description: "Finds qualified prospects.",
          instructions: "# Identity\n\nFind qualified prospects.",
        },
        {
          id: "engineer",
          name: "Engineer",
          role: "Product engineering",
          description: "Works on the product.",
          instructions: "# Identity\n\nWork on the product.",
        },
      ],
      model: "openai/gpt-5.6-terra",
    },
    environment: { ...environment, CHIEF_AGENT_ID: "chief" },
  });
  for (const file of files.filter((file) =>
    file.path.endsWith("instructions.md"),
  )) {
    assert.ok(file.contents.includes("files.write"), file.path);
    assert.ok(file.contents.includes("artifactIds"), file.path);
  }
  const paths = files.map((file) => file.path);
  assert.ok(paths.includes("agent/subagents/prospector/agent.ts"));
  assert.ok(paths.includes("agent/subagents/prospector/instructions.md"));
  assert.ok(paths.includes("agent/subagents/engineer/agent.ts"));
  assert.ok(paths.includes("agent/subagents/engineer/instructions.md"));
  const manifest = z
    .object({ subagents: z.array(z.record(z.string(), z.unknown())) })
    .parse(
      JSON.parse(
        files.find((file) => file.path === ".chief/agent.json")?.contents ??
          "{}",
      ),
    );
  assert.deepEqual(manifest.subagents, [
    {
      id: "prospector",
      name: "Prospector",
      role: "Research and outreach",
      description: "Finds qualified prospects.",
      capabilities: [],
      path: "agent/subagents/prospector",
    },
    {
      id: "engineer",
      name: "Engineer",
      role: "Product engineering",
      description: "Works on the product.",
      capabilities: [],
      path: "agent/subagents/engineer",
    },
  ]);
  assert.doesNotMatch(
    files.find((file) => file.path === "agent/instructions.md")?.contents ?? "",
    /Prospector agent instructions/u,
  );
  const instructions =
    files.find((file) => file.path === "agent/instructions.md")?.contents ?? "";
  assert.match(instructions, /Chief channel replies/u);
  assert.match(instructions, /ordinary assistant text is delivered/u);
  assert.match(instructions, /channels_reactions_add/u);
  assert.match(instructions, /channels_messages_post/u);
  const channel =
    files.find((file) => file.path === "agent/channels/chief.ts")?.contents ??
    "";
  assert.match(channel, /"turn\.completed"/u);
  assert.match(channel, /"input\.requested"/u);
  assert.match(channel, /"session\.waiting"/u);
  assert.match(channel, /postReply/u);
  assert.match(channel, /finishReason !== "tool-calls"/u);
  assert.match(channel, /Call channels_reactions_add/u);
  assert.match(channel, /peopleRoster/u);
  assert.match(channel, /projects\.recommend/u);
  assert.ok(
    files.some((file) => file.path === "agent/tools/channels_messages_post.ts"),
  );
  assert.ok(
    files.some((file) => file.path === "agent/tools/channels_reactions_add.ts"),
  );
});

void test("generated Eve client sends strict workspace inputs without borrowing message fields", async () => {
  const bodies: ReturnType<typeof externalAgentToolCallSchema.parse>[] = [];
  const code = ts.transpileModule(eveChiefToolClientSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module: unknown = runInNewContext(`${code}; exports`, {
    exports: {},
    URL,
    process: { env: environment },
    require: () => ({
      currentChiefDelivery: () => ({
        agentId: "researcher",
        deliveryId: "delivery-1",
        capability: "c".repeat(43),
        sessionId: "session-1",
        conversationId: "source-channel",
        messageId: "source-message",
        threadRootId: "source-thread",
      }),
      noteChiefMessagePosted: () => undefined,
    }),
    fetch: async (_url: URL, init: RequestInit) => {
      bodies.push(
        externalAgentToolCallSchema.parse(await new Response(init.body).json()),
      );
      return Response.json({ ok: true });
    },
  });
  const client = z
    .object({
      callChiefTool: z
        .function()
        .args(
          z.string(),
          z.record(z.unknown()),
          z.string(),
          z.object({ session: z.object({ id: z.string() }) }),
        )
        .returns(z.promise(z.unknown())),
    })
    .parse(module);
  const mission = missionCreateSchema.parse({
    id: "launch-mission",
    conversationId: "mission-channel",
    title: "Launch",
    objective: "Publish a reviewed launch brief",
    ownerAgentId: "engineer",
    collaborators: [],
    success: { kind: "deliverable", description: "A reviewed launch brief" },
    maxExperiments: 3,
    deadline: "2026-12-01T00:00:00.000Z",
    constraints: "Do not publish externally",
  });
  await client.callChiefTool("missions.create", mission, "researcher", {
    session: { id: "session-1" },
  });
  assert.deepEqual(missionCreateSchema.parse(bodies[0]?.input), mission);
  await client.callChiefTool(
    "channels.messages.post",
    {
      channelId: "different-channel",
      content: "Mission ready",
    },
    "researcher",
    { session: { id: "session-1" } },
  );
  assert.deepEqual(bodies[1]?.input, {
    channelId: "different-channel",
    content: "Mission ready",
  });
  await client.callChiefTool(
    "channels.reactions.add",
    { emoji: "👀" },
    "researcher",
    { session: { id: "session-1" } },
  );
  assert.deepEqual(bodies[2]?.input, {
    emoji: "👀",
    channelId: "source-channel",
    messageId: "source-message",
  });
});
