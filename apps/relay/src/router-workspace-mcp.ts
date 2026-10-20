import { Effect } from "effect";
import { z } from "zod";

import type { JsonObject, WorkspaceId } from "@chief/relay-contracts";
import {
  jsonObjectSchema,
  relayErrorSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { automationChiefTools } from "./automation-tools";
import { connectionDocument, escapeHtml, htmlPage } from "./connection-pages";
import { attempt, sync } from "./effect";
import { relayOrigin } from "./hosted-project-checkout";
import { HttpError, relayError } from "./http";
import { withTrustedContext } from "./internal-context";
import {
  MCP_OAUTH_CALLBACK_PATH,
  MCP_OAUTH_CLIENT_METADATA_PATH,
  MCP_OAUTH_START_PATH,
  mcpClientMetadata,
  sameDigest,
  workspaceSignInTag,
} from "./mcp/oauth-support";
import { authenticateRelayRequest } from "./router-auth";
import { authorizeWorkspace } from "./workspace-authority";

const pluginsRoute =
  /^\/v1\/workspaces\/([^/]+)\/plugins(?:\/([^/]+)(?:\/(authorize|client|refresh|tools\/call))?)?$/u;
const bindingCookie = "__Host-chief-plugin-sign-in";
const pluginCallBodySchema = z.object({
  name: z.string().min(1).max(128),
  arguments: jsonObjectSchema.default({}),
});

function operationFor(
  method: string,
  id: string | undefined,
  action: string | undefined,
) {
  if (!id)
    return method === "GET"
      ? "mcp-list"
      : method === "POST"
        ? "mcp-create"
        : undefined;
  if (!action) return method === "DELETE" ? "mcp-delete" : undefined;
  if (method !== "POST") return undefined;
  return action === "tools/call" ? "mcp-call" : `mcp-${action}`;
}

const automationToolsRoute = /^\/v1\/workspaces\/([^/]+)\/automation-tools$/u;

/** Signed-in requests from Chief and from agents, forwarded to the workspace. */
export function routeWorkspaceMcp(
  env: Env,
  request: Request,
  requestId: string,
) {
  return Effect.gen(function* () {
    const catalogue = automationToolsRoute.exec(new URL(request.url).pathname);
    if (catalogue && request.method === "GET") {
      const workspaceId = yield* sync("relay.automation_tools.scope", () =>
        workspaceIdSchema.parse(decodeURIComponent(catalogue[1] ?? "")),
      );
      const authenticated = yield* attempt("relay.authenticate", () =>
        authenticateRelayRequest(request, env),
      );
      yield* attempt("relay.workspace.authorize", () =>
        authorizeWorkspace(env, {
          identity: authenticated.identity,
          requestId,
          workspaceId,
        }),
      );
      return Response.json({
        tools: automationChiefTools().map(
          ({ name, title, description, inputSchema, readOnly }) => ({
            name,
            title,
            description,
            inputSchema,
            readOnly,
          }),
        ),
      });
    }
    const matched = pluginsRoute.exec(new URL(request.url).pathname);
    if (!matched) return undefined;
    const id = matched[2] ? decodeURIComponent(matched[2]) : undefined;
    const operation = operationFor(request.method, id, matched[3]);
    if (!operation)
      return relayError(
        405,
        "method_not_allowed",
        "Method not allowed.",
        requestId,
      );
    const workspaceId = yield* sync("relay.workspace_mcp.scope", () =>
      workspaceIdSchema.parse(decodeURIComponent(matched[1] ?? "")),
    );
    const authenticated = yield* attempt("relay.authenticate", () =>
      authenticateRelayRequest(request, env),
    );
    const principal = yield* attempt("relay.workspace.authorize", () =>
      authorizeWorkspace(env, {
        identity: authenticated.identity,
        requestId,
        workspaceId,
      }),
    );
    const body =
      operation === "mcp-call"
        ? JSON.stringify({
            ...pluginCallBodySchema.parse(
              yield* attempt("relay.workspace_mcp.body", () =>
                authenticated.request.json(),
              ),
            ),
            connectionId: id,
            // Only automations may claim a pinned read; callers cannot.
            requireReadOnly: false,
          })
        : request.method === "POST"
          ? yield* attempt("relay.workspace_mcp.body", () =>
              authenticated.request.text(),
            )
          : "{}";
    const headers = new Headers({
      "content-type": "application/json",
      "x-chief-internal-operation": operation,
      ...(id ? { "x-chief-plugin-id": id } : undefined),
    });
    return yield* attempt("relay.workspace_mcp.forward", () =>
      env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
        withTrustedContext(
          new Request("https://workspace.internal/plugins", {
            method: "POST",
            headers,
            body,
          }),
          { principal, requestId, workspaceId },
        ),
      ),
    );
  }).pipe(Effect.withSpan("relay.workspace_mcp"));
}

