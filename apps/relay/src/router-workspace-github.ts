import { Effect } from "effect";
import { z } from "zod";

import type { UserPrincipal } from "@chief/relay-contracts";
import { relayErrorSchema, workspaceIdSchema } from "@chief/relay-contracts";

import type { GitHubAppCredentials } from "./github-app";
import { attempt, sync } from "./effect";
import { GitHubApi } from "./github-app";
import { githubPage, githubSetupPage } from "./github-pages";
import { verifyGitHubTicket } from "./github-tickets";
import { HttpError, relayError } from "./http";
import { withTrustedContext } from "./internal-context";
import { authenticateRelayRequest } from "./router-auth";
import { authorizeWorkspace } from "./workspace-authority";
import { publicOrigin } from "./workspace-github-service";

const workspaceGitHubRoute =
  /^\/v1\/workspaces\/([^/]+)\/github(?:\/(setup|install|repositories|clone-token))?$/u;

const OPERATIONS = {
  GET: { "": "github-connection", repositories: "github-repositories" },
  POST: {
    setup: "github-setup",
    install: "github-install",
    "clone-token": "github-clone-token",
  },
} as const;

/** Signed-in requests from Chief, forwarded to the workspace. */
export function routeWorkspaceGitHub(
  env: Env,
  request: Request,
  requestId: string,
) {
  return Effect.gen(function* () {
    const matched = workspaceGitHubRoute.exec(new URL(request.url).pathname);
    if (!matched) return undefined;
    const operations: Partial<Record<string, string>> | undefined =
      request.method === "GET" || request.method === "POST"
        ? OPERATIONS[request.method]
        : undefined;
    const operation = operations?.[matched[2] ?? ""];
    if (!operation) {
      return relayError(
        405,
        "method_not_allowed",
        "Method not allowed.",
        requestId,
      );
    }
    const workspaceId = yield* sync("relay.workspace_github.scope", () =>
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
    const headers = new Headers(authenticated.request.headers);
    headers.set("x-chief-internal-operation", operation);
    return yield* attempt("relay.workspace_github.forward", () =>
      env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
        withTrustedContext(new Request(authenticated.request, { headers }), {
          principal,
          requestId,
          workspaceId,
        }),
      ),
    );
  }).pipe(Effect.withSpan("relay.workspace_github"));
}

/**
 * The browser legs of connecting GitHub. They carry no session; a signed
 * ticket names the workspace and the owner who started the flow.
 */
export async function routeGitHubBrowser(
  request: Request,
  url: URL,
  env: Env,
  requestId: string,
): Promise<Response | undefined> {
  if (request.method !== "GET") return undefined;
  try {
    if (url.pathname === "/github/setup") {
      const ticket = url.searchParams.get("ticket");
      const verified = await verifyGitHubTicket(
        env.RELAY_SECRET_KEY,
        ticket,
        "setup",
      );
      return githubSetupPage({
        name: verified.name,
        origin: publicOrigin(env, url.toString()),
        state: ticket ?? "",
      });
    }
    if (url.pathname === "/github/setup/callback") {
      const state = url.searchParams.get("state");
      const { principal } = await verifyGitHubTicket(
        env.RELAY_SECRET_KEY,
        state,
        "setup",
      );
      const app = await new GitHubApi().convertManifest(
        requiredParameter(url, "code"),
      );
      const { url: installUrl } = z
        .object({ url: z.string().url() })
        .parse(
          await forward(env, principal, requestId, "github-app-store", app),
        );
      return Response.redirect(installUrl, 302);
    }
    if (url.pathname === "/github/installed") {
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const installationId = Number(url.searchParams.get("installation_id"));
      // Changes made from GitHub's own settings arrive without Chief's state;
      // there is nothing to link, so just point the person back to Chief.
      if (!state || !code || !Number.isInteger(installationId)) {
        return githubPage({ title: "GitHub updated" });
      }
      const { principal } = await verifyGitHubTicket(
        env.RELAY_SECRET_KEY,
        state,
        "install",
      );
      await forward(env, principal, requestId, "github-installation-add", {
        installationId,
        code,
      });
      return githubPage({ title: "GitHub connected" });
    }
  } catch (error) {
    return githubPage({
      title: "GitHub didn't connect",
      detail:
        error instanceof HttpError
          ? error.message
          : "Something went wrong. Start again from Chief.",
      status: error instanceof HttpError ? error.status : 500,
    });
  }
  return undefined;
}

async function forward(
  env: Env,
  principal: UserPrincipal,
  requestId: string,
  operation: string,
  body: GitHubAppCredentials | { installationId: number; code: string },
) {
  const response = await env.WORKSPACES.get(
    env.WORKSPACES.idFromName(principal.workspaceId),
  ).fetch(
    withTrustedContext(
      new Request("https://workspace.internal/github", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chief-internal-operation": operation,
        },
        body: JSON.stringify(body),
      }),
      { principal, requestId, workspaceId: principal.workspaceId },
    ),
  );
  const result: unknown = await response.json();
  if (!response.ok) {
    const failure = relayErrorSchema.safeParse(result);
    throw new HttpError(
      response.status,
      "github_connect_failed",
      failure.success ? failure.data.error.message : "GitHub didn't connect.",
    );
  }
  return result;
}

function requiredParameter(url: URL, name: string) {
  const value = url.searchParams.get(name);
  if (!value) {
    throw new HttpError(
      400,
      "github_callback_invalid",
      "GitHub didn't send everything Chief needs. Start again from Chief.",
    );
  }
  return value;
}
