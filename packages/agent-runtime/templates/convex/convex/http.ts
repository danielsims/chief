import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

async function authorized(request: Request) {
  const expectedPassword = process.env.CHIEF_ROUTE_PASSWORD;
  if (!expectedPassword) return false;
  const expected = `Basic ${btoa(`chief-desktop:${expectedPassword}`)}`;
  const supplied = request.headers.get("authorization") ?? "";
  const [left, right] = await Promise.all([digest(expected), digest(supplied)]);
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function sessionPath(request: Request, suffix: string) {
  const path = new URL(request.url).pathname;
  const match = new RegExp(`^/v1/sessions/([^/]+)${suffix}$`).exec(path);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

const health = httpAction(async (_ctx, request) => {
  if (!(await authorized(request))) return json({ error: "unauthorized" }, 401);
  return json({
    ok: true,
    configured: Boolean(process.env.AI_GATEWAY_API_KEY),
  });
});

const start = httpAction(async (ctx, request) => {
  if (!(await authorized(request))) return json({ error: "unauthorized" }, 401);
  let candidate: unknown;
  try {
    candidate = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!candidate || typeof candidate !== "object") {
    return json({ error: "invalid_json" }, 400);
  }
  const body = candidate as { sessionId?: unknown; prompt?: unknown };
  if (
    typeof body.prompt !== "string" ||
    !body.prompt.trim() ||
    body.prompt.length > 40_000
  ) {
    return json({ error: "prompt_must_be_1_to_40000_characters" }, 400);
  }
  if (body.sessionId !== undefined && typeof body.sessionId !== "string") {
    return json({ error: "invalid_session_id" }, 400);
  }
  const publicId = body.sessionId ?? crypto.randomUUID();
  const configuredModel = process.env.CHIEF_DEPLOYMENT_MODEL;
  const model = configuredModel ?? "xai/grok-4.3";
  try {
    await ctx.runMutation(internal.sessions.start, {
      publicId,
      prompt: body.prompt,
      model,
    });
    await ctx.scheduler.runAfter(0, internal.agent.run, { publicId });
    return json({ sessionId: publicId }, 202);
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : "Could not start session.",
      },
      409,
    );
  }
});

const events = httpAction(async (ctx, request) => {
  if (!(await authorized(request))) return json({ error: "unauthorized" }, 401);
  const publicId = sessionPath(request, "/events");
  if (!publicId) return json({ error: "not_found" }, 404);
  const rawAfter = new URL(request.url).searchParams.get("after") ?? "-1";
  const after = Number(rawAfter);
  if (!Number.isSafeInteger(after) || after < -1)
    return json({ error: "invalid_cursor" }, 400);
  const result = await ctx.runQuery(internal.sessions.events, {
    publicId,
    after,
  });
  return result ? json(result) : json({ error: "not_found" }, 404);
});

const cancel = httpAction(async (ctx, request) => {
  if (!(await authorized(request))) return json({ error: "unauthorized" }, 401);
  const publicId = sessionPath(request, "/cancel");
  if (!publicId) return json({ error: "not_found" }, 404);
  return json({
    canceled: await ctx.runMutation(internal.sessions.cancel, { publicId }),
  });
});

const http = httpRouter();
http.route({ path: "/v1/health", method: "GET", handler: health });
http.route({ path: "/v1/sessions", method: "POST", handler: start });
http.route({ pathPrefix: "/v1/sessions/", method: "GET", handler: events });
http.route({ pathPrefix: "/v1/sessions/", method: "POST", handler: cancel });
export default http;
