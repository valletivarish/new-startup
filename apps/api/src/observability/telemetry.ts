/**
 * OpenTelemetry initialisation (Phase 1 boundary: "OpenTelemetry initialised").
 *
 * Vendor-neutral by design (ADR-001): the SDK is wired here and the backend is
 * chosen by OTEL_EXPORTER_OTLP_ENDPOINT, so no observability vendor is
 * embedded. Disabled by default — enabling it must be a deliberate act, and a
 * failure to reach a collector must never take the process down.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import type { Logger } from 'pino';

import type { Env } from '../config.js';

export interface Telemetry {
  shutdown(): Promise<void>;
}

export function startTelemetry(env: Env, logger: Logger): Telemetry {
  if (!env.OTEL_ENABLED) {
    logger.debug('telemetry.disabled');
    return { async shutdown() {} };
  }

  const sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME,
    traceExporter: new OTLPTraceExporter(),
  });

  try {
    sdk.start();
    logger.info({ service: env.OTEL_SERVICE_NAME }, 'telemetry.started');
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'telemetry.start_failed');
    return { async shutdown() {} };
  }

  return {
    async shutdown() {
      try {
        await sdk.shutdown();
      } catch (error) {
        logger.error({ err: (error as Error).message }, 'telemetry.shutdown_failed');
      }
    },
  };
}
