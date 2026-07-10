import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import { SessionManager } from "./manager.js";
import { defaultAgents, getAgent } from "./agents.js";
import { executorToolServer } from "./tools/spec.js";
import type { ClientMessage, InputRequest, ServerMessage } from "./types.js";

const SECRETS_ENV_PATH = join(homedir(), ".marketer", "secrets.env");

function expandHome(path: string): string {
  return path.startsWith("~/") || path === "~"
    ? join(homedir(), path.slice(1))
    : path;
}

/** Key names currently present in ~/.marketer/secrets.env. */
function storedSecretKeys(): string[] {
  if (!existsSync(SECRETS_ENV_PATH)) return [];
  return readFileSync(SECRETS_ENV_PATH, "utf8")
    .split("\n")
    .map((line) => line.split("=")[0]?.trim() ?? "")
    .filter(Boolean);
}

/** Upserts KEY='value' into ~/.marketer/secrets.env (created mode 600). */
function saveEnvSecret(key: string, value: string) {
  mkdirSync(dirname(SECRETS_ENV_PATH), { recursive: true });
  const escaped = value.replace(/'/g, "'\\''");
  const line = `${key}='${escaped}'`;
  let lines: string[] = [];
  if (existsSync(SECRETS_ENV_PATH)) {
    lines = readFileSync(SECRETS_ENV_PATH, "utf8").split("\n").filter(Boolean);
  }
  const index = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (index >= 0) lines[index] = line;
  else lines.push(line);
  writeFileSync(SECRETS_ENV_PATH, lines.join("\n") + "\n", { mode: 0o600 });
}

/**
 * Stores submitted values per each field's save target and returns
 * human-readable destinations for the agent (never the values themselves).
 */
function storeInputValues(
  request: InputRequest,
  values: Record<string, string>,
): string[] {
  const saved: string[] = [];
  for (const field of request.fields) {
    const value = values[field.key];
    if (typeof value !== "string" || value.length === 0) continue;
    if ("file" in field.save) {
      const path = expandHome(field.save.file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, value, { mode: 0o600 });
      saved.push(path);
    } else {
      saveEnvSecret(field.save.envKey, value);
      saved.push(`${field.save.envKey} in ${SECRETS_ENV_PATH}`);
    }
  }
  return saved;
}

const PORT = Number(process.env.MARKETER_RUNTIME_PORT ?? 4318);

/**
 * The agent service. Binds loopback-only; clients (desktop app today,
 * Slack/Discord bridges or a phone via tunnel later) speak the same JSON
 * protocol. Designed to run anywhere node runs — laptop, Raspberry Pi.
 */
export function startServer(port = PORT) {
  const manager = new SessionManager();
  // Bind both loopback families — macOS clients resolving "localhost" may
  // dial ::1 or 127.0.0.1. Never bind non-loopback interfaces here.
  const handler = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
    console.log(`[diag] http ${req.method} ${req.url} from ${req.socket.remoteAddress}`);
    res.writeHead(204, { "access-control-allow-origin": "*" });
    res.end();
  };
  const http4 = createServer(handler);
  const http6 = createServer(handler);
  const wss = new WebSocketServer({ server: http4 });
  const wss6 = new WebSocketServer({ server: http6 });
  http4.listen(port, "127.0.0.1");
  http6.listen(port, "::1");
  http6.on("error", () => {});
  wss6.on("connection", (ws, req) => wss.emit("connection", ws, req));
  wss6.on("error", () => {});

  wss.on("connection", (ws, req) => {
    console.log(`[marketer] client connected (${req.socket.remoteAddress})`);
    ws.on("close", () => console.log("[marketer] client disconnected"));
    const send = (msg: ServerMessage) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };
    const subscriptions = new Set<string>();

    ws.on("message", async (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return send({ type: "error", message: "invalid JSON" });
      }

      try {
        switch (msg.type) {
          case "listAgents":
            send({ type: "agents", agents: defaultAgents });
            break;

          case "openSession": {
            const agent = getAgent(msg.agentId);
            if (!agent) {
              return send({
                type: "error",
                message: `unknown agent: ${msg.agentId}`,
                chatId: msg.chatId,
              });
            }
            // The runtime never picks a provider itself — the client resolves
            // the workspace's choice and must send it.
            if (!msg.driver) {
              return send({
                type: "error",
                message: "no provider configured for this chat",
                chatId: msg.chatId,
              });
            }
            const session = await manager.ensure(agent, msg.chatId, {
              driver: msg.driver,
              access: msg.access ?? "guarded",
              model: msg.model,
              mcpServers: [executorToolServer(msg.workspaceId)].filter(
                (server): server is NonNullable<typeof server> => Boolean(server),
              ),
            });
            if (!subscriptions.has(msg.chatId)) {
              subscriptions.add(msg.chatId);
              const chatId = msg.chatId;
              const listener = (event: unknown) =>
                send({ type: "event", chatId, event: event as never });
              session.on("event", listener);
              ws.on("close", () => session.off("event", listener));
            }
            send({ type: "sessionOpened", chatId: msg.chatId, agentId: agent.id });
            // Replay the buffered transcript so navigating away and back (or
            // reconnecting mid-run) resumes instead of presenting a fresh chat.
            send({ type: "history", chatId: msg.chatId, events: session.events });
            break;
          }

          case "prompt": {
            const session = manager.get(msg.chatId);
            if (!session) {
              return send({
                type: "error",
                message: "No session for this chat yet. Reopen it to reconnect.",
                chatId: msg.chatId,
              });
            }
            await session.sendPrompt(msg.text);
            break;
          }

          case "interrupt":
            await manager.get(msg.chatId)?.interrupt();
            break;

          case "respondPermission":
            manager.get(msg.chatId)?.respondPermission(msg.requestId, msg.behavior);
            break;

          case "queryInputs": {
            const present = storedSecretKeys().filter((key) =>
              msg.keys.includes(key),
            );
            send({ type: "inputsStatus", present });
            break;
          }

          case "storeInput": {
            storeInputValues(msg.request, msg.values);
            send({ type: "inputsStatus", present: storedSecretKeys() });
            break;
          }

          case "provideInput": {
            const session = manager.get(msg.chatId);
            if (!session) {
              return send({
                type: "error",
                message: "No session for this chat yet. Reopen it to reconnect.",
                chatId: msg.chatId,
              });
            }
            const saved = storeInputValues(msg.request, msg.values);
            await session.sendPrompt(
              saved.length > 0
                ? `Provided: ${msg.request.title}. Saved to: ${saved.join(", ")}. Read the values from there when commands need them; never print them. Continue the setup.`
                : `Provided: ${msg.request.title}, but no values were saved. Ask again with clearer fields if you still need them.`,
            );
            break;
          }
        }
      } catch (err) {
        send({
          type: "error",
          message: String(err instanceof Error ? err.message : err),
          chatId: "chatId" in msg ? msg.chatId : undefined,
        });
      }
    });
  });

  console.log(`[marketer] agent runtime listening on ws://127.0.0.1:${port}`);

  const shutdown = async () => {
    await manager.stopAll();
    wss.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return wss;
}

startServer();
