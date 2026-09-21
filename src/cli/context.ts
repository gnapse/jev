import type { Readable, Writable } from 'node:stream';
import type { Settings } from './config.js';
import type { Transport } from '../core/api.js';
import { Writer } from './output.js';
import { CliError } from './errors.js';

export interface ContextOptions {
  env: Readonly<Record<string, string | undefined>>;
  stdin: Readable;
  stdinIsTTY: boolean;
  stdout: Writable;
  stderr: Writable;
  openFile: (path: string) => Readable;
  signal?: AbortSignal;
  createTransport?: (settings: Settings, context: Context) => Promise<Transport>;
}

export class Context {
  readonly controller = new AbortController();
  readonly signal: AbortSignal;
  readonly out: Writer;
  readonly err: Writer;
  stdinClaimed = false;
  exitCode = 0;

  constructor(readonly runtime: ContextOptions) {
    this.signal = runtime.signal
      ? AbortSignal.any([runtime.signal, this.controller.signal])
      : this.controller.signal;
    const fail = (error: CliError) => this.controller.abort(error);
    this.out = new Writer(runtime.stdout, fail);
    this.err = new Writer(runtime.stderr, fail);
  }

  checkAborted(): void {
    if (this.signal.aborted) throw this.signal.reason;
  }

  dispose(): void {
    this.out.dispose();
    this.err.dispose();
  }
}
