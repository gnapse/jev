import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';
import { asJevError, invalid, type ErrorBody } from './errors.js';
import { validate } from './schemas.js';

export interface BatchInput { index: number; id: string | null; request?: unknown; error?: unknown }
export type BatchResult = { index: number; id: string | null } & (
  { ok: true; response: SystemOneResult<Questions> } | { ok: false; error: ErrorBody }
);
export interface BatchSummary {
  type: 'batch_summary'; consumed: number; succeeded: number; failed: number; complete: boolean;
  usage: { input_tokens: number; output_tokens: number };
}
type Event = { kind: 'result'; result: BatchResult }
  | { kind: 'input'; input: IteratorResult<BatchInput> }
  | { kind: 'input-error'; error: unknown };

export function prepareBatchRecord(value: unknown, index: number, questions?: Questions, passthrough = false): BatchInput {
  const id = value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' ? value.id : null;
  try {
    validate(questions === undefined ? 'batch-request-record' : 'batch-state-record', value, passthrough);
    const record = value as { request?: unknown; state?: unknown };
    return { index, id, request: questions === undefined ? record.request : { state: record.state, questions } };
  } catch (error) { return { index, id, error }; }
}

export async function processBatch(source: (signal: AbortSignal) => AsyncIterable<BatchInput>,
  evaluate: (request: unknown, signal: AbortSignal) => Promise<SystemOneResult<Questions>>,
  options: { concurrency: number; ordered: boolean; failFast: boolean; signal: AbortSignal },
  emit: (result: BatchResult) => Promise<void>): Promise<BatchSummary> {
  const work = new AbortController();
  const input = new AbortController();
  const signal = AbortSignal.any([options.signal, work.signal]);
  const iterator = source(AbortSignal.any([signal, input.signal]))[Symbol.asyncIterator]();
  const active = new Map<number, Promise<Event>>();
  const ready = new Map<number, BatchResult>();
  let nextInput: Promise<Event> | undefined;
  let eof = false;
  let stopped = false;
  let consumed = 0;
  let succeeded = 0;
  let failed = 0;
  let nextOutput = 1;
  const usage = { input_tokens: 0, output_tokens: 0 };
  const execute = async (item: BatchInput): Promise<Event> => {
    try {
      if (item.error) throw item.error;
      return { kind: 'result', result: { index: item.index, id: item.id, ok: true,
        response: await evaluate(item.request, signal) } };
    } catch (error) {
      const failure = asJevError(error);
      if (failure.body.code === 'INTERNAL_ERROR') work.abort(failure);
      return { kind: 'result', result: { index: item.index, id: item.id, ok: false, error: failure.body } };
    }
  };
  const output = async (result: BatchResult) => {
    await emit(result);
    if (result.ok) {
      succeeded++;
      usage.input_tokens += result.response.usage.input_tokens;
      usage.output_tokens += result.response.usage.output_tokens;
    } else failed++;
  };
  try {
    while (true) {
      signal.throwIfAborted();
      if (!stopped && !eof && !nextInput && active.size + ready.size < options.concurrency) {
        nextInput = iterator.next().then(value => ({ kind: 'input' as const, input: value }),
          error => ({ kind: 'input-error' as const, error }));
      }
      const waiting = [...active.values(), ...(nextInput ? [nextInput] : [])];
      if (!waiting.length) break;
      const event = await Promise.race(waiting);
      signal.throwIfAborted();
      if (event.kind === 'input-error') {
        nextInput = undefined;
        if (!stopped) throw event.error;
      } else if (event.kind === 'input') {
        nextInput = undefined;
        if (event.input.done) eof = true;
        else if (!stopped) { consumed++; active.set(event.input.value.index, execute(event.input.value)); }
      } else {
        const result = event.result;
        active.delete(result.index);
        if (!result.ok && (options.failFast || result.error.code === 'AUTH_ERROR')) { stopped = true; input.abort(); }
        if (options.ordered) {
          ready.set(result.index, result);
          while (ready.has(nextOutput)) {
            await output(ready.get(nextOutput)!);
            ready.delete(nextOutput++);
          }
        } else await output(result);
      }
    }
    if (consumed === 0) invalid('Batch input is empty.');
    return { type: 'batch_summary', consumed, succeeded, failed, complete: eof && !stopped, usage };
  } catch (error) {
    work.abort(error);
    throw error;
  } finally {
    input.abort();
    await iterator.return?.();
    await Promise.all(active.values());
  }
}
