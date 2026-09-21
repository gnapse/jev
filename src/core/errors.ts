export interface ErrorBody {
  code: string;
  message: string;
  retryable: boolean;
  http_status?: number;
  request_id?: string;
  details?: { path: string; rule: string }[];
}

export class JevError extends Error {
  constructor(readonly body: ErrorBody) {
    super(body.message);
    this.name = 'JevError';
  }
}

export function invalid(message: string): never {
  throw new JevError({ code: 'INVALID_INPUT', message, retryable: false });
}

export function asJevError(error: unknown): JevError {
  return error instanceof JevError ? error : new JevError({
    code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', retryable: false,
  });
}

export function cancelled(): JevError {
  return new JevError({ code: 'CANCELLED', message: 'The request was cancelled.', retryable: false });
}
