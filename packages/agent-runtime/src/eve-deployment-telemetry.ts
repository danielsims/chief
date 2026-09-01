import type { Attributes, Span } from "@opentelemetry/api";
import { SpanStatusCode, trace } from "@opentelemetry/api";

export async function withEveDeploymentSpan<T>(
  name: string,
  attributes: Attributes,
  run: (span: Span) => Promise<T>,
): Promise<T> {
  return await trace
    .getTracer("chief.eve-deployment", "0.1.0")
    .startActiveSpan(name, { attributes }, async (span) => {
      const startedAt = performance.now();
      try {
        const result = await run(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        const caught =
          error instanceof Error ? error : new Error(String(error));
        recordEveDeploymentEvent(span, "failed", {
          "error.type": caught.name,
          "error.message": safeErrorMessage(caught),
        });
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: safeErrorMessage(caught),
        });
        span.recordException(caught);
        throw caught;
      } finally {
        span.setAttribute(
          "chief.eve.duration_ms",
          Math.round(performance.now() - startedAt),
        );
        span.end();
      }
    });
}

export function recordEveDeploymentEvent(
  span: Span,
  phase: string,
  attributes: Attributes = {},
) {
  const safeAttributes = sanitizeAttributes(attributes);
  span.addEvent(`chief.eve.${phase}`, safeAttributes);
  const context = span.spanContext();
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      scope: "chief.eve.deployment",
      phase,
      traceId: context.traceId,
      spanId: context.spanId,
      ...safeAttributes,
    }),
  );
}

function safeErrorMessage(error: Error) {
  return error.message.slice(0, 500);
}

function sanitizeAttributes(attributes: Attributes): Attributes {
  return Object.fromEntries(
    Object.entries(attributes).filter(
      ([key, value]) =>
        !/(token|secret|authorization|environment)/iu.test(key) &&
        value !== undefined,
    ),
  );
}
