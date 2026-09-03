import { Effect } from "effect";

import { onboardingTelemetryEventSchema } from "@chief/relay-contracts";

import { attempt, sync } from "./effect";
import { json, parseJson } from "./http";
import { authenticateRelayRequest, requireAccountBinding } from "./router-auth";

export function routeOnboardingTelemetry(
  env: Env,
  request: Request,
  requestId: string,
) {
  return Effect.gen(function* () {
    const url = new URL(request.url);
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
