import { describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { createHarness, request } from '../../test-support/harness.js';
import type { CredentialStore } from '../credentials.js';
import { JevError } from '../../core/errors.js';
import { validate } from '../../core/schemas.js';

function fixture(key?: string): CredentialStore {
  return { path: '/test/credentials.json',
    read: vi.fn(async () => key), write: vi.fn(async value => { key = value; }),
    remove: vi.fn(async () => { const removed = key !== undefined; key = undefined; return removed; }) };
}

describe('auth commands', () => {
  it('verifies the entered key, saves it, and uses it for later calls', async () => {
    const credentials = fixture();
    const h = createHarness({ credentials, stdin: 'new-secret\r\n', env: { TYPESAFE_API_KEY: 'env-secret' } });
    const result = await h.run(['auth', 'login', '--stdin']);
    expect(result.code).toBe(0);
    expect(h.settings[0]?.apiKey).toBe('new-secret');
    expect(await credentials.read()).toBe('new-secret');
    expect(JSON.parse(result.out)).toMatchObject({ saved: true, verified: true, source: 'environment' });
    validate('auth-login', JSON.parse(result.out));
    expect(result.out + result.err).not.toContain('secret');
    const next = createHarness({ credentials });
    expect((await next.run(['models'])).code).toBe(0);
    expect(next.settings[0]?.apiKey).toBe('new-secret');
  });

  it('prefers an environment override without reading the saved key', async () => {
    const credentials = fixture();
    credentials.read = vi.fn(async () => { throw new Error('corrupt-secret'); });
    const h = createHarness({ credentials, env: { TYPESAFE_API_KEY: ' environment-secret ' } });
    expect((await h.run(['models'])).code).toBe(0);
    expect(h.settings[0]?.apiKey).toBe('environment-secret');
    expect(credentials.read).not.toHaveBeenCalled();
    const status = await createHarness({ credentials, env: { TYPESAFE_API_KEY: 'environment-secret' } }).run(['auth', 'status']);
    expect(JSON.parse(status.out).source).toBe('environment');
    expect(status.out).not.toContain('environment-secret');
    expect(credentials.read).not.toHaveBeenCalled();
  });

  it('falls back to storage for an empty environment key', async () => {
    const h = createHarness({ credentials: fixture('saved-secret'), env: { TYPESAFE_API_KEY: ' ' } });
    expect((await h.run(['models'])).code).toBe(0);
    expect(h.settings[0]?.apiKey).toBe('saved-secret');
  });

  it('keeps the previous key when verification fails', async () => {
    const credentials = fixture('old-secret');
    const result = await createHarness({ credentials, stdin: 'bad-secret', transport: { models: async () => {
      throw new JevError({ code: 'AUTH_ERROR', message: 'Rejected.', retryable: false });
    } } }).run(['auth', 'login', '--stdin']);
    expect(result.code).toBe(3);
    expect(await credentials.read()).toBe('old-secret');
    expect(credentials.write).not.toHaveBeenCalled();
    expect(result.out + result.err).not.toContain('secret');
  });

  it('keeps transport failures and internal errors free of credentials', async () => {
    const credentials = fixture('old-secret');
    const result = await createHarness({ credentials, stdin: 'bad-secret', transport: { models: async () => {
      throw new Error('bad-secret');
    } } }).run(['auth', 'login', '--stdin', '--verbose']);
    expect(result.code).toBe(70);
    expect(credentials.write).not.toHaveBeenCalled();
    expect(result.out + result.err).not.toContain('bad-secret');
  });

  it.each(['', ' \n', 'first-key\nsecond-key', 'invalid\u0000key', 'x'.repeat(4097)])('rejects empty, multiline or oversized key input', async stdin => {
    const credentials = fixture();
    const h = createHarness({ credentials, stdin });
    const result = await h.run(['auth', 'login', '--stdin']);
    expect(result.code).toBe(2);
    expect(h.settings).toHaveLength(0);
    expect(credentials.write).not.toHaveBeenCalled();
  });

  it.each([['auth', 'login'], ['auth', 'login', '--stdin', '--config', '-'],
    ['auth', 'login', '--stdin', '--headers-file', '-'], ['auth', 'login', '--api-key', 'secret']])
  ('requires explicit noninteractive input and reserves stdin: %j', async (...args) => {
    const result = await createHarness({ credentials: fixture(), stdin: 'secret' }).run(args);
    expect(result.code).toBe(2);
    expect(result.out + result.err).not.toContain('secret');
  });

  it('reports status offline and logout leaves environment overrides active', async () => {
    const credentials = fixture('saved-secret');
    const h = createHarness({ credentials });
    const status = await h.run(['auth']);
    validate('auth-status', JSON.parse(status.out));
    expect(JSON.parse(status.out)).toMatchObject({ configured: true, source: 'file' });
    expect(h.settings).toHaveLength(0);
    const logout = await createHarness({ credentials, env: { TYPESAFE_API_KEY: 'env-secret' } }).run(['auth', 'logout']);
    validate('auth-logout', JSON.parse(logout.out));
    expect(JSON.parse(logout.out)).toMatchObject({ removed: true, configured: true, source: 'environment' });
    expect(await credentials.read()).toBeUndefined();
    const again = await createHarness({ credentials }).run(['auth', 'logout']);
    expect(JSON.parse(again.out)).toMatchObject({ removed: false, configured: false, source: 'none' });
  });

  it('does not read credentials for offline validation or dry runs', async () => {
    const credentials = fixture();
    credentials.read = vi.fn(async () => { throw new Error('unreadable-secret'); });
    for (const args of [['validate', '--request', '-'], ['ask', '--request', '-', '--dry-run']]) {
      const result = await createHarness({ credentials, stdin: JSON.stringify(request) }).run(args);
      expect(result.code).toBe(0);
    }
    expect(credentials.read).not.toHaveBeenCalled();
  });

  it.each([{ input: 'typed-secret\r', exit: 0 }, { input: '\u0003', exit: 130 }, { input: '', exit: 2 }])
  ('hides terminal input and restores terminal mode on exit $exit', async ({ input, exit }) => {
    const stdin = Object.assign(new PassThrough(), { setRawMode: vi.fn() });
    const credentials = fixture();
    const h = createHarness({ credentials, stdin, tty: true });
    const pending = h.run(['auth', 'login']);
    setImmediate(() => input ? stdin.write(input) : stdin.end());
    const result = await pending;
    expect(result.code).toBe(exit);
    expect(result.out + result.err).not.toContain('typed-secret');
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
    if (exit === 0) expect(await credentials.read()).toBe('typed-secret');
    else expect(credentials.write).not.toHaveBeenCalled();
    stdin.destroy();
  });

  it('discovers auth subcommands and schemas offline', async () => {
    const result = await createHarness().run(['describe', 'auth']);
    const data = JSON.parse(result.out);
    validate('description', data);
    expect(data.commands[0].subcommands.map((command: { name: string }) => command.name)).toEqual(['login', 'status', 'logout']);
    const login = JSON.parse((await createHarness().run(['describe', 'auth login'])).out);
    validate('description', login);
    expect(login.commands[0].output_schema).toBe('auth-login');
    expect(login.commands[0].flags.some((flag: { flags: string }) => flag.flags === '--stdin')).toBe(true);
  });
});
