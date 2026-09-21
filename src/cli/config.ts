import type { Context } from './context.js';
import type { Options } from './options.js';
import { readJson } from './input.js';
import { invalid } from '../core/errors.js';
import { resolveSettings, DEFAULT_MAX_INPUT_BYTES, type Settings as CoreSettings } from '../core/settings.js';

export interface Settings extends CoreSettings { pretty: boolean; verbose: boolean }

export function checkStdinOptions(options: Options, implicitState = false): void {
  const files = [options.config, options.headersFile, options.request, options.questions,
    options.stateFile, options.instructionsFile, options.criteriaFile, options.input];
  const implicit = implicitState && options.state === undefined && options.stateFile === undefined;
  if (files.filter(file => file === '-').length + Number(implicit) > 1) {
    invalid('Only one input can read stdin. Use files for the other inputs.');
  }
}

export async function loadSettings(context: Context, options: Options): Promise<Settings> {
  const initialMax = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const data = options.config !== undefined ? await readJson(context, options.config, initialMax) : {};
  const initial = resolveSettings(context.runtime.env, data, options);
  const headers = options.headersFile !== undefined ? await readJson(context, options.headersFile, initial.maxInputBytes) : {};
  return { ...resolveSettings(context.runtime.env, data, options, headers),
    pretty: options.pretty ?? false, verbose: options.verbose ?? false };
}
