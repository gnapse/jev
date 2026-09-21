import { JevError, type ErrorBody } from '../core/errors.js';
export { invalid, type ErrorBody } from '../core/errors.js';

export class CliError extends JevError {
  constructor(readonly exitCode: number, readonly body: ErrorBody) {
    super(body);
    this.name = 'CliError';
  }
}

export function ioError(error: unknown): CliError {
  const code = (error as NodeJS.ErrnoException)?.code;
  return new CliError(code === 'EPIPE' ? 141 : 7, {
    code: code === 'EPIPE' ? 'PIPE_CLOSED' : 'IO_ERROR',
    message: code === 'EPIPE' ? 'Output pipe closed.' : 'Could not read input or write output.',
    retryable: false,
  });
}

export function asCliError(error: unknown): CliError {
  if (error instanceof JevError && !(error instanceof CliError)) {
    const codes: Record<string, number> = { INVALID_INPUT: 2, AUTH_ERROR: 3, RATE_LIMITED: 4,
      API_ERROR: 5, TRANSPORT_ERROR: 6, DEADLINE_EXCEEDED: 6, CANCELLED: 6, INVALID_RESPONSE: 8 };
    return new CliError(codes[error.body.code] ?? 70, error.body);
  }
  return error instanceof CliError ? error : new CliError(70, {
    code: 'INTERNAL_ERROR', message: 'An unexpected CLI error occurred.', retryable: false,
  });
}

export const exitCodes = {
  0: 'success', 1: 'BATCH_FAILED', 2: 'INVALID_INPUT', 3: 'AUTH_ERROR',
  4: 'RATE_LIMITED', 5: 'API_ERROR', 6: 'TRANSPORT_ERROR or DEADLINE_EXCEEDED',
  7: 'IO_ERROR', 8: 'INVALID_RESPONSE', 70: 'INTERNAL_ERROR',
  130: 'SIGINT', 141: 'PIPE_CLOSED', 143: 'SIGTERM',
};