const PLUG_MARK = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 7V3m6 4V3M6 7h12v4a6 6 0 0 1-12 0V7Zm6 10v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** The plugin's own logo, falling back to a plug if it has none. */
function serviceMark(logoDomain: string | undefined) {
  if (!logoDomain || !/^[a-z0-9.-]+$/iu.test(logoDomain)) return PLUG_MARK;
  return `${PLUG_MARK}<img src="https://integrations.sh/logo/${escapeHtml(logoDomain)}" alt="" onerror="this.remove()" />`;
}

function resultPage(
  title: string,
  detail: string,
  status = 200,
  logoDomain?: string,
) {
  return htmlPage(
    connectionDocument(
      title,
      `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p>`,
      status < 400,
      serviceMark(logoDomain),
    ),
    status,
  );
}

async function forwardBrowserLeg<T>(
  env: Env,
  workspaceId: WorkspaceId,
  requestId: string,
  operation: string,
  body: JsonObject,
  schema: z.ZodType<T>,
) {
  const response = await env.WORKSPACES.get(
    env.WORKSPACES.idFromName(workspaceId),
  ).fetch(
    // A fresh request: nothing the browser sent is forwarded except `body`.
    withTrustedContext(
      new Request("https://workspace.internal/plugins/sign-in", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chief-internal-operation": operation,
        },
        body: JSON.stringify(body),
      }),
      {
        principal: { kind: "service", service: "mcp-oauth", workspaceId },
        requestId,
        workspaceId,
      },
    ),
  );
  const result: unknown = await response.json();
  if (!response.ok) {
    const failure = relayErrorSchema.safeParse(result);
    throw new HttpError(
      response.status,
      "plugin_sign_in_failed",
      failure.success
        ? failure.data.error.message
        : "The plugin didn't connect.",
    );
  }
  return schema.parse(result);
}

