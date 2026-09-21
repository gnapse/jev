import type { Command } from 'commander';
import type { Context } from '../context.js';
import { addTransportOptions, integer, type Options } from '../options.js';
import { loadSettings } from '../config.js';
import { coreRuntime } from '../api.js';
import { invalid } from '../../core/errors.js';
import { describeCommand } from '../describe.js';

export function registerMcpCommand(program: Command, context: Context): void {
  const command = addTransportOptions(program.command('mcp'))
    .description('Serve Jev tools over MCP stdio')
    .option('--concurrency <n>', 'Maximum concurrent API requests across all tool calls (default: 4)', integer(1));
  command.action(async () => {
    const options = command.optsWithGlobals<Options>();
    if (options.config === '-' || options.headersFile === '-') invalid('MCP reserves stdin for protocol messages. Use config/header files.');
    if (options.pretty) invalid('--pretty is not available for MCP protocol output.');
    const settings = await loadSettings(context, options);
    const { runStdio } = await import('../../mcp/stdio.js');
    await runStdio({ settings, runtime: coreRuntime(context, settings),
      stdin: context.runtime.stdin, stdout: context.runtime.stdout });
  });
  describeCommand(command, { input: [], output: 'mcp-protocol', network: true,
    stdin: 'Reserved for MCP JSON-RPC messages; file flags cannot read stdin.' });
}
