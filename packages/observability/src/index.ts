export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type SafeLogContext = Readonly<Record<string, string | number | boolean | null | undefined>>;

const safeContextKeys = new Set([
  'batchId',
  'correlationId',
  'deliveryId',
  'duplicate',
  'failureCode',
  'itemCount',
  'latencyMs',
  'messageId',
  'operation',
  'reason',
  'service',
  'stage',
  'status',
  'statusCode',
  'subjectId',
  'traceId',
]);

const sanitize = (context: SafeLogContext): SafeLogContext =>
  Object.fromEntries(
    Object.entries(context).filter(
      ([key, value]) =>
        safeContextKeys.has(key) &&
        (value === undefined ||
          value === null ||
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean'),
    ),
  );

export interface Logger {
  log(level: LogLevel, message: string, context?: SafeLogContext): void;
}

export const createJsonLogger = (sink: (record: string) => void = console.log): Logger => ({
  log(level, message, context = {}) {
    sink(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        ...sanitize(context),
      }),
    );
  },
});

export type MetricUnit = 'Count' | 'Milliseconds' | 'Bytes';

export interface Metrics {
  put(name: string, value: number, unit?: MetricUnit): void;
}

const environment = (): Readonly<Record<string, string | undefined>> =>
  (
    globalThis as typeof globalThis & {
      process?: { readonly env?: Readonly<Record<string, string | undefined>> };
    }
  ).process?.env ?? {};

/**
 * Emits CloudWatch Embedded Metric Format without importing an AWS SDK. Dimensions are fixed and
 * low-cardinality; callers can only provide the metric name and numeric value.
 */
export const createMetrics = (
  service: string,
  stage = environment()['STAGE'] ?? 'unknown',
  sink: (record: string) => void = console.log,
): Metrics => ({
  put(name, value, unit = 'Count') {
    if (!/^[A-Z][A-Za-z0-9]{0,63}$/.test(name) || !Number.isFinite(value)) {
      throw new Error('Invalid metric.');
    }
    sink(
      JSON.stringify({
        _aws: {
          Timestamp: Date.now(),
          CloudWatchMetrics: [
            {
              Namespace: 'RelationshipRag',
              Dimensions: [['Stage', 'Service']],
              Metrics: [{ Name: name, Unit: unit }],
            },
          ],
        },
        Stage: stage,
        Service: service,
        [name]: value,
      }),
    );
  },
});

export const currentTraceId = (): string | undefined =>
  environment()['_X_AMZN_TRACE_ID']?.match(/(?:^|;)Root=([^;]+)/)?.[1];
