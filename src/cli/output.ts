import type { Writable } from 'node:stream';
import { ioError, type CliError } from './errors.js';

/** Serial writes wait for callbacks, which also provides stream backpressure. */
export class Writer {
  private pending: Promise<void> = Promise.resolve();
  private failure?: CliError;
  private readonly onError = (error: Error) => {
    this.failure ??= ioError(error);
    this.onFailure(this.failure);
  };

  constructor(private readonly stream: Writable, private readonly onFailure: (error: CliError) => void) {
    stream.on('error', this.onError);
  }

  text(text: string): Promise<void> {
    const write = this.pending.then(async () => {
      if (this.failure) throw this.failure;
      try {
        await new Promise<void>((resolve, reject) => {
          this.stream.write(text, (error) => error ? reject(error) : resolve());
        });
      } catch (error) {
        this.failure ??= ioError(error);
        this.onFailure(this.failure);
        throw this.failure;
      }
    });
    // Keep even writes from Commander's synchronous help callback handled.
    this.pending = write.catch(() => {});
    return write;
  }

  json(value: unknown, pretty = false): Promise<void> {
    return this.text(`${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`);
  }

  async flush(): Promise<void> {
    await this.pending;
    if (this.failure) throw this.failure;
  }

  dispose(): void {
    this.stream.off('error', this.onError);
  }
}
