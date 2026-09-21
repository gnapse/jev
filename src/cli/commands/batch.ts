import type { Command } from 'commander';
import type { Context } from '../context.js';
import { addTransportOptions, integer, type Options } from '../options.js';
import { runBatch } from '../batch.js';
import { describeCommand } from '../describe.js';

export function registerBatchCommand(program: Command, context: Context): void {
  const command = addTransportOptions(program.command('batch'))
    .description('Process JSONL records with bounded concurrency')
    .requiredOption('--input <file>', 'JSONL records; - reads stdin')
    .option('--questions <file>', 'Shared questions for {id,state} records')
    .option('--passthrough', 'Permit additional request and question fields')
    .option('--concurrency <n>', 'Maximum unflushed requests (default: 4)', integer(1))
    .option('--ordered', 'Emit results in input order')
    .option('--fail-fast', 'Stop scheduling after the first record failure');
  command.action(async () => runBatch(context, command.optsWithGlobals<Options>()));
  describeCommand(command, { input: ['batch-state-record', 'batch-request-record', 'questions'],
    output: 'batch-result', network: true, stdin: 'JSONL with --input -; only one file flag may claim stdin.' });
}
