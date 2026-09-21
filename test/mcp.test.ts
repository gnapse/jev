import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { SystemOneRequest } from '@typesafe-ai/sdk';
import { createMcpServer, createMcpService } from '../src/mcp/server.js';
import { resolveSettings, type Settings } from '../src/core/settings.js';
import { JevError } from '../src/core/errors.js';
import type { Transport } from '../src/core/api.js';
import { createHarness, questions, request, responseFor } from '../src/test-support/harness.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(close => close())); });

async function connect(transport?: Partial<Transport> | null, overrides: Partial<Settings> = {}) {
  const controller = new AbortController();
  const calls: SystemOneRequest[] = [];
  const settings = { ...resolveSettings({}), ...overrides };
  const service = createMcpService({ settings, runtime: { signal: controller.signal },
    ...(transport === null ? {} : { transport: {
      evaluate: async (value: SystemOneRequest, signal: AbortSignal) => {
        calls.push(value);
        return transport?.evaluate ? transport.evaluate(value, signal) : responseFor(value);
      },
      models: transport?.models ?? (async () => ({ models: [{ name: 'jev-test', description: 'Test', release_date: '2026-09-21' }] })),
    } }),
  });
  const server = createMcpServer(service);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  cleanup.push(async () => { controller.abort(); await client.close(); await server.close(); });
  await server.connect(right);
  await client.connect(left);
  return { client, calls, controller, service };
}

