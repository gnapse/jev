import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Repository examples use the local build created by npm run build.
const cli = fileURLToPath(new URL('../../dist/index.js', import.meta.url));

export function runCli(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [cli, ...args], {
      env: process.env, maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`jev ${args[0]} failed (${error.code ?? error.signal}).\n${stderr.trim()}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
    // Early CLI rejection can close stdin before a caller finishes writing.
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export async function ask(request) {
  const { stdout } = await runCli(['ask', '--request', '-'], JSON.stringify(request));
  return JSON.parse(stdout);
}
