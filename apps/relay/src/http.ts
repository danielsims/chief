import { relayErrorSchema } from "@chief/relay-contracts";

export function json(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}

export function relayError(
  status: number,
  code: string,
  message: string,
  requestId?: string,
  details?: Record<string, unknown>,
) {
  const body = relayErrorSchema.parse({
    error: { code, message, requestId, details },
  });
  return json(body, { status });
}

export async function parseJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Expected JSON.");
  }
  try {
    return await request.json();
  } catch {
    throw new HttpError(
      400,
      "invalid_json",
      "The request body is not valid JSON.",
    );
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
