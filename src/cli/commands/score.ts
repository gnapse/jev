import { type Command, Option } from 'commander';
import type { Context } from '../context.js';
import { addPrimitiveOptions, collect, type Options } from '../options.js';
import { runPrimitive } from '../evaluate.js';
import { describeCommand } from '../describe.js';

export function registerScoreCommand(program: Command, context: Context): void {
  const command = addPrimitiveOptions(program.command('score'))
    .description('Rate state against ordered descriptive levels')
    .addOption(new Option('--level <description>', 'Ordered level; repeat from low to high').argParser(collect).conflicts('criteriaFile'));
  command.action(async (instructions?: string) => runPrimitive(context, 'score', instructions, command.optsWithGlobals<Options>()));
  describeCommand(command, { input: ['questions'], output: 'response', network: true, stdin: 'State text by default; file flags also accept -.' });
}
