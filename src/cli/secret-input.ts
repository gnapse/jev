import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import type { Context } from './context.js';
import { CliError, invalid, ioError } from './errors.js';
import { MAX_KEY_BYTES } from './credentials.js';

/** readline provides terminal editing and raw-mode cleanup; its output is muted. */
export async function promptKey(context: Context): Promise<string> {
  if (!context.runtime.stdinIsTTY) invalid('Login needs a terminal. Use jev auth login --stdin to pipe a key.');
  context.checkAborted();
  context.stdinClaimed = true;
  const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const input = context.runtime.stdin;
  const terminal = createInterface({ input, output: muted, terminal: true, historySize: 0 });
  try {
    const entered = new Promise<string>((resolve, reject) => {
      const abort = () => reject(context.signal.reason);
      const interrupted = () => reject(new CliError(130, { code: 'SIGINT', message: 'Login cancelled.', retryable: false }));
      const closed = () => reject(new CliError(2, { code: 'INVALID_INPUT', message: 'Login ended without an API key.', retryable: false }));
      const failed = (error: Error) => reject(ioError(error));
      let bytes = 0;
      const bounded = (chunk: Buffer | string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_KEY_BYTES + 2) reject(new CliError(2, {
          code: 'INVALID_INPUT', message: 'API key input exceeds 4096 bytes.', retryable: false,
        }));
      };
      const cleanup = () => {
        context.signal.removeEventListener('abort', abort);
        input.off('error', failed);
        input.off('data', bounded);
        terminal.off('SIGINT', interrupted);
      };
      context.signal.addEventListener('abort', abort, { once: true });
      input.on('error', failed);
      input.on('data', bounded);
      terminal.once('SIGINT', interrupted);
      terminal.once('line', value => { cleanup(); resolve(value); });
      terminal.once('close', () => { cleanup(); closed(); });
      if (context.signal.aborted) abort();
    });
    // Disable echo and attach handlers before displaying a prompt the user can answer.
    const [, key] = await Promise.all([context.err.text('TypeSafe API key: '), entered]);
    return key;
  } finally {
    terminal.close();
    muted.destroy();
    await context.err.text('\n');
  }
}
