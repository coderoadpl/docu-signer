import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

/**
 * Composition-root wiring for server tracing. Registers a Node tracer provider
 * (W3C propagator + async-hooks context manager + OTLP exporter) ONLY when an
 * OTLP endpoint is configured. Without it the `@opentelemetry/api` facade stays
 * a no-op: no provider, no exporter, no network. The vendor (Sentry via its
 * OTLP ingest, Axiom, self-hosted ClickHouse) is exporter config here, never a
 * code change — which is why the request path talks only to the facade.
 *
 * Returns a force-flush hook so serverless targets can drain the batch before
 * the function freezes, without tearing the provider down between invocations.
 */
export const startServerObservability = (): (() => Promise<void>) | undefined => {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT && !process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
    return undefined;
  }

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'agentproofarch-server',
      [ATTR_SERVICE_VERSION]: '0.1.0',
    }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  });
  provider.register();

  return () => provider.forceFlush();
};
