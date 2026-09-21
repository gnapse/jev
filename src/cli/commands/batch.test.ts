import { PassThrough, Readable, Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { createHarness, questions, request, responseFor } from '../../test-support/harness.js';
import { CliError } from '../errors.js';

const record = (id: string, state: unknown = id) => JSON.stringify({ id, state });
const files = { q: JSON.stringify(questions) };
const command = ['batch', '--input', '-', '--questions', 'q'];

describe('JSONL scheduling', () => {
  it('correlates valid and invalid records, including a final unterminated line', async () => {
    const h = createHarness({ files, stdin: `${record('one')}\nnot JSON\n\n${record('four')}` });
    const result = await h.run(command);
    expect(result.code).toBe(1);
    const records = result.out.trim().split('\n').map(line => JSON.parse(line)).sort((a, b) => a.line - b.line);
    expect(records.map(r => [r.line, r.id, r.ok])).toEqual([[1, 'one', true], [2, null, false], [3, null, false], [4, 'four', true]]);
    expect(JSON.parse(result.err)).toMatchObject({ type: 'batch_summary', consumed: 4, succeeded: 2, failed: 2, complete: true });
    expect(h.requests).toHaveLength(2);
  });

  it('runs full request records with passthrough and per-record model selection', async () => {
    const h = createHarness({ stdin: JSON.stringify({ id: 'x', request: { ...request, model: 'custom-version', extension: null } }) });
    const result = await h.run(['batch', '--input', '-', '--passthrough']);
    expect(result.code).toBe(0);
    expect(h.requests[0]).toMatchObject({ model: 'custom-version', extension: null });
  });

  it.each([false, true])('bounds the concurrency window with ordered=%s', async ordered => {
    let active = 0;
    let maximum = 0;
    const h = createHarness({ files, stdin: ['slow', 'fast', 'third', 'fourth'].map(id => record(id)).join('\n'),
      transport: { evaluate: async value => {
        active++; maximum = Math.max(maximum, active);
        await delay(value.state === 'slow' ? 50 : 2);
        active--;
        return responseFor(value);
      } } });
    const running = h.run([...command, '--concurrency', '2', ...(ordered ? ['--ordered'] : [])]);
    await delay(20);
    if (ordered) expect(h.requests).toHaveLength(2);
    const result = await running;
    const ids = result.out.trim().split('\n').map(line => JSON.parse(line).id);
    expect(result.code).toBe(0);
    expect(maximum).toBe(2);
    expect(ids).toEqual(ordered ? ['slow', 'fast', 'third', 'fourth'] : ['fast', 'third', 'fourth', 'slow']);
  });

  it('emits completed results while the next input line is still pending', async () => {
    const stdin = new PassThrough();
    const h = createHarness({ files, stdin });
    const running = h.run(command);
    stdin.write(`${record('first')}\n`);
    await expect.poll(() => h.out).toContain('"id":"first"');
    stdin.end(`${record('second')}\n`);
    expect((await running).code).toBe(0);
  });

  it.each([false, true])('stops new requests after auth failure or fail-fast=%s', async failFast => {
    const failure = new CliError(failFast ? 5 : 3, { code: failFast ? 'API_ERROR' : 'AUTH_ERROR', message: 'Rejected', retryable: false });
    const h = createHarness({ files, stdin: ['a', 'b', 'c'].map(id => record(id)).join('\n'), transport: { evaluate: async () => { throw failure; } } });
    const result = await h.run([...command, '--concurrency', '1', ...(failFast ? ['--fail-fast'] : [])]);
    expect(result.code).toBe(1);
    expect(h.requests).toHaveLength(1);
    expect(JSON.parse(result.err).complete).toBe(false);
  });

  it('aborts an outstanding input read after an auth failure', async () => {
    const stdin = new PassThrough();
    const h = createHarness({ files, stdin, transport: { evaluate: async () => {
      await delay(5);
      throw new CliError(3, { code: 'AUTH_ERROR', message: 'Rejected', retryable: false });
    } } });
    const running = h.run(command);
    stdin.write(`${record('first')}\n`);
    expect((await running).code).toBe(1);
  });

  it('discards oversized lines and continues from the next line', async () => {
    const h = createHarness({ files, stdin: `${'x'.repeat(300)}\n${record('ok')}`, });
    const result = await h.run([...command, '--max-input-bytes', '150']);
    expect(result.code).toBe(1);
    expect(h.requests).toHaveLength(1);
    expect(result.out).toContain('"id":"ok","ok":true');
  });

  it('aborts SDK work and stops scheduling on a broken output pipe', async () => {
    const output = new Writable({ write(_chunk, _encoding, callback) { callback(Object.assign(new Error('pipe'), { code: 'EPIPE' })); } });
    const h = createHarness({ files, stdout: output, stdin: Array.from({ length: 30 }, (_, i) => record(String(i))).join('\n') });
    const result = await h.run([...command, '--concurrency', '1']);
    expect(result.code).toBe(141);
    expect(h.requests).toHaveLength(1);
  });

  it('propagates cancellation to in-flight work', async () => {
    const controller = new AbortController();
    let aborted = false;
    const h = createHarness({ files, stdin: `${record('x')}\n`, signal: controller.signal,
      transport: { evaluate: async (_value, signal) => {
        try { await delay(10_000, undefined, { signal }); }
        catch { aborted = true; throw signal.reason; }
        return responseFor(request);
      } } });
    const running = h.run(command);
    await expect.poll(() => h.requests.length).toBe(1);
    controller.abort(new CliError(130, { code: 'SIGINT', message: 'Interrupted', retryable: false }));
    expect((await running).code).toBe(130);
    expect(aborted).toBe(true);
  });

  it('maps input I/O failure and cancels requests', async () => {
    const stdin = new Readable({ read() { this.destroy(Object.assign(new Error('read failure'), { code: 'EIO' })); } });
    const result = await createHarness({ files, stdin }).run(command);
    expect(result.code).toBe(7);
  });
});
