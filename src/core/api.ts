import type { SystemOneRequest } from '@typesafe-ai/sdk';
import type { Settings, Runtime } from './settings.js';
import { JevError } from './errors.js';

export interface Transport {
  evaluate(request: SystemOneRequest, signal: AbortSignal): Promise<unknown>;
  models(signal: AbortSignal): Promise<unknown>;
}

export async function createSdkTransport(settings: Settings, runtime: Runtime): Promise<Transport> {
  if (!settings.apiKey) throw new JevError({
    code: 'AUTH_ERROR', message: 'Set TYPESAFE_API_KEY in the environment before calling the API.', retryable: false,
  });
  const sdk = await import('@typesafe-ai/sdk');
  const client = new sdk.TypeSafeClient({
    apiKey: settings.apiKey, baseURL: settings.baseURL, defaultModel: settings.defaultModel,
    timeout: settings.timeout, retry: settings.retry, defaultHeaders: settings.headers,
    logLevel: 'off',
    fetch: async (url, init) => {
      runtime.signal.throwIfAborted();
      if (runtime.log) {
        const retry = new Headers(init?.headers).get('X-TypeSafe-Retry-Count');
        await runtime.log({ type: 'http_attempt', method: init?.method ?? 'GET',
          origin: new URL(String(url)).origin, retry: retry === null ? 0 : Number(retry) });
      }
      return fetch(url, init);
    },
  });

  const call = async (request: () => Promise<unknown>): Promise<unknown> => {
    try { return await request(); }
    catch (error) {
      runtime.signal.throwIfAborted();
      if (error instanceof JevError) throw error;
      if (error instanceof sdk.APIError) {
        const status = error.status;
        const auth = status === 401 || status === 403;
        throw new JevError({
          code: auth ? 'AUTH_ERROR' : status === 429 ? 'RATE_LIMITED' : 'API_ERROR',
          message: auth ? 'The API rejected the credentials or account permissions.'
            : `The API returned HTTP ${status}.`,
          retryable: status === 408 || status === 429 || status >= 500,
          http_status: status,
          ...(error.requestId ? { request_id: error.requestId } : {}),
        });
      }
      if (error instanceof sdk.APIConnectionError || error instanceof sdk.APIUserAbortError) {
        throw new JevError({ code: 'TRANSPORT_ERROR',
          message: 'The API request failed to connect, timed out, or was cancelled.', retryable: true });
      }
      // SDK JSON decoding/shape errors are never allowed to print response bodies.
      if (error instanceof SyntaxError || error instanceof sdk.TypeSafeError) {
        throw new JevError({ code: 'INVALID_RESPONSE', message: 'The API response could not be decoded.', retryable: false });
      }
      throw error;
    }
  };

  return {
    evaluate: (request, signal) => call(() => client.systemOne(request, { signal })),
    models: signal => call(async () => ({ models: await client.models.list({ signal }) })),
  };
}

export async function withDeadline<T>(runtime: Runtime, settings: Settings, call: (signal: AbortSignal) => Promise<T>): Promise<T> {
  runtime.signal.throwIfAborted();
  const controller = new AbortController();
  const expired = new JevError({ code: 'DEADLINE_EXCEEDED',
    message: 'The request exceeded its total deadline.', retryable: true });
  const timer = setTimeout(() => controller.abort(expired), settings.deadline);
  const signal = AbortSignal.any([runtime.signal, controller.signal]);
  try { return await call(signal); }
  catch (error) {
    if (signal.aborted) throw signal.reason;
    throw error;
  } finally { clearTimeout(timer); }
}
