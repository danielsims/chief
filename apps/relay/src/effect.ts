import {
  Clock,
  Context,
  Effect,
  Exit,
  Layer,
  Logger,
  ManagedRuntime,
  Option,
  Schema,
  Tracer,
} from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  OtlpExporter,
  OtlpLogger,
  OtlpSerialization,
  OtlpTracer,
} from "effect/unstable/observability";

import type { JsonObject, JsonValue } from "@chief/relay-contracts";
import { parseJsonObject } from "@chief/relay-contracts";

import { AuthenticationError, AuthorizationError } from "./auth";
import { HttpError, relayError } from "./http";
import { relayCapacityResponse } from "./relay-capacity";

export class RelayFailure extends Schema.TaggedError<RelayFailure>()(
  "RelayFailure",
  {
    status: Schema.Number,
    code: Schema.String,
    message: Schema.String,
    requestId: Schema.optional(Schema.String),
    details: Schema.optional(Schema.Unknown),
    cause: Schema.optional(Schema.Unknown),
  },
) {}

const TelemetryMode = Schema.Literals(["off", "errors", "full"]);
type TelemetryMode = typeof TelemetryMode.Type;

interface RelayRuntime {
  run<A>(effect: Effect.Effect<A, RelayFailure>): Promise<A>;
}

export interface AsyncTracer {
  run<A>(
    name: string,
    attributes: TelemetryAttributes,
    execute: (span: AsyncSpan) => Promise<A>,
  ): Promise<A>;
}

export interface AsyncSpan {
  children: AsyncTracer;
  annotate(key: string, value: JsonValue): void;
}

type TelemetryAttributes = Readonly<Record<string, JsonValue | undefined>>;

const runtimes = new Map<string, RelayRuntime>();

const errorConsoleLogger = Logger.make<unknown, void>((options) => {
  if (options.logLevel === "Error" || options.logLevel === "Fatal") {
    console.error(Logger.formatJson.log(options));
  }
});

const errorConsoleLayer = Logger.layer([errorConsoleLogger]);

export function attempt<A>(operation: string, run: () => A | PromiseLike<A>) {
  return Effect.tryPromise({
    try: async () => await run(),
    catch: (cause) => parseRelayFailure(cause),
  }).pipe(Effect.withSpan(operation));
}

export function sync<A>(operation: string, run: () => A) {
  return Effect.try({
    try: run,
    catch: (cause) => parseRelayFailure(cause),
  }).pipe(Effect.withSpan(operation));
}

export const asyncTracer = Effect.gen(function* () {
  const tracer = yield* Effect.tracer;
  const parent = yield* Effect.currentSpan;
  const clock = yield* Clock.Clock;
  return makeAsyncTracer(tracer, parent, clock);
});

export function runEffect<A>(
  effect: Effect.Effect<A, RelayFailure>,
  env: Env,
  workflowId?: string,
): Promise<A> {
  const parent = workflowId ? workflowTraceParent(workflowId) : undefined;
  return runtimeFor(env).run(
    parent ? Effect.withParentSpan(effect, parent) : effect,
  );
}

export function runResponse(
  effect: Effect.Effect<Response, RelayFailure>,
  env: Env,
  input: {
    operation: string;
    requestId?: string;
    attributes?: TelemetryAttributes;
    workflowId?: string;
  },
) {
  return runEffect(
    effect.pipe(
      Effect.withSpan(input.operation, {
        attributes: {
          ...input.attributes,
          "chief.workflow.id": input.workflowId,
        },
      }),
      Effect.mapError((failure) => parseRelayFailure(failure, input.requestId)),
      Effect.tapError((failure) =>
        Effect.logError("relay.operation.failed", {
          operation: input.operation,
          requestId: input.requestId,
          code: failure.code,
          message: failure.message,
        }),
      ),
      Effect.matchEffect({
        onFailure: (failure) => Effect.succeed(failureResponse(failure)),
        onSuccess: Effect.succeed,
      }),
    ),
    env,
    input.workflowId,
  );
}

export function workflowTraceParent(workflowId: string) {
  const traceId = workflowId.replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/u.test(traceId) || /^0+$/u.test(traceId)) {
    return undefined;
  }
  return Tracer.externalSpan({
    traceId,
    spanId: traceId.slice(16),
    sampled: true,
  });
}

export function telemetryMode(env: Env): TelemetryMode {
  return Schema.decodeUnknownSync(TelemetryMode)(env.RELAY_TELEMETRY_MODE);
}

export function telemetryIncludesContent(env: Env) {
  return (
    telemetryMode(env) === "full" &&
    env.RELAY_TELEMETRY_INCLUDE_CONTENT === "true"
  );
}

