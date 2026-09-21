import type { Command } from 'commander';
import type { Context } from '../context.js';
import { describeCommand, describeProgram } from '../describe.js';

export function registerDescribeCommand(program: Command, context: Context): void {
  const command = program.command('describe').description('Print the machine-readable command contract').argument('[command]', 'Describe just one command');
  command.action(async (name?: string) => {
    await context.out.json(describeProgram(program, name), command.optsWithGlobals().pretty === true);
  });
  describeCommand(command, { input: [], output: 'description', network: false, stdin: 'Does not read stdin.' });
}
