import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { SessionManager } from "./manager.js";
import { defaultAgents, getAgent } from "./agents.js";
import type { ClientMessage, ServerMessage } from "./types.js";

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
            const base = getAgent(msg.agentId);
            if (!base) {
              return send({
                type: "error",
                message: `unknown agent: ${msg.agentId}`,
                chatId: msg.chatId,
              });
            }
            const agent = {
              ...base,
              driver: msg.driver ?? base.driver,
              model: msg.model ?? base.model,
            };
            const session = await manager.ensure(agent, msg.chatId);
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
                message: "no session — send openSession first",
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
