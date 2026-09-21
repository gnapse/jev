import type { Questions, SystemOneRequest, SystemOneResult } from '@typesafe-ai/sdk';
import type { Runtime, Settings } from './settings.js';
import { type Transport, withDeadline } from './api.js';
import { checkResponse, validate, warnings } from './schemas.js';

export function resolveRequest(value: unknown, settings: Settings, passthrough = false): SystemOneRequest {
  validate('request', value, passthrough);
  const request = value as SystemOneRequest;
  return { ...request, model: settings.modelOverride ?? request.model ?? settings.defaultModel };
}

export async function evaluate(transport: Transport, settings: Settings, request: SystemOneRequest,
  runtime: Runtime): Promise<SystemOneResult<Questions>> {
  const start = performance.now();
  const response = await withDeadline(runtime, settings, signal => transport.evaluate(request, signal));
  checkResponse(response, request);
  await runtime.log?.({ type: 'evaluation', model: response.model,
    duration_ms: Math.round(performance.now() - start), usage: response.usage });
  return response;
}

export async function listModels(transport: Transport, settings: Settings, runtime: Runtime): Promise<Record<string, unknown>> {
  const response = await withDeadline(runtime, settings, signal => transport.models(signal));
  validate('models', response, false, true);
  return response as Record<string, unknown>;
}

export function validateRequest(request: unknown): { valid: true; warnings: string[] } {
  validate('request', request);
  const value = request as SystemOneRequest;
  return { valid: true, warnings: warnings(value.questions, value.model) };
}
