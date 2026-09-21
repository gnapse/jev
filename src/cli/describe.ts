import type { Command } from 'commander';
import { schemas } from '../core/schemas.js';
import { exitCodes, invalid } from './errors.js';

export interface CommandMetadata { input: string[]; output: string; network: boolean; stdin: string }
const metadata = new WeakMap<Command, CommandMetadata>();
export function describeCommand(command: Command, data: CommandMetadata): void { metadata.set(command, data); }

export function describeProgram(program: Command, name?: string): unknown {
  const commands = name === undefined ? program.commands : program.commands.filter(command => command.name() === name);
  if (!commands.length) invalid('Unknown command. Run jev describe to list commands.');
  return {
    cli_version: program.version(), contract_version: 1,
    commands: commands.map(command => {
      const details = metadata.get(command)!;
      return {
        name: command.name(), description: command.description(),
        arguments: command.registeredArguments.map(argument => argument.required
          ? `<${argument.name()}>` : `[${argument.name()}]`),
        flags: [...program.options, ...command.options].map(option => ({ flags: option.flags, description: option.description })),
        input_schemas: details.input, output_schema: details.output,
        network: details.network, stdin: details.stdin,
      };
    }),
    stdin_rules: ['Only one input may read stdin.', 'Use - for explicit stdin.',
      'Split and primitive commands read piped stdin as text when state is omitted.', 'Commands never prompt.'],
    environment: { TYPESAFE_API_KEY: 'Bearer API credential', TYPESAFE_BASE_URL: 'API root',
      TYPESAFE_DEFAULT_MODEL: 'Default model when not supplied in flags or a request' },
    exit_codes: exitCodes, schema_names: Object.keys(schemas),
  };
}
