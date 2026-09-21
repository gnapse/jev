import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, expect, it, vi } from 'vitest';
import { createJevMcpServerFactory } from '../src/mcp/index.js';
import { request, responseFor } from '../src/test-support/harness.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(close => close()));
  vi.unstubAllEnvs();
});

async function connect(factory: ReturnType<typeof createJevMcpServerFactory>) {
  const server = factory();
  const client = new Client({ name: 'factory-test', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  cleanup.push(async () => { await client.close(); await server.close(); });
  await server.connect(right);
  await client.connect(left);
  return client;
}

async function upstream() {
  let active = 0;
  let maximum = 0;
  const credentials: Array<string | undefined> = [];
  const server = createServer(async (req, res) => {
    credentials.push(req.headers.authorization);
    active++;
    maximum = Math.max(maximum, active);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    await delay(25);
    active--;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(responseFor(JSON.parse(Buffer.concat(chunks).toString()))));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No upstream address');
  return { url: `http://127.0.0.1:${address.port}`, credentials, get maximum() { return maximum; } };
}

it('does not inherit process credentials or configuration', async () => {
  vi.stubEnv('TYPESAFE_API_KEY', 'must-not-be-used');
  vi.stubEnv('TYPESAFE_BASE_URL', 'not-a-url');
  const client = await connect(createJevMcpServerFactory());
  expect((await client.listTools()).tools).toHaveLength(4);
  expect((await client.callTool({ name: 'jev_validate', arguments: { ...request } })).structuredContent)
    .toMatchObject({ valid: true });
  expect((await client.callTool({ name: 'jev_ask', arguments: { ...request } })).structuredContent)
    .toMatchObject({ error: { code: 'AUTH_ERROR' } });
});

it('shares limits across fresh protocol servers and keeps siblings usable after close', async () => {
  const api = await upstream();
  const factory = createJevMcpServerFactory({ apiKey: 'explicit-key', config: { base_url: api.url, concurrency: 2 } });
  const clients = await Promise.all([connect(factory), connect(factory)]);
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
    clients[i % 2]!.callTool({ name: 'jev_ask', arguments: { ...request } })));
  expect(results.every(result => !result.isError)).toBe(true);
  expect(api.maximum).toBe(2);
  expect(api.credentials).toEqual(Array(8).fill('Bearer explicit-key'));
  await clients[0]!.close();
  expect((await clients[1]!.callTool({ name: 'jev_validate', arguments: { ...request } })).isError).not.toBe(true);
});

it('keeps separate factory credentials isolated and honors host shutdown', async () => {
  const api = await upstream();
  const shutdown = new AbortController();
  const a = await connect(createJevMcpServerFactory({ apiKey: 'account-a', config: { base_url: api.url }, signal: shutdown.signal }));
  const b = await connect(createJevMcpServerFactory({ apiKey: 'account-b', config: { base_url: api.url } }));
  await a.callTool({ name: 'jev_ask', arguments: { ...request } });
  shutdown.abort();
  expect((await a.callTool({ name: 'jev_ask', arguments: { ...request } })).structuredContent)
    .toMatchObject({ error: { code: 'CANCELLED' } });
  expect((await b.callTool({ name: 'jev_ask', arguments: { ...request } })).isError).not.toBe(true);
  expect(api.credentials).toEqual(['Bearer account-a', 'Bearer account-b']);
});

it.each([{ concurrency: 0 }, { deadline_ms: -1 }, { base_url: 'file:///private' }, { headers: { Authorization: 'secret' } }])
('validates host configuration at startup: %j', config => {
  expect(() => createJevMcpServerFactory({ config })).toThrow();
});
