import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import { readConfig } from "./config";
import { createExecutorHandler } from "./handler";

const config = readConfig(process.env);
const handle = createExecutorHandler(config);

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

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
