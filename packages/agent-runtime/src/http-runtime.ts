import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "node:http";

type AsyncRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>;

export function localToolRequest(input: {
  origin: string;
  url?: string;
  method?: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}) {
  const method = (input.method ?? "GET").toUpperCase();
  const supportsBody = method !== "GET" && method !== "HEAD";
  return new Request(new URL(input.url ?? "/", input.origin), {
    method,
    headers: Object.fromEntries(
      Object.entries(input.headers).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value]] : [],
      ),
    ),
    ...(supportsBody && Object.keys(input.body).length > 0
      ? { body: JSON.stringify(input.body) }
      : {}),
  });
}

/** Keep one malformed HTTP request from terminating the entire agent runtime. */
export function guardedRequestHandler(
  handler: AsyncRequestHandler,
  report: (error: unknown, request: IncomingMessage) => void = (
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
    void handler(request, response).catch((error: unknown) => {
      report(error, request);
      if (response.writableEnded || response.destroyed) return;
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      response.writeHead(500, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: "Chief could not complete this local request.",
        }),
      );
    });
  };
}
