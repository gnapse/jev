import { type Command, Option } from 'commander';
import type { Context } from '../context.js';
import { addPrimitiveOptions, type Options } from '../options.js';
import { runPrimitive } from '../evaluate.js';
import { describeCommand } from '../describe.js';

export function registerNoulCommand(program: Command, context: Context): void {
  const command = addPrimitiveOptions(program.command('noul'))
    .description('Return the probability that a yes/no condition is true')
    .addOption(new Option('--yes <description>', 'Describe a true outcome').conflicts('criteriaFile'))
    .addOption(new Option('--no <description>', 'Describe a false outcome').conflicts('criteriaFile'));
  command.action(async (instructions?: string) => runPrimitive(context, 'noul', instructions, command.optsWithGlobals<Options>()));
  describeCommand(command, { input: ['questions'], output: 'response', network: true, stdin: 'State text by default; file flags also accept -.' });
}
