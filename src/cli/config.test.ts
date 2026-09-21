import { describe, expect, it } from 'vitest';
import { createHarness, request } from '../test-support/harness.js';

describe('configuration', () => {
  const config = JSON.stringify({ model: 'config-model', base_url: 'http://config.example', timeout_ms: 42,
    retry: { maxRetries: 4 }, headers: { 'X-Context': 'config', 'X-Retain': 'keep' } });
  it.each([
    { flag: 'flag-model', body: 'body-model', env: 'env-model', expected: 'flag-model' },
    { flag: undefined, body: 'body-model', env: 'env-model', expected: 'body-model' },
    { flag: undefined, body: undefined, env: 'env-model', expected: 'env-model' },
    { flag: undefined, body: undefined, env: undefined, expected: 'config-model' },
  ])('resolves model to $expected', async ({ flag, body, env, expected }) => {
    const h = createHarness({ files: { config }, stdin: JSON.stringify({ ...request, model: body }), env: { TYPESAFE_DEFAULT_MODEL: env } });
    const result = await h.run(['ask', '--request', '-', '--config', 'config', ...(flag ? ['--model', flag] : [])]);
    expect(result.code).toBe(0);
    expect(h.requests[0]?.model).toBe(expected);
  });

  it('resolves flags, environment, config, and case-insensitive headers', async () => {
    const h = createHarness({ files: { config, headers: '{"x-context":"file"}' }, stdin: JSON.stringify(request),
      env: { TYPESAFE_BASE_URL: 'http://env.example', TYPESAFE_LOG_LEVEL: 'debug' } });
    const result = await h.run(['ask', '--request', '-', '--config', 'config', '--headers-file', 'headers', '--retries', '0']);
    expect(result.code).toBe(0);
    expect(h.settings[0]).toMatchObject({ baseURL: 'http://env.example', timeout: 42, retry: { maxRetries: 0 },
      headers: { 'x-context': 'file', 'x-retain': 'keep' }, verbose: false });
    expect(result.err).toBe('');
  });

  it.each(['{"api_key":"secret"}', '{"headers":{"Authorization":"secret"}}', '{"timeout_ms":0}', '{"unknown":true}'])('rejects invalid config without leaking values', async config => {
    const result = await createHarness({ files: { config } }).run(['noul', 'True?', '--state', 'x', '--config', 'config']);
    expect(result.code).toBe(2);
    expect(result.err).not.toContain('secret');
  });
});
