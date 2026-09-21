import { describe, expect, it } from 'vitest';
import { Limiter } from './limiter.js';
import { cancelled } from './errors.js';

describe('shared API limiter', () => {
  it('removes cancelled waiters and frees capacity after a failed call', async () => {
    const limiter = new Limiter(1);
    let release!: () => void;
    const signal = new AbortController().signal;
    const first = limiter.run(signal, () => new Promise<void>(resolve => { release = resolve; }));
    const controller = new AbortController();
    let called = false;
    const queued = limiter.run(controller.signal, async () => { called = true; }).catch(error => error);
    controller.abort(cancelled());
    expect((await queued).body.code).toBe('CANCELLED');
    release(); await first;
    await expect(limiter.run(signal, async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    expect(await limiter.run(signal, async () => 'next')).toBe('next');
    expect(called).toBe(false);
  });

  it('rejects overflow without losing active or pending work', async () => {
    const limiter = new Limiter(1, 1);
    const signal = new AbortController().signal;
    let release!: () => void;
    const first = limiter.run(signal, () => new Promise<void>(resolve => { release = resolve; }));
    const queued = limiter.run(signal, async () => 'queued');
    await expect(limiter.run(signal, async () => 'overflow')).rejects.toMatchObject({ body: { code: 'BUSY', retryable: true } });
    release(); await first;
    expect(await queued).toBe('queued');
  });
});
