import { type Command, Option } from 'commander';
import type { Context } from '../context.js';
import { addPrimitiveOptions, collect, type Options } from '../options.js';
import { runPrimitive } from '../evaluate.js';
import { describeCommand } from '../describe.js';

export function registerChoiceCommand(program: Command, context: Context): void {
  const command = addPrimitiveOptions(program.command('choice'))
    .description('Select an option and return its probability distribution')
    .addOption(new Option('--option <label>', 'Allowed option; repeat for each label').argParser(collect).conflicts('criteriaFile'));
  command.action(async (instructions?: string) => runPrimitive(context, 'choice', instructions, command.optsWithGlobals<Options>()));
  describeCommand(command, { input: ['questions'], output: 'response', network: true, stdin: 'State text by default; file flags also accept -.' });
}
