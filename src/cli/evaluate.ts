import type { EntryType, Question, SystemOneRequest } from '@typesafe-ai/sdk';
import type { Context } from './context.js';
import type { Options } from './options.js';
import { type Settings, checkStdinOptions, loadSettings } from './config.js';
import { readJson, readText } from './input.js';
import { invalid } from './errors.js';
import { validate } from '../core/schemas.js';
import { getTransport, coreRuntime } from './api.js';
import { evaluate, resolveRequest } from '../core/evaluate.js';
export { resolveRequest } from '../core/evaluate.js';

export async function readState(context: Context, options: Options, settings: Settings): Promise<EntryType> {
  if (options.stateFormat !== undefined && options.stateFile === undefined) invalid('--state-format requires --state-file.');
  if (options.state !== undefined) return options.state;
  const file = options.stateFile ?? '-';
  return (options.stateFormat === 'json'
    ? await readJson(context, file, settings.maxInputBytes)
    : await readText(context, file, settings.maxInputBytes)) as EntryType;
}

export async function readRequest(context: Context, options: Options, settings: Settings): Promise<SystemOneRequest> {
  if (options.request !== undefined) {
    return resolveRequest(await readJson(context, options.request, settings.maxInputBytes), settings, options.passthrough);
  }
  if (options.questions === undefined) invalid('Supply --request or --questions.');
  const questions = await readJson(context, options.questions, settings.maxInputBytes);
  validate('questions', questions, options.passthrough);
  const state = await readState(context, options, settings);
  return resolveRequest({ state, questions }, settings, options.passthrough);
}

export async function executeRequest(context: Context, settings: Settings, options: Options, request: SystemOneRequest): Promise<void> {
  if (options.dryRun) { await context.out.json(request, settings.pretty); return; }
  const transport = await getTransport(context, settings);
  await context.out.json(await evaluate(transport, settings, request, coreRuntime(context, settings)), settings.pretty);
}

export async function runPrimitive(context: Context, type: Question['type'], instructions: string | undefined, options: Options): Promise<void> {
  if ((instructions === undefined) === (options.instructionsFile === undefined)) {
    invalid('Supply either instructions or --instructions-file, exclusively.');
  }
  checkStdinOptions(options, true);
  const settings = await loadSettings(context, options);
  const instruction = options.instructionsFile !== undefined
    ? await readJson(context, options.instructionsFile, settings.maxInputBytes) : instructions;
  if (instruction == null) invalid('Convenience commands require non-null instructions.');
  let criteria: unknown;
  const hasSimpleCriteria = options.option !== undefined || options.level !== undefined
    || options.yes !== undefined || options.no !== undefined;
  if (options.criteriaFile !== undefined) {
    if (hasSimpleCriteria) invalid('Simple criteria and --criteria-file are mutually exclusive.');
    criteria = await readJson(context, options.criteriaFile, settings.maxInputBytes);
  } else if (type === 'choice') {
    if (!options.option?.length) invalid('Choice requires --option or --criteria-file.');
    if (new Set(options.option).size !== options.option.length) invalid('Choice labels must be unique.');
    criteria = Object.fromEntries(options.option.map(label => [label, null]));
  } else if (type === 'score') {
    if (!options.level?.length) invalid('Score requires --level or --criteria-file.');
    criteria = options.level;
  } else if (hasSimpleCriteria) {
    criteria = { ...(options.yes !== undefined ? { true: options.yes } : {}),
      ...(options.no !== undefined ? { false: options.no } : {}) };
  }
  const id = options.id ?? 'result';
  if (!id) invalid('Question ID cannot be empty.');
  const question = { type, instructions: instruction, ...(criteria !== undefined ? { criteria } : {}) };
  const questions = { [id]: question };
  validate('questions', questions);
  const state = await readState(context, options, settings);
  const request = resolveRequest({ state, questions }, settings);
  await executeRequest(context, settings, options, request);
}
