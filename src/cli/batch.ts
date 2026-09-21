import type { Questions } from '@typesafe-ai/sdk';
import type { Context } from './context.js';
import type { Options } from './options.js';
import { checkStdinOptions, loadSettings } from './config.js';
import { getTransport, coreRuntime } from './api.js';
import { evaluate, resolveRequest } from '../core/evaluate.js';
import { prepareBatchRecord, processBatch, type BatchInput } from '../core/batch.js';
import { parseJson, readJson, readLines } from './input.js';
import { invalid } from './errors.js';
import { validate } from '../core/schemas.js';

export async function runBatch(context: Context, options: Options): Promise<void> {
  if (options.pretty) invalid('--pretty cannot be used with JSONL batch output.');
  if (options.input === undefined) invalid('Batch requires --input.');
  checkStdinOptions(options);
  const settings = await loadSettings(context, options);
  const questions = options.questions !== undefined
    ? await readJson(context, options.questions, settings.maxInputBytes) : undefined;
  if (questions !== undefined) validate('questions', questions, options.passthrough);
  const transport = await getTransport(context, settings);
  const source = async function* (signal: AbortSignal): AsyncGenerator<BatchInput> {
    for await (const line of readLines(context, options.input!, settings.maxInputBytes, signal)) {
      try {
        if (line.error) throw line.error;
        yield prepareBatchRecord(parseJson(line.text!), line.line, questions as Questions | undefined, options.passthrough);
      } catch (error) { yield { index: line.line, id: null, error }; }
    }
  };
  const summary = await processBatch(source, (value, signal) => evaluate(transport, settings,
    resolveRequest(value, settings, options.passthrough), { ...coreRuntime(context, settings), signal }),
  { concurrency: settings.concurrency, ordered: options.ordered ?? false, failFast: options.failFast ?? false, signal: context.signal },
  async ({ index, ...result }) => { await context.out.json({ line: index, ...result }); });
  context.exitCode = summary.failed ? 1 : 0;
  await context.err.json(summary);
}
