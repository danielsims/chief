import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "node:http";

import { isJsonString } from "@chief/relay-contracts";

type AsyncRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>;

export function localToolRequest(input: {
  origin: string;
  url?: string;
  method?: string;
  headers: IncomingHttpHeaders;
  body: object;
}) {
  const method = (input.method ?? "GET").toUpperCase();
  const supportsBody = method !== "GET" && method !== "HEAD";
  return new Request(new URL(input.url ?? "/", input.origin), {
    method,
    headers: Object.fromEntries(
      Object.entries(input.headers).flatMap(([key, value]) =>
        isJsonString(value) ? [[key, value]] : [],
      ),
    ),
    ...(supportsBody && Object.keys(input.body).length > 0
      ? { body: JSON.stringify(input.body) }
      : undefined),
  });
}

/** Keep one malformed HTTP request from terminating the entire agent runtime. */
export function guardedRequestHandler(
  handler: AsyncRequestHandler,
  report: (error: Error, request: IncomingMessage) => void = (
    error,
    request,
  ) => {
    console.error(
      `[runtime] ${request.method ?? "GET"} ${request.url ?? "/"} failed:`,
      error,
    );
  },
) {
  return (request: IncomingMessage, response: ServerResponse) => {
    void handler(request, response).catch((cause) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      report(error, request);
      if (response.writableEnded || response.destroyed) return;
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      response.writeHead(500, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      const message = error.message
        ? error.message
        : "Chief could not complete this local request.";
      response.end(
        JSON.stringify({
          error: message,
          code: "local_tool_failed",
        }),
      );
    });
  };
}
