import { Effect } from "effect";

import { workspaceIdSchema } from "@chief/relay-contracts";

import { attempt, sync } from "./effect";
import { relayError } from "./http";
import { withTrustedContext } from "./internal-context";
import { authenticateRelayRequest } from "./router-auth";
import { authorizeWorkspace } from "./workspace-authority";

const gitRoute =
  /^\/git\/([^/]+)\/([^/]+?)(?:\.git)?\/(info\/refs|git-upload-pack|git-receive-pack)$/u;

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
    const repo = decodeURIComponent(matched[2] ?? "").replace(/\.git$/u, "");
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
    headers.set("x-chief-git-repo", repo);
    if (operation === "git-info-refs") {
      const service = url.searchParams.get("service")?.trim();
      if (service) headers.set("x-chief-git-service", service);
    }
    const forwarded = new Request(authenticated.request, { headers });
    return yield* attempt("relay.git.forward", () =>
      env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
        withTrustedContext(forwarded, {
          principal,
          requestId,
          workspaceId,
          conversationId: undefined,
        }),
      ),
    );
  }).pipe(Effect.withSpan("relay.git"));
}