function cookieValue(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

const startQuerySchema = z.object({
  w: workspaceIdSchema,
  k: z.string().regex(/^[0-9a-f]{32}$/u),
  t: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
});

/** Refuses ids the relay never handed out, before any workspace is touched. */
async function requireSignInTag(env: Env, workspaceId: string, tag: string) {
  if (!sameDigest(await workspaceSignInTag(env, workspaceId), tag))
    throw new HttpError(
      404,
      "plugin_sign_in_unknown",
      "This sign-in link isn't valid. Start again from Chief.",
    );
}

/**
 * The browser legs of connecting a plugin. They carry no Chief session: a
 * one-time start token opens a confirmation page, confirming binds the
 * sign-in to this browser with a cookie, and the callback must come back to
 * the same browser.
 */
export async function routeMcpBrowser(
  request: Request,
  url: URL,
  env: Env,
  requestId: string,
): Promise<Response | undefined> {
  if (
    url.pathname === MCP_OAUTH_CLIENT_METADATA_PATH &&
    request.method === "GET"
  )
    return Response.json(mcpClientMetadata(env), {
      headers: { "cache-control": "public, max-age=3600" },
    });
  if (
    url.pathname !== MCP_OAUTH_START_PATH &&
    url.pathname !== MCP_OAUTH_CALLBACK_PATH
  )
    return undefined;
  try {
    if (url.pathname === MCP_OAUTH_START_PATH && request.method === "GET") {
      const query = startQuerySchema.parse(
        Object.fromEntries(url.searchParams),
      );
      await requireSignInTag(env, query.w, query.k);
      const start = await forwardBrowserLeg(
        env,
        query.w,
        requestId,
        "mcp-oauth-describe",
        { startToken: query.t },
        z.object({
          pluginName: z.string(),
          domain: z.string(),
          logoDomain: z.string(),
          signInHost: z.string(),
          workspaceName: z.string(),
        }),
      );
      return htmlPage(
        connectionDocument(
          `Connect ${start.pluginName}`,
          `<h1>Connect ${escapeHtml(start.pluginName)}?</h1>
<p>You're giving the <strong>${escapeHtml(start.workspaceName)}</strong> workspace access to ${escapeHtml(start.domain)}. You'll sign in at ${escapeHtml(start.signInHost)}. Continue only if you started this from Chief just now.</p>
<form method="post" action="${MCP_OAUTH_START_PATH}">
<input type="hidden" name="w" value="${escapeHtml(query.w)}" />
<input type="hidden" name="k" value="${escapeHtml(query.k)}" />
<input type="hidden" name="t" value="${escapeHtml(query.t)}" />
<button type="submit">Continue to ${escapeHtml(start.signInHost)}</button>
</form>`,
          false,
          serviceMark(start.logoDomain),
        ),
      );
    }
    if (url.pathname === MCP_OAUTH_START_PATH && request.method === "POST") {
      // A page on another site cannot submit this form on someone's behalf.
      const site = request.headers.get("sec-fetch-site");
      const origin = request.headers.get("origin");
      if (site ? site !== "same-origin" : origin !== relayOrigin(env))
        throw new HttpError(
          403,
          "plugin_sign_in_origin",
          "Open the sign-in link from Chief again.",
        );
      const form = await request.formData();
      const query = startQuerySchema.parse({
        w: form.get("w"),
        k: form.get("k"),
        t: form.get("t"),
      });
      await requireSignInTag(env, query.w, query.k);
      const confirmed = await forwardBrowserLeg(
        env,
        query.w,
        requestId,
        "mcp-oauth-confirm",
        { startToken: query.t },
        z.object({ authorizationUrl: z.string().url(), binding: z.string() }),
      );
      return new Response(null, {
        status: 303,
        headers: {
          location: confirmed.authorizationUrl,
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
          "set-cookie": `${bindingCookie}=${confirmed.binding}; Max-Age=600; Path=/; Secure; HttpOnly; SameSite=Lax`,
        },
      });
    }
    if (url.pathname === MCP_OAUTH_CALLBACK_PATH && request.method === "GET") {
      const [rawWorkspace = "", tag = "", nonce = "", ...rest] = (
        url.searchParams.get("state") ?? ""
      ).split("~");
      if (rest.length)
        throw new HttpError(
          400,
          "plugin_sign_in_invalid",
          "This sign-in link isn't valid. Start again from Chief.",
        );
      const workspaceId = workspaceIdSchema.parse(rawWorkspace);
      await requireSignInTag(env, workspaceId, tag);
      const connection = await forwardBrowserLeg(
        env,
        workspaceId,
        requestId,
        "mcp-oauth-callback",
        {
          nonce,
          binding: cookieValue(request, bindingCookie),
          code: url.searchParams.get("code"),
          error: url.searchParams.get("error"),
          issuer: url.searchParams.get("iss"),
        },
        z.object({
          name: z.string(),
          status: z.string(),
          url: z.string(),
          domain: z.string().optional(),
        }),
      );
      const response = resultPage(
        connection.status === "connected"
          ? `${connection.name} is connected`
          : `${connection.name} needs attention`,
        connection.status === "connected"
          ? "You can close this window and return to Chief."
          : "It signed in, but Chief couldn't load its tools. Check it in Chief.",
        200,
        connection.domain ?? new URL(connection.url).hostname,
      );
      response.headers.append(
        "set-cookie",
        `${bindingCookie}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`,
      );
      return response;
    }
    return new Response(null, { status: 405 });
  } catch (error) {
    const response = resultPage(
      "The plugin didn't connect",
      error instanceof HttpError
        ? error.message
        : "Something went wrong. Start again from Chief.",
      error instanceof HttpError ? error.status : 400,
    );
    if (url.pathname === MCP_OAUTH_CALLBACK_PATH)
      response.headers.append(
        "set-cookie",
        `${bindingCookie}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`,
      );
    return response;
  }
}
