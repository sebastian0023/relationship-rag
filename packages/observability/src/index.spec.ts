import { describe, expect, it } from 'vitest';
import { createJsonLogger, createMetrics } from './index.js';

describe('privacy-safe telemetry', () => {
  it('keeps allowlisted diagnostics and drops private or unknown context', () => {
    const output: string[] = [];
    createJsonLogger((record) => output.push(record)).log('error', 'chat.request.completed', {
      correlationId: 'request-1',
      statusCode: 503,
      prompt: 'private prompt',
      memory: 'private memory',
      token: 'secret-token',
    });

    expect(output).toHaveLength(1);
    const parsed = JSON.parse(output[0]!) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      level: 'error',
      message: 'chat.request.completed',
      correlationId: 'request-1',
      statusCode: 503,
    });
    expect(output[0]).not.toContain('private prompt');
    expect(output[0]).not.toContain('private memory');
    expect(output[0]).not.toContain('secret-token');
  });

  it('emits bounded Embedded Metric Format dimensions', () => {
    const output: string[] = [];
    createMetrics('chat', 'test', (record) => output.push(record)).put('DependencyFailure', 1);

    const parsed = JSON.parse(output[0]!) as Record<string, unknown>;
    expect(parsed).toMatchObject({ Stage: 'test', Service: 'chat', DependencyFailure: 1 });
    expect(output[0]).not.toContain('coupleId');
    expect(output[0]).not.toContain('userId');
  });

  it('rejects arbitrary metric names and non-finite values', () => {
    const metrics = createMetrics('chat', 'test', () => undefined);
    expect(() => metrics.put('bad metric', 1)).toThrow('Invalid metric.');
    expect(() => metrics.put('ValidMetric', Number.NaN)).toThrow('Invalid metric.');
  });
});
