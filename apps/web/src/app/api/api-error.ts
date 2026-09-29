import { apiErrorSchema } from '@relationship-rag/contracts';

export const NETWORK_FAILURE = 'NETWORK';

/** A failed API call. Carries only safe diagnostics: status, code, and correlation ID. */
export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string | undefined = undefined,
    public readonly correlationId: string | undefined = undefined,
  ) {
    super(`API request failed with status ${status}.`);
    this.name = 'ApiError';
  }

  public get isNetworkFailure(): boolean {
    return this.code === NETWORK_FAILURE;
  }
}

/** Builds an `ApiError` from a non-OK response without trusting the response body. */
export const apiErrorFrom = (status: number, body: unknown, headerCorrelationId: string | null) => {
  const parsed = apiErrorSchema.safeParse(body);
  const correlationId = parsed.success ? parsed.data.correlationId : undefined;
  return new ApiError(
    status,
    parsed.success ? parsed.data.code : undefined,
    correlationId ?? headerCorrelationId ?? undefined,
  );
};

export const OFFLINE_MESSAGE =
  'Se interrumpió la conexión. Lo que escribiste sigue aquí; vuelve a intentarlo cuando regrese.';

/**
 * Spanish copy for a failure. The API's English messages are never shown; the fallback describes
 * what the person was doing, for example «No pudimos guardar el cambio. Tu texto sigue aquí.».
 */
export const failureMessage = (error: unknown, fallback: string): string => {
  if (!(error instanceof ApiError)) return fallback;
  if (error.isNetworkFailure) return OFFLINE_MESSAGE;
  if (error.status === 404) return 'Este contenido ya no está disponible.';
  if (error.status === 409) return 'Este contenido cambió mientras tanto. Vuelve a cargarlo.';
  if (error.status === 400) return 'Revisa los datos e inténtalo de nuevo.';
  return fallback;
};

/** The support reference shown as secondary text, when the server returned one. */
export const supportReference = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.correlationId : undefined;

export const isNotFound = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 404;

export const isConflict = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 409;
