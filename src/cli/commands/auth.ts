import { Option, type Command } from 'commander';
import type { Context } from '../context.js';
import { addTransportOptions, type Options } from '../options.js';
import { loadSettings } from '../config.js';
import { coreRuntime, getTransport } from '../api.js';
import { listModels } from '../../core/evaluate.js';
import { MAX_KEY_BYTES, normalizeKey } from '../credentials.js';
import { promptKey } from '../secret-input.js';
import { readText } from '../input.js';
import { CliError, invalid } from '../errors.js';
import { describeCommand } from '../describe.js';

export function registerAuthCommand(program: Command, context: Context): void {
  const auth = program.command('auth').description('Manage saved API credentials (defaults to status)');
  const store = () => {
    if (!context.runtime.credentials) throw new CliError(7, {
      code: 'IO_ERROR', message: 'Credential storage is unavailable in this runtime.', retryable: false,
    });
    return context.runtime.credentials;
  };
  const environmentKey = () => Boolean(context.runtime.env.TYPESAFE_API_KEY?.trim());
  const status = async (command: Command) => {
    const credentials = store();
    const source = environmentKey() ? 'environment' : await credentials.read() ? 'file' : 'none';
    await context.out.json({ configured: source !== 'none', source, path: credentials.path }, command.optsWithGlobals().pretty === true);
  };
  auth.action(() => status(auth));
  describeCommand(auth, { input: [], output: 'auth-status', network: false, stdin: 'Does not read stdin.' });

  const login = addTransportOptions(auth.command('login'))
    .description('Verify and save an API key; prompts without echo in a terminal')
    .addOption(new Option('--stdin', 'Read the API key from piped stdin instead of prompting'));
  login.action(async () => {
    const options = login.optsWithGlobals<Options & { stdin?: boolean }>();
    // Both login modes reserve stdin, so config and headers must come from files.
    if (options.config === '-' || options.headersFile === '-') invalid('Login reserves stdin for the API key. Use config/header files.');
    const credentials = store();
    const settings = await loadSettings(context, options);
    const key = normalizeKey(options.stdin
      ? await readText(context, '-', Math.min(options.maxInputBytes ?? MAX_KEY_BYTES + 2, MAX_KEY_BYTES + 2))
      : await promptKey(context));
    // Validate the entered key, even when an environment key already exists.
    settings.apiKey = key;
    await listModels(await getTransport(context, settings), settings, coreRuntime(context, settings));
    context.checkAborted();
    await credentials.write(key);
    await context.out.json({ saved: true, verified: true, source: environmentKey() ? 'environment' : 'file',
      path: credentials.path }, settings.pretty);
  });
  describeCommand(login, { input: [], output: 'auth-login', network: true,
    stdin: 'Hidden terminal prompt; --stdin reads one API key from a pipe. Config/header files cannot read stdin.' });

  const statusCommand = auth.command('status').description('Show the credential source without revealing or verifying the key');
  statusCommand.action(() => status(statusCommand));
  describeCommand(statusCommand, { input: [], output: 'auth-status', network: false, stdin: 'Does not read stdin.' });

  const logout = auth.command('logout').description('Delete the saved key; environment variables and server-side keys are unchanged');
  logout.action(async () => {
    const credentials = store();
    const removed = await credentials.remove();
    await context.out.json({ removed, configured: environmentKey(), source: environmentKey() ? 'environment' : 'none',
      path: credentials.path }, logout.optsWithGlobals().pretty === true);
  });
  describeCommand(logout, { input: [], output: 'auth-logout', network: false, stdin: 'Does not read stdin.' });
}
