import assert from "node:assert/strict";
import { once } from "node:events";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { AgentEvent } from "../src/types.js";
import {
  agentLocalToolServer,
  createAgentLocalMcpHandler,
} from "../src/agent-local-mcp.js";
import { composeWorkspaceInstructions, getAgent } from "../src/agents/index.js";
import { handleChannelLocalTool } from "../src/channel-local-tools.js";
import { createChannelEvent } from "../src/channels/nip29.js";
import { LocalStore } from "../src/local-store.js";
import { localToolsOpenApi } from "../src/local-tools.js";
import { AgentSession } from "../src/session.js";

const databaseKey = "chief-live-channel-smoke-test-key";
const token = "chief-live-channel-smoke-capability";
const workspaceId = "live-smoke-workspace";
const liveModel = "opencode-go/deepseek-v4-flash";
process.env.CHIEF_DATABASE_ENCRYPTION_KEY = databaseKey;
const startedAt = Date.now();
const runId = new Date(startedAt).toISOString().replace(/[:.]/gu, "-");
const artifactDirectory = join(process.cwd(), ".cache", "agent-tests", runId);
const timelinePath = join(artifactDirectory, "events.jsonl");
mkdirSync(artifactDirectory, { recursive: true });

function observe(source: string, type: string, detail: unknown = {}) {
  const entry = {
    at: Date.now(),
    elapsedMs: Date.now() - startedAt,
    source,
    type,
    detail,
  };
  appendFileSync(timelinePath, `${JSON.stringify(entry)}\n`);
  console.log(
    `${String(entry.elapsedMs).padStart(6)}ms  ${source.padEnd(9)} ${type}`,
  );
}

function check(label: string, condition: boolean) {
  observe("assert", condition ? "passed" : "failed", { label });
  assert.ok(condition, label);
}

