import { describe, expect, it } from 'vitest';
import {
  ApiError,
  OFFLINE_MESSAGE,
  apiErrorFrom,
  failureMessage,
  isConflict,
  isNotFound,
  supportReference,
} from './api-error.js';

describe('apiErrorFrom', () => {
  it('keeps the code and body correlation ID from a valid error body', () => {
    const error = apiErrorFrom(
      409,
      { code: 'CONFLICT', message: 'Stale.', correlationId: 'corr-1' },
      'header-corr',
    );
    expect(error).toMatchObject({ status: 409, code: 'CONFLICT', correlationId: 'corr-1' });
  });

  it('falls back to the header correlation ID and ignores malformed bodies', () => {
    const error = apiErrorFrom(503, 'not json', 'header-corr');
    expect(error).toMatchObject({ status: 503, code: undefined, correlationId: 'header-corr' });
    expect(apiErrorFrom(500, {}, null).correlationId).toBeUndefined();
  });
});

describe('failureMessage', () => {
  const fallback = 'No pudimos guardar el cambio. Tu texto sigue aquí.';

  it('never exposes the English server message', () => {
    const error = apiErrorFrom(503, { code: 'X', message: 'Card service down.' }, null);
    expect(failureMessage(error, fallback)).toBe(fallback);
  });

  it('describes offline, missing, conflicting, and invalid requests in Spanish', () => {
    expect(failureMessage(new ApiError(0, 'NETWORK'), fallback)).toBe(OFFLINE_MESSAGE);
    expect(failureMessage(new ApiError(404), fallback)).toContain('ya no está disponible');
    expect(failureMessage(new ApiError(409), fallback)).toContain('cambió');
    expect(failureMessage(new ApiError(400), fallback)).toContain('Revisa');
  });

  it('uses the fallback for unknown errors', () => {
    expect(failureMessage(new Error('boom'), fallback)).toBe(fallback);
  });
});

describe('error predicates', () => {
  it('recognises references, missing resources, and conflicts', () => {
    expect(supportReference(new ApiError(500, 'X', 'corr-2'))).toBe('corr-2');
    expect(supportReference(new Error('x'))).toBeUndefined();
    expect(isNotFound(new ApiError(404))).toBe(true);
    expect(isNotFound(new ApiError(409))).toBe(false);
    expect(isConflict(new ApiError(409))).toBe(true);
    expect(isConflict('409')).toBe(false);
  });
});
