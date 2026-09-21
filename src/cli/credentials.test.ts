import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { credentialPath, fileCredentialStore } from './credentials.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'jev-credentials-'));
  directories.push(root);
  return fileCredentialStore(join(root, 'jev', 'credentials.json'));
}

describe('credential file', () => {
  it('uses a user directory independent of the working directory', () => {
    const home = join(tmpdir(), 'home');
    const config = join(tmpdir(), 'config');
    expect(credentialPath({}, 'darwin', home)).toBe(join(home, '.config', 'jev', 'credentials.json'));
    expect(credentialPath({ XDG_CONFIG_HOME: config }, 'linux', home)).toBe(join(config, 'jev', 'credentials.json'));
    expect(credentialPath({ XDG_CONFIG_HOME: 'relative' }, 'linux', home)).toBe(join(home, '.config', 'jev', 'credentials.json'));
    expect(credentialPath({ APPDATA: config }, 'win32', home)).toBe(join(config, 'jev', 'credentials.json'));
    expect(credentialPath({}, 'win32', home)).toBe(join(home, 'AppData', 'Roaming', 'jev', 'credentials.json'));
  });

  it('creates, replaces, reads and removes a private file without leftover temporary files', async () => {
    const store = await fixture();
    expect(await store.read()).toBeUndefined();
    expect(await store.remove()).toBe(false);
    await store.write('first-secret');
    expect(await store.read()).toBe('first-secret');
    await store.write('second-secret');
    expect(await store.read()).toBe('second-secret');
    expect(await readdir(dirname(store.path))).toEqual(['credentials.json']);
    expect(await readFile(store.path, 'utf8')).not.toContain('first-secret');
    if (process.platform !== 'win32') {
      expect((await stat(store.path)).mode & 0o777).toBe(0o600);
      expect((await stat(dirname(store.path))).mode & 0o777).toBe(0o700);
    }
    expect(await store.remove()).toBe(true);
    expect(await store.read()).toBeUndefined();
  });

  it.each(['{secret-value', '{"version":2,"api_key":"secret-value"}',
    '{"version":1,"api_key":"secret-value","extra":true}',
    '{"version":1,"api_key":"two secrets"}', 'secret-value'.repeat(500)])('sanitizes corrupt credentials', async contents => {
    const store = await fixture();
    await store.write('original');
    await writeFile(store.path, contents);
    await expect(store.read()).rejects.toMatchObject({ exitCode: 7, body: { code: 'IO_ERROR' } });
    await expect(store.read()).rejects.not.toThrow('secret-value');
  });

  it.skipIf(process.platform === 'win32')('rejects group-readable files and repairs permissions on login', async () => {
    const store = await fixture();
    await store.write('secret-value');
    await chmod(store.path, 0o644);
    await expect(store.read()).rejects.toMatchObject({ exitCode: 7 });
    await store.write('replacement');
    expect(await store.read()).toBe('replacement');
  });

  it.skipIf(process.platform === 'win32')('does not read through or overwrite a credentials symlink', async () => {
    const store = await fixture();
    await store.write('original');
    const other = join(dirname(store.path), 'other.json');
    await writeFile(other, '{"version":1,"api_key":"other-secret"}', { mode: 0o600 });
    await store.remove();
    await symlink(other, store.path);
    await expect(store.read()).rejects.toMatchObject({ exitCode: 7 });
    await store.write('replacement');
    expect(await store.read()).toBe('replacement');
    expect(await readFile(other, 'utf8')).toContain('other-secret');
  });
});
