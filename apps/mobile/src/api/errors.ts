export type ErrorKind = 'network' | 'timeout' | 'aborted' | 'auth' | 'membership' | 'rate_limit'
  | 'server' | 'invalid_response' | 'validation' | 'configuration' | 'storage';

// Only bounded machine codes leave the transport. Supplier bodies, credentials,
// guest data and server debug text must never become UI errors or logs.
export class ApiError extends Error {
  readonly kind: ErrorKind;
  readonly code: string;
  readonly status?: number;
  readonly retryAfterSeconds?: number;
  constructor(kind: ErrorKind, code: string, status?: number, retryAfterSeconds?: number) {
    super(code);
    this.name = 'ApiError'; this.kind = kind; this.code = code;
    this.status = status; this.retryAfterSeconds = retryAfterSeconds;
  }
}
export const invalidResponse = () => new ApiError('invalid_response', 'invalid_response');
export const aborted = () => new ApiError('aborted', 'request_aborted');
export function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError('network', 'network_unavailable');
}
