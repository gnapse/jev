import type { Command } from 'commander';
import type { Context } from '../context.js';
import { addTransportOptions, type Options } from '../options.js';
import { checkStdinOptions, loadSettings } from '../config.js';
import { getTransport, coreRuntime } from '../api.js';
import { listModels } from '../../core/evaluate.js';
import { describeCommand } from '../describe.js';

export function registerModelsCommand(program: Command, context: Context): void {
  const command = addTransportOptions(program.command('models')).description('List models available to the account');
  command.action(async () => {
    const options = command.optsWithGlobals<Options>();
    checkStdinOptions(options);
    const settings = await loadSettings(context, options);
    const transport = await getTransport(context, settings);
    const result = await listModels(transport, settings, coreRuntime(context, settings));
    await context.out.json(result, settings.pretty);
  });
  describeCommand(command, { input: [], output: 'models', network: true, stdin: 'Only explicit config/header file flags use stdin.' });
}
