import { Command, CommanderError } from 'commander';
import packageJson from '../../package.json' with { type: 'json' };
import { Context, type ContextOptions } from './context.js';
import { asCliError, CliError } from './errors.js';
import { integer } from './options.js';
import { registerAskCommand } from './commands/ask.js';
import { registerChoiceCommand } from './commands/choice.js';
import { registerNoulCommand } from './commands/noul.js';
import { registerScoreCommand } from './commands/score.js';
import { registerBatchCommand } from './commands/batch.js';
import { registerModelsCommand } from './commands/models.js';
import { registerValidateCommand } from './commands/validate.js';
import { registerSchemaCommand } from './commands/schema.js';
import { registerDescribeCommand } from './commands/describe.js';
import { registerMcpCommand } from './commands/mcp.js';

export function createProgram(context: Context): Command {
  const program = new Command().name('jev').description('Typed AI judgments for scripts, agents, and automation')
    .version(packageJson.version)
    .option('--config <file>', 'Explicit JSON config file; - reads stdin')
    .option('--max-input-bytes <n>', 'Size limit per input or JSONL line (default: 16777216)', integer(1))
    .option('--pretty', 'Indent JSON output (not available for batch or MCP)')
    .option('--verbose', 'Emit safe JSON diagnostics on stderr')
    .exitOverride()
    .configureOutput({
      writeOut: text => { void context.out.text(text); },
      writeErr: () => {},
      outputError: () => {},
    });
  for (const register of [registerAskCommand, registerChoiceCommand, registerNoulCommand,
    registerScoreCommand, registerBatchCommand, registerModelsCommand, registerValidateCommand,
    registerSchemaCommand, registerDescribeCommand, registerMcpCommand]) register(program, context);
  program.action(() => { program.help(); });
  return program;
}

export async function runCli(argv: string[], runtime: ContextOptions): Promise<number> {
  const context = new Context(runtime);
  try {
    await createProgram(context).parseAsync(argv, { from: 'user' });
    context.checkAborted();
    await context.out.flush();
    await context.err.flush();
    return context.exitCode;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) {
      try { await context.out.flush(); return 0; }
      catch (failure) { return asCliError(failure).exitCode; }
    }
    const failure = error instanceof CommanderError
      ? new CliError(2, { code: 'INVALID_INPUT', message: 'Invalid command arguments. Run jev <command> --help for usage.', retryable: false })
      : asCliError(error);
    if (failure.exitCode !== 141) {
      try { await context.err.json({ type: 'error', error: failure.body }); await context.err.flush(); }
      catch { /* The output stream is already unusable; retain the original failure status. */ }
    }
    return failure.exitCode;
  } finally { context.dispose(); }
}
