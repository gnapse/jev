import { type Command } from 'commander';
import type { Context } from '../context.js';
import { addRequestOptions, addStateOptions, addTransportOptions, type Options } from '../options.js';
import { checkStdinOptions, loadSettings } from '../config.js';
import { executeRequest, readRequest } from '../evaluate.js';
import { describeCommand } from '../describe.js';

export function registerAskCommand(program: Command, context: Context): void {
  const command = addRequestOptions(addStateOptions(addTransportOptions(program.command('ask'))))
    .description('Evaluate one state against any mix of named questions')
    .option('--dry-run', 'Print the resolved request without calling the API');
  command.action(async () => {
    const options = command.optsWithGlobals<Options>();
    checkStdinOptions(options, options.request === undefined);
    const settings = await loadSettings(context, options);
    await executeRequest(context, settings, options, await readRequest(context, options, settings));
  });
  describeCommand(command, { input: ['request', 'questions'], output: 'response', network: true,
    stdin: 'Full request JSON with --request -, or state text when no state option is supplied.' });
}
