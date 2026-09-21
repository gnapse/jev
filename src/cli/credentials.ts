import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, rm, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { CliError, invalid } from './errors.js';

export const MAX_KEY_BYTES = 4096;

export interface CredentialStore {
  readonly path: string;
  read(): Promise<string | undefined>;
  write(key: string): Promise<void>;
  remove(): Promise<boolean>;
}

export function normalizeKey(value: string): string {
  const key = value.trim();
  if (!key || key.length > MAX_KEY_BYTES || /[^\x21-\x7e]/.test(key)) {
    invalid('Provide one nonempty API key without spaces or control characters (maximum 4096 bytes).');
  }
  return key;
}

export function credentialPath(env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform, home = homedir()): string {
  const base = platform === 'win32'
    ? env.APPDATA || join(home, 'AppData', 'Roaming')
    : env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, '.config');
  return join(base, 'jev', 'credentials.json');
}

function storeError(): CliError {
  return new CliError(7, { code: 'IO_ERROR',
    message: 'Could not access saved credentials. Check the credentials file and its permissions, or run jev auth login again.',
    retryable: false });
}

export function fileCredentialStore(path: string): CredentialStore {
  return {
    path,
    async read() {
      try {
        if (!(await lstat(path)).isFile()) throw storeError();
        const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const stat = await file.stat();
          if (!stat.isFile() || stat.size > MAX_KEY_BYTES + 128
            || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw storeError();
          const buffer = Buffer.alloc(MAX_KEY_BYTES + 129);
          let bytesRead = 0;
          while (bytesRead < buffer.length) {
            const part = await file.read(buffer, bytesRead, buffer.length - bytesRead);
            if (!part.bytesRead) break;
            bytesRead += part.bytesRead;
          }
          if (bytesRead > MAX_KEY_BYTES + 128) throw storeError();
          const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)));
          if (!data || data.version !== 1 || typeof data.api_key !== 'string'
            || Object.keys(data).some(key => !['version', 'api_key'].includes(key))) throw storeError();
          return normalizeKey(data.api_key);
        } finally { await file.close(); }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        // File contents and OS error messages must never enter diagnostics.
        throw storeError();
      }
    },
    async write(value) {
      const key = normalizeKey(value);
      const directory = dirname(path);
      const temporary = join(directory, `.credentials-${randomUUID()}.tmp`);
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        if (!(await lstat(directory)).isDirectory()) throw storeError();
        if (process.platform !== 'win32') await chmod(directory, 0o700);
        const file = await open(temporary, 'wx', 0o600);
        try {
          await file.writeFile(`${JSON.stringify({ version: 1, api_key: key })}\n`, 'utf8');
          await file.sync();
        } finally { await file.close(); }
        await rename(temporary, path);
      } catch { throw storeError(); }
      finally { await rm(temporary, { force: true }).catch(() => {}); }
    },
    async remove() {
      try { await unlink(path); return true; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw storeError();
      }
    },
  };
}
