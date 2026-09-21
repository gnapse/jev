import { JevError } from './errors.js';

export class Limiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly capacity: number, private readonly maxPending = 128) {}

  async run<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    if (this.active >= this.capacity) {
      if (this.waiting.length >= this.maxPending) throw new JevError({
        code: 'BUSY', message: 'The server request queue is full. Retry after outstanding calls finish.', retryable: true,
      });
      await new Promise<void>((resolve, reject) => {
        const grant = () => { signal.removeEventListener('abort', abort); this.active++; resolve(); };
        const abort = () => {
          const index = this.waiting.indexOf(grant);
          if (index !== -1) this.waiting.splice(index, 1);
          reject(signal.reason);
        };
        this.waiting.push(grant);
        signal.addEventListener('abort', abort, { once: true });
      });
    } else this.active++;
    try { signal.throwIfAborted(); return await action(); }
    finally { this.active--; this.waiting.shift()?.(); }
  }
}
