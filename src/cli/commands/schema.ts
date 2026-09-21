import type { Command } from 'commander';
import type { Context } from '../context.js';
import { schemas } from '../../core/schemas.js';
import { invalid } from '../errors.js';
import { describeCommand } from '../describe.js';

export function registerSchemaCommand(program: Command, context: Context): void {
  const command = program.command('schema').description('Print a bundled JSON Schema').argument('<name>', 'Schema name from jev describe');
  command.action(async (name: string) => {
    if (!Object.hasOwn(schemas, name)) invalid('Unknown schema. Run jev describe to list schemas.');
    await context.out.json(schemas[name], command.optsWithGlobals().pretty === true);
  });
  describeCommand(command, { input: [], output: 'json-schema', network: false, stdin: 'Does not read stdin.' });
}
