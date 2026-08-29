import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";

import { BrowserRegistry } from "./browser-registry";
import { readConfig } from "./config";
import { createExecutorHandler } from "./handler";

const config = readConfig(process.env);
const browsers = new BrowserRegistry(config);
const handle = createExecutorHandler(config, browsers);

const server = createServer((request, response) => {
  void handleRequest(request, response);
});
const streams = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  void handleUpgrade(request, socket, head);
});

async function handleUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) {
  const origin = `http://${request.headers.host ?? `127.0.0.1:${config.PORT}`}`;
  const url = new URL(request.url ?? "/", origin);
  const ticket = url.searchParams.get("ticket");
  const streamUrl =
    url.pathname === "/v1/browser/stream" && ticket
      ? await browsers.resolveStreamTicket(ticket)
      : undefined;
  if (!streamUrl) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const upstream = new WebSocket(streamUrl);
  let upgraded = false;
  upstream.once("open", () => {
    upgraded = true;
    streams.handleUpgrade(request, socket, head, (client) => {
      client.on("message", (data, binary) => upstream.send(data, { binary }));
      upstream.on("message", (data, binary) => client.send(data, { binary }));
      client.once("close", () => upstream.close());
      upstream.once("close", () => client.close());
      const close = () => {
        client.close(1011, "Browser stream failed");
        upstream.close();
      };
      client.once("error", close);
      upstream.once("error", close);
    });
  });
  upstream.once("error", () => {
    if (!upgraded) socket.destroy();
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    const origin = `http://${request.headers.host ?? `127.0.0.1:${config.PORT}`}`;
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (Array.isArray(value))
        value.forEach((item) => headers.append(name, item));
      else if (value !== undefined) headers.set(name, value);
    }
    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await readIncomingBody(request, 15_000_000);
    const webRequest = new Request(new URL(request.url ?? "/", origin), {
      method: request.method,
      headers,
      body,
    });
    const result = await handle(webRequest);
    response.writeHead(
      result.status,
      Object.fromEntries(result.headers.entries()),
    );
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    response.writeHead(413, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { code: "request_too_large" } }));
  }
}

server.listen(config.PORT, "0.0.0.0", () => {
  process.stdout.write(`chief-executor listening on ${config.PORT}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function readIncomingBody(
  request: AsyncIterable<Uint8Array>,
  maximumBytes: number,
) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maximumBytes) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}
