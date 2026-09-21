import { describe, expect, it } from 'vitest';
import { createHarness, request } from '../test-support/harness.js';
import { validate } from '../core/schemas.js';

describe('process contract and discovery', () => {
  it.each([['--help'], ['--version'], ['ask', '--help'], []].map(args => ({ args })))('serves help/version offline: $args', async ({ args }) => {
    const h = createHarness({ tty: true });
    const result = await h.run(args);
    expect(result.code).toBe(0);
    expect(result.err).toBe('');
    expect(result.out).not.toBe('');
    expect(h.settings).toHaveLength(0);
  });

  it.each([['missing'], ['ask', '--unknown', 'secret-value'], ['score', '--level'], ['batch']].map(args => ({ args })))('returns one JSON parser error: $args', async ({ args }) => {
    const result = await createHarness().run(args);
    expect(result.code).toBe(2);
    expect(result.out).toBe('');
    expect(JSON.parse(result.err).error.code).toBe('INVALID_INPUT');
    expect(result.err).not.toContain('secret-value');
  });

  it('describes the actual command tree and schema names offline', async () => {
    const h = createHarness();
    const result = await h.run(['describe']);
    expect(result.code).toBe(0);
    const data = JSON.parse(result.out);
    validate('description', data);
    expect(data.commands.map((c: { name: string }) => c.name)).toEqual(['ask', 'choice', 'noul', 'score', 'batch', 'models', 'validate', 'schema', 'describe', 'mcp', 'auth']);
    expect(h.settings).toHaveLength(0);
    for (const name of data.schema_names) {
      const schema = await createHarness().run(['schema', name]);
      expect(schema.code).toBe(0);
      expect(JSON.parse(schema.out).$schema).toContain('2020-12');
    }
  });

  it('reports missing credentials without echoing state', async () => {
    const h = createHarness({ realTransport: true, files: { 'request.json': JSON.stringify(request) } });
    const result = await h.run(['ask', '--request', 'request.json']);
    expect(result.code).toBe(3);
    expect(result.err).not.toContain(request.state);
    expect(result.out).toBe('');
  });

  it('accepts global options before or after the command', async () => {
    for (const args of [['--pretty', 'describe'], ['describe', '--pretty']]) {
      const result = await createHarness().run(args);
      expect(result.code).toBe(0);
      expect(result.out).toContain('\n  "cli_version"');
    }
  });

  it.each([['mcp', '--config', '-'], ['mcp', '--headers-file', '-'], ['mcp', '--pretty']])
  ('rejects startup options that conflict with MCP stdio: %j', async (...args) => {
    const result = await createHarness().run(args);
    expect(result.code).toBe(2);
    expect(result.out).toBe('');
    expect(JSON.parse(result.err).error.code).toBe('INVALID_INPUT');
  });
});
