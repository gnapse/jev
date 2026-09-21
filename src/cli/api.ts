import { createSdkTransport, type Transport } from '../core/api.js';
import type { Runtime } from '../core/settings.js';
import type { Context } from './context.js';
import type { Settings } from './config.js';

export function coreRuntime(context: Context, settings: Settings): Runtime {
  return { signal: context.signal,
    ...(settings.verbose ? { log: (event: Record<string, unknown>) => context.err.json(event) } : {}) };
}

export async function getTransport(context: Context, settings: Settings): Promise<Transport> {
  settings = await withCredentials(context, settings);
  return context.runtime.createTransport
    ? context.runtime.createTransport(settings, context)
    : createSdkTransport(settings, coreRuntime(context, settings));
}

export async function withCredentials(context: Context, settings: Settings): Promise<Settings> {
  return settings.apiKey ? settings : { ...settings, apiKey: await context.runtime.credentials?.read() };
}