function body(request: IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    request.on("data", (chunk: unknown) => {
      if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
      else if (chunk instanceof Uint8Array) chunks.push(chunk);
    });
    request.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(
          JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
            string,
            unknown
          >,
        );
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function json(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

const directory = mkdtempSync(join(tmpdir(), "chief-live-agent-smoke-"));
const externalProjectDirectory = mkdtempSync(
  join(tmpdir(), "chief-live-external-project-"),
);
const externalMarker = "chief-external-project-access-ok";
const externalMarkerPath = join(externalProjectDirectory, "project-marker.txt");
writeFileSync(externalMarkerPath, `${externalMarker}\n`);
const store = new LocalStore(join(directory, "chief.sqlite"));
const server = createServer();
let session: AgentSession | undefined;
let failure: unknown;
const sessionEvents: AgentEvent[] = [];

try {
  observe("harness", "workspace.creating", { workspaceId });
  const channel = await store.channelStore().create(workspaceId, {
    name: "Engineering live smoke",
    operationKey: "engineering-live-smoke",
    agentIds: ["engineer"],
    userIds: ["workspace-owner"],
  });
  const root = createChannelEvent({
    workspaceId,
    channelId: channel.id,
    actor: { type: "user", id: "workspace-owner", name: "Daniel Sims" },
    content: "Please verify that the channel agent contract works.",
    mentions: ["engineer"],
    sourceId: "live-smoke-request",
  });
  await store.channelStore().appendEvent(workspaceId, root);
  observe("channel", "user.message", {
    channelId: channel.id,
    messageId: root.id,
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const handleMcp = createAgentLocalMcpHandler({
    authenticate: (candidate) =>
      candidate === token
        ? {
            kind: "agent-session",
            workspaceId,
            agentId: "engineer",
            sessionId: "live-smoke-session",
            expiresAt: Date.now() + 5 * 60_000,
            localToolPermissions: ["messages.read", "messages.send"],
          }
        : undefined,
    openApi: () => localToolsOpenApi(origin),
    origin,
  });
  server.on("request", (request, response) => {
    void (async () => {
      if (await handleMcp(request, response)) return;
      const url = new URL(request.url ?? "/", origin);
      if (!url.pathname.startsWith("/local-tools/channels")) {
        json(response, { error: "not_found" }, 404);
        return;
      }
      const requestBody = await body(request);
      const webRequest = new Request(url, {
        method: request.method,
        headers: { "content-type": "application/json" },
        ...(request.method === "GET"
          ? {}
          : { body: JSON.stringify(requestBody) }),
      });
      const result = await handleChannelLocalTool(
        webRequest,
        workspaceId,
        requestBody,
        {
          actor: { type: "agent", id: "engineer", name: "Engineer" },
          channelStore: store.channelStore(),
          availableAgentIds: ["chief", "engineer"],
          onChannelEvent: (event) => {
            observe("channel", `kind.${event.kind}`, {
              actor: event.actor,
              content: event.content,
              eventId: event.id,
            });
          },
        },
      );
      json(response, result.value ?? {}, result.status ?? 200);
    })().catch((error: unknown) => {
      if (!response.headersSent) {
        json(
          response,
          { error: error instanceof Error ? error.message : String(error) },
          500,
        );
      } else response.end();
    });
  });

  const engineer = getAgent("engineer");
  assert.ok(engineer);
  session = new AgentSession(
    {
      ...engineer,
      instructions: composeWorkspaceInstructions(engineer.instructions),
    },
    "live-channel-smoke",
    {
      driver: "opencode",
      access: "full",
      workspaceId,
      maxPromptAttempts: 1,
      stallTimeoutMs: 90_000,
      model: liveModel,
      mcpServers: [agentLocalToolServer(origin, token)],
    },
  );
  session.on("event", (event: AgentEvent) => {
    sessionEvents.push(event);
    observe("session", event.type, event);
  });
  observe("harness", "provider.starting", {
    driver: "opencode",
    model: liveModel,
  });
  await session.start(directory);
  observe("harness", "prompt.sending");
  await session.sendPrompt(
    [
      "Run one live Chief channel contract smoke test.",
      `The current channelId is ${JSON.stringify(channel.id)} and messageId is ${JSON.stringify(root.id)}.`,
      "Use the Chief local tools, not ordinary assistant text, to do exactly this:",
      `1. Use the shell to run: cat ${JSON.stringify(externalMarkerPath)}`,
      "2. Add 👀 to the user message.",
      "3. Post one concise acknowledgement in that message's thread.",
      "4. Post one concise verified completion in the same thread.",
      "5. Remove your 👀 reaction.",
      "Do not perform any other work.",
    ].join("\n"),
    "live-smoke-prompt",
    true,
    { threadRootId: root.id, mentions: ["engineer"] },
  );

  const events = await store.channelStore().events(workspaceId, channel.id);
  const reactionIndex = events.findIndex((event) => event.kind === 7);
  const agentMessageIndexes = events.flatMap((event, index) =>
    event.kind === 9 && event.actor.type === "agent" ? [index] : [],
  );
  const removalIndex = events.findIndex((event) => event.kind === 5);
  check(
    "Engineer accessed a project outside its agent workspace without a hidden approval",
    sessionEvents.some(
      (event) =>
        event.type === "message" &&
        event.content.some(
          (block) =>
            block.type === "tool_result" &&
            block.content.includes(externalMarker),
        ),
    ),
  );
  check("Engineer added a reaction through the tool", reactionIndex >= 0);
  check(
    "Engineer published acknowledgement and completion",
    agentMessageIndexes.length >= 2,
  );
  check(
    "Reaction preceded the acknowledgement",
    reactionIndex < (agentMessageIndexes[0] ?? -1),
  );
  check(
    "Reaction removal followed the completion",
    removalIndex > (agentMessageIndexes.at(-1) ?? Number.MAX_SAFE_INTEGER),
  );
  check(
    "Published agent messages contain no em dashes",
    events
      .filter((event) => event.kind === 9 && event.actor.type === "agent")
      .every((event) => !event.content.includes("—")),
  );
  writeFileSync(
    join(artifactDirectory, "channel-events.json"),
    `${JSON.stringify(events, null, 2)}\n`,
  );
  writeFileSync(
    join(artifactDirectory, "summary.json"),
    `${JSON.stringify(
      {
        status: "passed",
        elapsedMs: Date.now() - startedAt,
        workspaceId,
        durableEventCount: events.length,
        agentMessageCount: agentMessageIndexes.length,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `Live channel smoke passed with ${agentMessageIndexes.length} agent messages and ${events.length} durable events.`,
  );
  console.log(`Artifacts: ${artifactDirectory}`);
} catch (error) {
  failure = error;
  observe("harness", "failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  throw error;
} finally {
  await session?.stop().catch(() => undefined);
  server.close();
  if (server.listening) await once(server, "close");
  await store.close();
  rmSync(directory, { recursive: true, force: true });
  rmSync(externalProjectDirectory, { recursive: true, force: true });
  if (failure) {
    writeFileSync(
      join(artifactDirectory, "summary.json"),
      `${JSON.stringify(
        {
          status: "failed",
          elapsedMs: Date.now() - startedAt,
          message: failure instanceof Error ? failure.message : String(failure),
        },
        null,
        2,
      )}\n`,
    );
    console.error(`Failure artifacts: ${artifactDirectory}`);
  }
}