export function parseRelayFailure(
  cause: unknown,
  requestId?: string,
): RelayFailure {
  if (cause instanceof RelayFailure) {
    return requestId && cause.requestId === undefined
      ? new RelayFailure({
          status: cause.status,
          code: cause.code,
          message: cause.message,
          requestId,
          ...(cause.details === undefined
            ? undefined
            : { details: cause.details }),
          ...(cause.cause === undefined ? undefined : { cause: cause.cause }),
        })
      : cause;
  }
  if (cause instanceof AuthenticationError) {
    return new RelayFailure({
      status: 401,
      code: "unauthenticated",
      message: cause.message,
      ...(requestId ? { requestId } : undefined),
    });
  }
  if (cause instanceof AuthorizationError) {
    return new RelayFailure({
      status: 403,
      code: "forbidden",
      message: cause.message,
      ...(requestId ? { requestId } : undefined),
    });
  }
  if (cause instanceof HttpError) {
    return new RelayFailure({
      status: cause.status,
      code: cause.code,
      message: cause.message,
      ...(requestId ? { requestId } : undefined),
      ...(cause.details ? { details: cause.details } : undefined),
    });
  }
  return new RelayFailure({
    status: 400,
    code: "invalid_request",
    message: "The relay request is invalid.",
    ...(requestId ? { requestId } : undefined),
    cause,
  });
}

export function failureResponse(failure: RelayFailure) {
  const capacity = relayCapacityResponse(
    failure.cause instanceof Error ? failure.cause : undefined,
    failure.requestId,
  );
  if (capacity) return capacity;
  return relayError(
    failure.status,
    failure.code,
    failure.message,
    failure.requestId,
    parseJsonDetails(failure.details),
  );
}

function runtimeFor(env: Env): RelayRuntime {
  const mode = telemetryMode(env);
  const endpoint = mode === "full" ? otlpEndpoint(env) : undefined;
  const key = [
    mode,
    endpoint ?? "",
    env.RELAY_OTLP_AUTHORIZATION ? "authorized" : "anonymous",
    env.RELAY_DEPLOYMENT,
  ].join("\u0000");
  const existing = runtimes.get(key);
  if (existing) return existing;

  const runtime =
    mode === "full"
      ? fullTelemetryRuntime(env, endpoint ?? otlpEndpoint(env))
      : basicRuntime(mode);
  runtimes.set(key, runtime);
  return runtime;
}

function basicRuntime(mode: Exclude<TelemetryMode, "full">): RelayRuntime {
  const layer = mode === "errors" ? errorConsoleLayer : Logger.layer([]);
  const runtime = ManagedRuntime.make(layer);
  return {
    run: (effect) => runtime.runPromise(effect),
  };
}

function fullTelemetryRuntime(env: Env, endpoint: string): RelayRuntime {
  const headers = env.RELAY_OTLP_AUTHORIZATION
    ? { authorization: env.RELAY_OTLP_AUTHORIZATION }
    : undefined;
  const resource = {
    serviceName: "chief-relay",
    attributes: {
      "deployment.environment": env.RELAY_DEPLOYMENT,
    },
  };
  const telemetry = Layer.merge(
    OtlpTracer.layer({
      url: `${endpoint}/v1/traces`,
      headers,
      resource,
      exportInterval: "500 millis",
    }),
    OtlpLogger.layer({
      url: `${endpoint}/v1/logs`,
      headers,
      resource,
      exportInterval: "500 millis",
      mergeWithExisting: true,
    }),
  ).pipe(
    Layer.provide(OtlpSerialization.layerJson),
    Layer.provide(FetchHttpClient.layer),
  );
  const runtime = ManagedRuntime.make(
    Layer.merge(errorConsoleLayer, telemetry),
  );
  return {
    run: (effect) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const flusher = yield* OtlpExporter.Flusher;
          return yield* effect.pipe(
            Effect.ensuring(
              flusher.flush.pipe(Effect.timeoutOption("2 seconds")),
            ),
          );
        }),
      ),
  };
}

function otlpEndpoint(env: Env) {
  const raw = env.RELAY_OTLP_ENDPOINT?.trim();
  if (!raw) {
    throw new Error(
      "RELAY_OTLP_ENDPOINT is required when RELAY_TELEMETRY_MODE is full.",
    );
  }
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("RELAY_OTLP_ENDPOINT must use http or https.");
  }
  return url.toString().replace(/\/$/u, "");
}

function makeAsyncTracer(
  tracer: Tracer.Tracer,
  parent: Tracer.AnySpan,
  clock: Clock.Clock,
): AsyncTracer {
  return {
    run(name, attributes, execute) {
      const span = tracer.span({
        name,
        parent: Option.some(parent),
        annotations: Context.empty(),
        links: [],
        startTime: clock.currentTimeNanosUnsafe(),
        kind: "internal",
        root: false,
        sampled: parent.sampled,
      });
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== undefined) span.attribute(key, value);
      }
      return execute({
        children: makeAsyncTracer(tracer, span, clock),
        annotate: (key, value) => span.attribute(key, value),
      }).then(
        (value) => {
          span.end(clock.currentTimeNanosUnsafe(), Exit.succeed(value));
          return value;
        },
        (cause) => {
          span.end(clock.currentTimeNanosUnsafe(), Exit.fail(cause));
          throw cause;
        },
      );
    },
  };
}

function parseJsonDetails<Input>(value: Input): JsonObject | undefined {
  try {
    const serialized = JSON.stringify(value);
    return parseJsonObject(JSON.parse(serialized));
  } catch {
    return undefined;
  }
}
