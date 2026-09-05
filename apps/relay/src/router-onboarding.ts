import { Effect } from "effect";

import {
  onboardingTelemetryEventSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { attempt, sync } from "./effect";
import { json, parseJson, relayError } from "./http";
import { withTrustedContext } from "./internal-context";
import { authenticateRelayRequest, requireAccountBinding } from "./router-auth";
import { authorizeWorkspace } from "./workspace-authority";

const workspaceOnboardingStartRoute =
  /^\/v1\/workspaces\/([^/]+)\/onboarding\/start$/u;

export function routeOnboardingTelemetry(
  env: Env,
  request: Request,
  requestId: string,
) {
  return Effect.gen(function* () {
    const url = new URL(request.url);
    const start = workspaceOnboardingStartRoute.exec(url.pathname);
    if (start) {
      if (request.method !== "POST") {
        return relayError(
          405,
          "method_not_allowed",
          "Method not allowed.",
          requestId,
        );
      }
      const workspaceId = yield* sync("relay.onboarding.start.scope", () =>
        workspaceIdSchema.parse(decodeURIComponent(start[1] ?? "")),
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
      headers.set("x-chief-internal-operation", "start-eve-onboarding");
      return yield* attempt("relay.onboarding.start.forward", () =>
        env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
          withTrustedContext(new Request(authenticated.request, { headers }), {
            principal,
            requestId,
            workspaceId,
          }),
        ),
      );
    }
    if (url.pathname !== "/v1/onboarding/events" || request.method !== "POST") {
      return null;
    }
    const authenticated = yield* attempt("relay.authenticate", () =>
      authenticateRelayRequest(request, env),
    );
    yield* sync("relay.account_binding.require", () =>
      requireAccountBinding(env, authenticated.bound),
    );
    const event = yield* attempt("relay.onboarding.parse", () =>
      parseJson(authenticated.request),
    ).pipe(
      Effect.flatMap((value) =>
        sync("relay.onboarding.validate", () =>
          onboardingTelemetryEventSchema.parse(value),
        ),
      ),
    );
    const attributes = {
      "chief.request.id": requestId,
      "chief.onboarding.session.id": event.sessionId,
      "chief.onboarding.stage": event.stage,
      "chief.onboarding.event": event.event,
      "chief.onboarding.agent_runtime": event.agentRuntime,
      "chief.onboarding.provider": event.provider,
      "chief.onboarding.selected_app_count": event.selectedAppCount,
      "chief.onboarding.error.code": event.errorCode,
      "chief.workspace.id": event.workspaceId,
    };
    yield* Effect.annotateCurrentSpan(attributes);
    yield* Effect.logInfo({ event: "onboarding.event", ...attributes });
    return json({ accepted: true });
  }).pipe(Effect.withSpan("chief.onboarding"));
}
