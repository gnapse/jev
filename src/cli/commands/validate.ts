import { type Command, Option } from 'commander';
import type { Questions, SystemOneRequest } from '@typesafe-ai/sdk';
import type { Context } from '../context.js';
import type { Options } from '../options.js';
import { checkStdinOptions, loadSettings } from '../config.js';
import { readJson } from '../input.js';
import { invalid } from '../errors.js';
import { validate, warnings } from '../../core/schemas.js';
import { describeCommand } from '../describe.js';

export function registerValidateCommand(program: Command, context: Context): void {
  const command = program.command('validate').description('Validate request or question JSON offline')
    .addOption(new Option('--request <file>', 'Full request JSON; - reads stdin').conflicts('questions'))
    .addOption(new Option('--questions <file>', 'Question map JSON; - reads stdin').conflicts('request'))
    .option('--passthrough', 'Permit additional request and question fields');
  command.action(async () => {
    const options = command.optsWithGlobals<Options>();
    if (options.request === undefined && options.questions === undefined) invalid('Supply --request or --questions.');
    checkStdinOptions(options);
    const settings = await loadSettings(context, options);
    const data = await readJson(context, (options.request ?? options.questions)!, settings.maxInputBytes);
    const full = options.request !== undefined;
    validate(full ? 'request' : 'questions', data, options.passthrough);
    const request = data as SystemOneRequest;
    await context.out.json({ valid: true, warnings: warnings(full ? request.questions : data as Questions,
      full ? request.model ?? settings.defaultModel : undefined) }, settings.pretty);
  });
  describeCommand(command, { input: ['request', 'questions'], output: 'validation', network: false, stdin: 'JSON with --request - or --questions -.' });
}
