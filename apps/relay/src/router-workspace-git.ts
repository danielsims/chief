import { Effect } from "effect";

import type { Principal } from "@chief/relay-contracts";
import { workspaceIdSchema } from "@chief/relay-contracts";

import { attempt, sync } from "./effect";
import { relayError } from "./http";
import { withTrustedContext } from "./internal-context";
import { authenticateRelayRequest } from "./router-auth";
import { authorizeWorkspace } from "./workspace-authority";
import { verifyWorkspaceGitToken } from "./workspace-git-token";

const gitRoute =
  /^\/git\/([^/]+)\/([^/]+?)(?:\.git)?\/(info\/refs|git-upload-pack|git-receive-pack)$/u;

function normalizeRepo(repo: string) {
  return repo
    .replace(/\.git$/u, "")
    .trim()
    .toLowerCase();
}

function bearerToken(header: string | null) {
  const match = /^Bearer\s+(.+)$/iu.exec(header?.trim() ?? "");
  const value = match?.[1]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

export function routeWorkspaceGit(
  env: Env,
  request: Request,
  requestId: string,
) {
  return Effect.gen(function* () {
    const url = new URL(request.url);
    const matched = gitRoute.exec(url.pathname);
    if (!matched) return undefined;
    const workspaceId = yield* sync("relay.git.scope", () =>
      workspaceIdSchema.parse(decodeURIComponent(matched[1] ?? "")),
    );
    const repo = normalizeRepo(decodeURIComponent(matched[2] ?? ""));
    const resource = matched[3];
    const operation =
      resource === "info/refs"
        ? "git-info-refs"
        : resource === "git-upload-pack"
          ? "git-upload-pack"
          : "git-receive-pack";
    const expectedMethod = operation === "git-info-refs" ? "GET" : "POST";
    if (request.method !== expectedMethod) {
      return relayError(
        405,
        "method_not_allowed",
        "Method not allowed.",
        requestId,
      );
    }
    // The bearer path skips authenticateRelayRequest, which is what normally
    // strips the relay's reserved headers, so strip them here for both paths.
    const headers = new Headers();
    request.headers.forEach((value, name) => {
      if (!name.startsWith("x-chief-")) headers.set(name, value);
    });
    headers.set("x-chief-internal-operation", operation);
    headers.set("x-chief-git-repo", repo);
    if (operation === "git-info-refs") {
      const service = url.searchParams.get("service")?.trim();
      if (service) headers.set("x-chief-git-service", service);
    }
    const forward = (principal: Principal, source: Request) =>
      env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
        withTrustedContext(new Request(source, { headers }), {
          principal,
          requestId,
          workspaceId,
        }),
      );

    // A hosted agent cannot produce NIP-98 signatures per Git request, so it
    // clones with a short-lived, workspace+repo+read-scoped bearer token. The
    // token is verified here and never trusted for anything beyond this repo.
    const bearer = bearerToken(request.headers.get("authorization"));
    if (bearer) {
      const token = yield* attempt("relay.git.token", () =>
        verifyWorkspaceGitToken(env.RELAY_SECRET_KEY, bearer),
      );
      if (token.workspaceId !== workspaceId || token.repo !== repo) {
        return relayError(
          403,
          "git_token_scope_mismatch",
          "This repository credential does not grant access here.",
          requestId,
        );
      }
      const principal: Principal = {
        kind: "agent",
        agentId: token.agentId,
        pubkey: "0".repeat(64),
        workspaceId,
        role: "member",
      };
      return yield* attempt("relay.git.forward", () =>
        forward(principal, request),
      );
    }

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
    return yield* attempt("relay.git.forward", () =>
      forward(principal, authenticated.request),
    );
  }).pipe(Effect.withSpan("relay.git"));
}
