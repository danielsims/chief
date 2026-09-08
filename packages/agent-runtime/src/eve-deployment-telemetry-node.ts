import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

let telemetrySdk: NodeSDK | undefined;

export function initializeEveDeploymentTelemetry() {
  if (telemetrySdk) return;
  const configured =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!configured) return;
  const url = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
    ? configured
    : `${configured.replace(/\/$/u, "")}/v1/traces`;
  telemetrySdk = new NodeSDK({
    autoDetectResources: false,
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "chief-agent-runtime",
      [ATTR_SERVICE_VERSION]: "0.1.0",
    }),
    traceExporter: new OTLPTraceExporter({ url }),
  });
  telemetrySdk.start();
}

export async function shutdownEveDeploymentTelemetry() {
  await telemetrySdk?.shutdown();
  telemetrySdk = undefined;
}
