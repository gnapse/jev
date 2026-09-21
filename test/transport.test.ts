import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { SystemOneRequest } from '@typesafe-ai/sdk';
import { createHarness, request, responseFor } from '../src/test-support/harness.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.close(() => resolve());
    server.closeAllConnections();
  })));
});

async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): Promise<string> {
  const server = createServer((req, res) => { Promise.resolve(handler(req, res)).catch(() => res.destroy()); });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  return `http://127.0.0.1:${address.port}`;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function harness(baseURL: string) {
  return createHarness({ realTransport: true, stdin: JSON.stringify(request), env: {
    TYPESAFE_API_KEY: 'local-test-key', TYPESAFE_BASE_URL: baseURL, TYPESAFE_LOG_LEVEL: 'debug',
  } });
}

describe('official SDK against a local HTTP server', () => {
  it('sends one complete request and preserves the full response', async () => {
    let received: unknown;
    const url = await serve(async (req, res) => {
      expect(req.url).toBe('/v1/systemone');
      expect(req.headers.authorization).toBe('Bearer local-test-key');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      received = JSON.parse(Buffer.concat(chunks).toString());
      json(res, 200, { ...responseFor(received as SystemOneRequest), extension: { future: true } });
    });
    const result = await harness(url).run(['ask', '--request', '-', '--verbose']);
    expect(result.code).toBe(0);
    expect(received).toMatchObject({ state: request.state, model: 'jev-latest', questions: request.questions });
    expect(JSON.parse(result.out).extension.future).toBe(true);
    expect(result.err).not.toContain('local-test-key');
    expect(result.err).not.toContain('Please help.');
  });

  it.each([401, 403, 422, 429, 529])('maps HTTP %d without exposing response bodies', async status => {
    const url = await serve((_req, res) => {
      res.setHeader('x-typesafe-request-id', 'req-test');
      json(res, status, { message: 'private body and local-test-key' });
    });
    const result = await harness(url).run(['ask', '--request', '-', '--retries', '0']);
    expect(result.code).toBe(status === 401 || status === 403 ? 3 : status === 429 ? 4 : 5);
    expect(JSON.parse(result.err).error).toMatchObject({ http_status: status, request_id: 'req-test' });
    expect(result.out).toBe('');
    expect(result.err).not.toContain('private body');
    expect(result.err).not.toContain('local-test-key');
  });

  it('uses the SDK retry count and honors retry headers', async () => {
    let calls = 0;
    const url = await serve((_req, res) => {
      calls++;
      if (calls < 3) { res.setHeader('retry-after-ms', '1'); json(res, 429, {}); }
      else json(res, 200, responseFor(request));
    });
    const result = await harness(url).run(['ask', '--request', '-', '--retries', '2']);
    expect(result.code).toBe(0);
    expect(calls).toBe(3);
  });

  it('enforces a total deadline while waiting for a retry', async () => {
    let calls = 0;
    const url = await serve((_req, res) => {
      calls++; res.setHeader('retry-after', '60'); json(res, 429, {});
    });
    const result = await harness(url).run(['ask', '--request', '-', '--deadline-ms', '40']);
    expect(result.code).toBe(6);
    expect(JSON.parse(result.err).error.code).toBe('DEADLINE_EXCEEDED');
    expect(calls).toBe(1);
  });

  it('times out an attempt and keeps stdout empty', async () => {
    const url = await serve(() => {});
    const result = await harness(url).run(['ask', '--request', '-', '--timeout-ms', '20', '--retries', '0']);
    expect(result.code).toBe(6);
    expect(result.out).toBe('');
  });

  it.each(['not json', '{}', '{"models":"wrong"}'])('rejects incompatible successful responses: %s', async body => {
    const url = await serve((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(body); });
    for (const args of [['ask', '--request', '-'], ['models']]) {
      const result = await harness(url).run(args);
      expect(result.code).toBe(8);
      expect(result.out).toBe('');
    }
  });

  it('lists model cards including additional fields', async () => {
    const models = [{ name: 'jev-latest', description: 'Jev', release_date: '2026-09-01', extension: true }];
    const url = await serve((req, res) => {
      expect(req.url).toBe('/v1/models');
      json(res, 200, { models });
    });
    const result = await harness(url).run(['models']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual({ models });
  });
});
