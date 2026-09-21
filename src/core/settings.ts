import type { RetryPolicy } from '@typesafe-ai/sdk';
import { invalid } from './errors.js';
import { validate } from './schemas.js';

export const DEFAULT_MAX_INPUT_BYTES = 16 * 1024 * 1024;

export interface FileConfig {
  model?: string;
  base_url?: string;
  timeout_ms?: number;
  deadline_ms?: number;
  concurrency?: number;
  max_input_bytes?: number;
  headers?: Record<string, string>;
  retry?: Omit<Partial<RetryPolicy>, 'httpStatuses'> & { httpStatuses?: number[] };
}

export interface Settings {
  apiKey?: string;
  defaultModel: string;
  modelOverride?: string;
  baseURL: string;
  timeout: number;
  deadline: number;
  retry: Partial<RetryPolicy>;
  headers: Record<string, string>;
  concurrency: number;
  maxInputBytes: number;
}

export interface Overrides {
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  deadlineMs?: number;
  retries?: number;
  concurrency?: number;
  maxInputBytes?: number;
}

export interface Runtime {
  signal: AbortSignal;
  log?: (event: Record<string, unknown>) => void | Promise<void>;
}

export function resolveSettings(env: Readonly<Record<string, string | undefined>>, data: unknown = {},
  overrides: Overrides = {}, rawHeaders: unknown = {}): Settings {
  validate('config', data);
  const config = data as FileConfig;
  if (!rawHeaders || typeof rawHeaders !== 'object' || Array.isArray(rawHeaders)
    || Object.values(rawHeaders).some(value => typeof value !== 'string')) {
    invalid('Headers must be a JSON object with string values.');
  }
  const headers = new Headers();
  try {
    for (const entries of [config.headers ?? {}, rawHeaders]) {
      for (const [key, value] of Object.entries(entries)) {
        if (['authorization', 'content-type'].includes(key.toLowerCase())) invalid('Authorization and Content-Type headers cannot be overridden.');
        headers.set(key, value as string);
      }
    }
  } catch { invalid('Headers contain a forbidden name or invalid header value.'); }
  const apiRoot = overrides.baseUrl ?? (env.TYPESAFE_BASE_URL?.trim() || undefined)
    ?? config.base_url ?? 'https://api.typesafe.ai';
  try {
    const url = new URL(apiRoot);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
  } catch { invalid('API root must be an HTTP(S) URL without credentials, query, or fragment.'); }
  const timeout = overrides.timeoutMs ?? config.timeout_ms ?? 10_000;
  const deadline = overrides.deadlineMs ?? config.deadline_ms ?? 120_000;
  if (timeout > 2_147_483_647 || deadline > 2_147_483_647) invalid('Timeout and deadline exceed the timer limit.');
  const { httpStatuses, ...retryOptions } = config.retry ?? {};
  if (overrides.model !== undefined && !overrides.model.trim()) invalid('Model ID cannot be empty.');
  return {
    apiKey: env.TYPESAFE_API_KEY?.trim() || undefined,
    defaultModel: env.TYPESAFE_DEFAULT_MODEL?.trim() || config.model || 'jev-latest',
    modelOverride: overrides.model,
    baseURL: apiRoot.replace(/\/+$/, ''), timeout, deadline,
    retry: { ...retryOptions, ...(httpStatuses ? { httpStatuses: new Set(httpStatuses) } : {}),
      maxRetries: overrides.retries ?? config.retry?.maxRetries ?? 2 },
    headers: Object.fromEntries(headers),
    maxInputBytes: overrides.maxInputBytes ?? config.max_input_bytes ?? DEFAULT_MAX_INPUT_BYTES,
    concurrency: overrides.concurrency ?? config.concurrency ?? 4,
  };
}
