import { Effect } from "effect";

import { workspaceIdSchema } from "@chief/relay-contracts";

import { attempt, sync } from "./effect";
import { withTrustedContext } from "./internal-context";
import { authenticateRelayRequest } from "./router-auth";
import { authorizeWorkspace } from "./workspace-authority";

const brandProfileRoute = /^\/v1\/workspaces\/([^/]+)\/data\/brand-profile$/u;
const prospectsRoute = /^\/v1\/workspaces\/([^/]+)\/data\/prospects$/u;
const filesRoute = /^\/v1\/workspaces\/([^/]+)\/files$/u;
const fileRoute = /^\/v1\/workspaces\/([^/]+)\/files\/([^/]+)$/u;
const projectsRoute = /^\/v1\/workspaces\/([^/]+)\/projects$/u;
const projectRoute = /^\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)$/u;

export function routeWorkspaceDataRequest(
  env: Env,
  request: Request,
  requestId: string,
  url: URL,
) {
  return Effect.gen(function* () {
    const brand = brandProfileRoute.exec(url.pathname);
    const prospects = prospectsRoute.exec(url.pathname);
    const files = filesRoute.exec(url.pathname);
    const file = fileRoute.exec(url.pathname);
    const projects = projectsRoute.exec(url.pathname);
    const project = projectRoute.exec(url.pathname);
    let rawWorkspaceId: string | undefined;
    let operation: string | undefined;
    if (brand && ["GET", "PUT"].includes(request.method)) {
      rawWorkspaceId = brand[1];
      operation =
        request.method === "GET" ? "data-brand-get" : "data-brand-save";
    } else if (prospects && ["GET", "POST"].includes(request.method)) {
      rawWorkspaceId = prospects[1];
      operation =
        request.method === "GET" ? "data-prospects-list" : "data-prospect-save";
    } else if (files && ["GET", "POST"].includes(request.method)) {
      rawWorkspaceId = files[1];
      operation =
        request.method === "GET" ? "data-files-list" : "data-file-save";
    } else if (file && request.method === "PUT") {
      rawWorkspaceId = file[1];
      operation = "data-file-update";
    } else if (projects && ["GET", "POST"].includes(request.method)) {
      rawWorkspaceId = projects[1];
      operation =
        request.method === "GET" ? "data-projects-list" : "data-project-create";
    } else if (project && request.method === "DELETE") {
      rawWorkspaceId = project[1];
      operation = "data-project-delete";
    }
    if (!operation) return undefined;
    const workspaceId = yield* sync("relay.workspace_data.scope", () =>
      workspaceIdSchema.parse(decodeURIComponent(rawWorkspaceId ?? "")),
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
      request.method === "GET"
        ? undefined
        : yield* attempt("relay.request.body", () =>
            authenticated.request.text(),
          );
    const workspace = env.WORKSPACES.get(
      env.WORKSPACES.idFromName(workspaceId),
    );
    return yield* attempt("relay.workspace_data.forward", () =>
      workspace.fetch(
        withTrustedContext(
          new Request("https://workspace.internal", {
            method: "POST",
            headers: {
              "x-chief-internal-operation": operation,
              ...(file?.[2]
                ? { "x-chief-workspace-file-id": decodeURIComponent(file[2]) }
                : undefined),
              ...(project?.[2]
                ? { "x-chief-project-id": decodeURIComponent(project[2]) }
                : undefined),
              ...(body ? { "content-type": "application/json" } : undefined),
            },
            body,
          }),
          { principal, requestId, workspaceId },
        ),
      ),
    );
  }).pipe(Effect.withSpan("relay.workspace_data"));
}
