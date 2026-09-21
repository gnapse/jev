import type { Command } from 'commander';
import { schemas } from '../core/schemas.js';
import { exitCodes, invalid } from './errors.js';

export interface CommandMetadata { input: string[]; output: string; network: boolean; stdin: string }
const metadata = new WeakMap<Command, CommandMetadata>();
export function describeCommand(command: Command, data: CommandMetadata): void { metadata.set(command, data); }

export function describeProgram(program: Command, name?: string): unknown {
  let commands = program.commands;
  if (name !== undefined) {
    let parent = program;
    for (const part of name.split(' ')) {
      const child = parent.commands.find(command => command.name() === part);
      if (!child) invalid('Unknown command. Run jev describe to list commands.');
      parent = child;
    }
    commands = [parent];
  }
  if (!commands.length) invalid('Unknown command. Run jev describe to list commands.');
  const describe = (command: Command): unknown => {
    const details = metadata.get(command)!;
    const ancestors = [command];
    while (ancestors[0]!.parent) ancestors.unshift(ancestors[0]!.parent!);
    return {
      name: command.name(), description: command.description(),
      arguments: command.registeredArguments.map(argument => argument.required
        ? `<${argument.name()}>` : `[${argument.name()}]`),
      flags: ancestors.flatMap(ancestor => ancestor.options).map(option => ({ flags: option.flags, description: option.description })),
      input_schemas: details.input, output_schema: details.output,
      network: details.network, stdin: details.stdin,
      ...(command.commands.length ? { subcommands: command.commands.map(describe) } : {}),
    };
  };
  return {
    cli_version: program.version(), contract_version: 1,
    commands: commands.map(describe),
    stdin_rules: ['Only one input may read stdin.', 'Use - for explicit stdin.',
      'Split and primitive commands read piped stdin as text when state is omitted.', 'Only auth login prompts; --stdin disables its prompt.'],
    environment: { TYPESAFE_API_KEY: 'Bearer API credential; overrides the saved key',
      XDG_CONFIG_HOME: 'Absolute config directory on macOS/Linux; defaults to ~/.config',
      APPDATA: 'Config directory on Windows', TYPESAFE_BASE_URL: 'API root',
      TYPESAFE_DEFAULT_MODEL: 'Default model when not supplied in flags or a request' },
    exit_codes: exitCodes, schema_names: Object.keys(schemas),
  };
}