describe('MCP protocol', () => {
  it('discovers four tools and validates offline without credentials', async () => {
    const { client } = await connect(null);
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name)).toEqual(['jev_ask', 'jev_batch', 'jev_models', 'jev_validate']);
    for (const tool of tools) { expect(tool.inputSchema.type).toBe('object'); expect(tool.outputSchema).toBeDefined(); }
    expect((await client.callTool({ name: 'jev_validate', arguments: { ...request } })).structuredContent)
      .toMatchObject({ valid: true });
    const failure = await client.callTool({ name: 'jev_ask', arguments: { ...request } });
    expect(failure.isError).toBe(true);
    expect(failure.structuredContent).toMatchObject({ error: { code: 'AUTH_ERROR' } });
  });

  it('matches CLI requests and preserves complete mixed responses', async () => {
    const mixed: SystemOneRequest = { state: { message: 'Help me' }, model: 'jev-pinned', questions: {
      ...questions, team: { type: 'choice', criteria: { support: null, other: null } },
      impact: { type: 'score', criteria: ['Low', 'High'] },
    } };
    const output = (value: SystemOneRequest) => ({ ...responseFor(value), extension: { retained: true } });
    const h = createHarness({ stdin: JSON.stringify(mixed), transport: { evaluate: async value => output(value) } });
    const cli = await h.run(['ask', '--request', '-']);
    const { client, calls } = await connect({ evaluate: async value => output(value) });
    await client.listTools();
    const result = await client.callTool({ name: 'jev_ask', arguments: { ...mixed } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(JSON.parse(cli.out));
    expect(calls).toEqual(h.requests);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
  });

  it('rejects invalid input, oversized batches, and routing overrides before calling the API', async () => {
    const { client, calls } = await connect();
    for (const args of [{ ...request, state: null }, { ...request, api_key: 'private-key' },
      { ...request, base_url: 'https://private.example' }, { ...request, state_file: '/private/file' }]) {
      const result = await client.callTool({ name: 'jev_ask', arguments: args });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ error: { code: 'INVALID_INPUT' } });
      expect(JSON.stringify(result)).not.toContain('private');
    }
    const result = await client.callTool({ name: 'jev_batch', arguments: {
      questions, records: Array.from({ length: 101 }, (_, i) => ({ id: String(i), state: 'x' })),
    } });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('preserves batch successes and per-record API failures in input order', async () => {
    const { client } = await connect({ evaluate: async value => {
      if (value.state === 'bad') throw new JevError({ code: 'API_ERROR', message: 'Rejected', retryable: false, http_status: 422 });
      await delay(value.state === 'slow' ? 20 : 1);
      return responseFor(value);
    } });
    await client.listTools();
    const result = await client.callTool({ name: 'jev_batch', arguments: {
      questions, records: ['slow', 'bad', 'fast'].map(id => ({ id, state: id })),
    } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      results: [{ index: 1, id: 'slow', ok: true }, { index: 2, id: 'bad', ok: false }, { index: 3, id: 'fast', ok: true }],
      summary: { consumed: 3, succeeded: 2, failed: 1, complete: true },
    });
  });

  it('supports full requests and stops scheduling on fail-fast', async () => {
    const { client, calls } = await connect({ evaluate: async () => {
      throw new JevError({ code: 'RATE_LIMITED', message: 'Retry later', retryable: true });
    } }, { concurrency: 1 });
    const result = await client.callTool({ name: 'jev_batch', arguments: {
      fail_fast: true, records: ['one', 'two'].map(id => ({ id, request })),
    } });
    expect(result.structuredContent).toMatchObject({ results: [{ index: 1, id: 'one', ok: false }],
      summary: { consumed: 1, failed: 1, complete: false } });
    expect(calls).toHaveLength(1);
  });

  it('bounds API concurrency across independent and batch calls', async () => {
    let active = 0;
    let maximum = 0;
    const { client } = await connect({ evaluate: async value => {
      active++; maximum = Math.max(maximum, active);
      await delay(10);
      active--;
      return responseFor(value);
    } }, { concurrency: 2 });
    await Promise.all([
      ...Array.from({ length: 5 }, () => client.callTool({ name: 'jev_ask', arguments: { ...request } })),
      client.callTool({ name: 'jev_batch', arguments: { questions, records: ['a', 'b', 'c'].map(id => ({ id, state: id })) } }),
    ]);
    expect(maximum).toBe(2);
    expect(active).toBe(0);
  });

  it('cancels one call without cancelling another or closing the server', async () => {
    let aborted = false;
    const { client, calls } = await connect({ evaluate: async (value, signal) => {
      if (value.state === 'slow') {
        try { await delay(10_000, undefined, { signal }); }
        catch { aborted = true; throw signal.reason; }
      }
      return responseFor(value);
    } }, { concurrency: 1 });
    const controller = new AbortController();
    const slow = client.callTool({ name: 'jev_ask', arguments: { ...request, state: 'slow' } }, { signal: controller.signal })
      .catch(error => error);
    await expect.poll(() => calls.length).toBe(1);
    const fast = client.callTool({ name: 'jev_ask', arguments: { ...request } });
    controller.abort();
    await slow;
    expect((await fast).isError).not.toBe(true);
    await expect.poll(() => aborted).toBe(true);
    expect((await client.listTools()).tools).toHaveLength(4);
  });

  it('returns sanitized failures and enforces deadlines', async () => {
    const first = await connect({ evaluate: async () => { throw new Error('private-key private-state'); } });
    const failure = await first.client.callTool({ name: 'jev_ask', arguments: { ...request } });
    expect(failure.structuredContent).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(failure)).not.toContain('private');
    const second = await connect({ evaluate: async (value, signal) => {
      await delay(10_000, undefined, { signal }); return responseFor(value);
    } }, { deadline: 20 });
    const timedOut = await second.client.callTool({ name: 'jev_ask', arguments: { ...request } });
    expect(timedOut.structuredContent).toMatchObject({ error: { code: 'DEADLINE_EXCEEDED' } });
  });

  it('bounds tool argument bytes and returns a protocol error for unknown tools', async () => {
    const { client, calls } = await connect(undefined, { maxInputBytes: 100 });
    expect((await client.callTool({ name: 'jev_ask', arguments: { ...request, state: 'x'.repeat(200) } })).isError).toBe(true);
    await expect(client.callTool({ name: 'unknown' })).rejects.toMatchObject({ code: -32602 });
    expect(calls).toHaveLength(0);
  });

  it('caps outstanding calls and cancels all API work on server shutdown', async () => {
    let started = 0;
    let stopped = 0;
    const { service, controller } = await connect({ evaluate: async (value, signal) => {
      started++;
      try { await delay(10_000, undefined, { signal }); }
      finally { stopped++; }
      return responseFor(value);
    } }, { concurrency: 2 });
    const signal = new AbortController().signal;
    const calls = Array.from({ length: 32 }, () => service('jev_ask', request, signal));
    await expect.poll(() => started).toBe(2);
    const overflow = await service('jev_ask', request, signal);
    expect(overflow.structuredContent).toMatchObject({ error: { code: 'BUSY' } });
    controller.abort();
    const cancelled = await Promise.all(calls);
    expect(cancelled.every(result => result.isError)).toBe(true);
    expect(stopped).toBe(2);
    expect(started).toBe(2);
  });
});
