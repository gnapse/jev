#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { runCli } from './cli/program.js';
import { CliError } from './cli/errors.js';

const controller = new AbortController();
const interrupt = (name: 'SIGINT' | 'SIGTERM') => () => controller.abort(new CliError(name === 'SIGINT' ? 130 : 143,
  { code: name, message: `Interrupted by ${name}.`, retryable: false }));
const onInt = interrupt('SIGINT');
const onTerm = interrupt('SIGTERM');
process.once('SIGINT', onInt);
process.once('SIGTERM', onTerm);
try {
  process.exitCode = await runCli(process.argv.slice(2), {
    env: process.env, stdin: process.stdin, stdinIsTTY: process.stdin.isTTY === true,
    stdout: process.stdout, stderr: process.stderr, openFile: path => createReadStream(path), signal: controller.signal,
  });
} finally {
  process.off('SIGINT', onInt);
  process.off('SIGTERM', onTerm);
}
