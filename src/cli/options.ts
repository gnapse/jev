import { Command, Option, InvalidArgumentError } from 'commander';

export interface Options {
  config?: string;
  pretty?: boolean;
  verbose?: boolean;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  deadlineMs?: number;
  retries?: number;
  headersFile?: string;
  maxInputBytes?: number;
  request?: string;
  questions?: string;
  state?: string;
  stateFile?: string;
  stateFormat?: 'text' | 'json';
  passthrough?: boolean;
  dryRun?: boolean;
  id?: string;
  instructionsFile?: string;
  criteriaFile?: string;
  option?: string[];
  level?: string[];
  yes?: string;
  no?: string;
  input?: string;
  concurrency?: number;
  ordered?: boolean;
  failFast?: boolean;
}

export function integer(minimum: number): (value: string) => number {
  return value => {
    const number = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < minimum) {
      throw new InvalidArgumentError(`Expected an integer of at least ${minimum}.`);
    }
    return number;
  };
}

export const collect = (value: string, previous: string[] = []): string[] => [...previous, value];

export function addTransportOptions(command: Command): Command {
  return command
    .option('--model <id>', 'Model alias or versioned ID')
    .option('--base-url <url>', 'API root (default: https://api.typesafe.ai)')
    .option('--timeout-ms <n>', 'Timeout per attempt (default: 10000)', integer(1))
    .option('--deadline-ms <n>', 'Total request deadline (default: 120000)', integer(1))
    .option('--retries <n>', 'Retries after the first attempt (default: 2)', integer(0))
    .option('--headers-file <file>', 'Extra HTTP headers as JSON; - reads stdin');
}

export function addStateOptions(command: Command): Command {
  return command
    .addOption(new Option('--state <text>', 'Literal string state').conflicts('stateFile'))
    .addOption(new Option('--state-file <file>', 'State file; - reads stdin').conflicts('state'))
    .addOption(new Option('--state-format <format>', 'State file format (default: text)').choices(['text', 'json']));
}

export function addRequestOptions(command: Command): Command {
  return command
    .addOption(new Option('--request <file>', 'Complete request JSON; - reads stdin').conflicts(['questions', 'state', 'stateFile', 'stateFormat']))
    .addOption(new Option('--questions <file>', 'Named question map as JSON; - reads stdin').conflicts('request'))
    .option('--passthrough', 'Permit additional request and question fields');
}

export function addPrimitiveOptions(command: Command): Command {
  addTransportOptions(addStateOptions(command));
  return command
    .argument('[instructions]', 'The judgment to make about the state')
    .option('--instructions-file <file>', 'JSON instructions; - reads stdin')
    .option('--criteria-file <file>', 'JSON criteria; - reads stdin')
    .option('--id <id>', 'Answer ID (default: result)')
    .option('--dry-run', 'Print the resolved request without calling the API');
}
