import { Readable, Writable } from 'node:stream';
import type { SystemOneRequest, Questions, SystemOneResult } from '@typesafe-ai/sdk';
import type { ContextOptions } from '../cli/context.js';
import type { Settings } from '../cli/config.js';
import type { Transport } from '../core/api.js';
import { runCli } from '../cli/program.js';

export const questions: Questions = {
  flag: { type: 'noul', instructions: 'Does this request ask for help?' },
};
export const request: SystemOneRequest = { state: 'Please help.', questions };

export function responseFor(request: SystemOneRequest): SystemOneResult<Questions> {
  const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
    if (question.type === 'noul') return [id, { type: 'noul', noul: 0.8 }];
    const keys = question.type === 'choice' ? Object.keys(question.criteria) : question.criteria.map((_, i) => String(i));
    const probabilities = Object.fromEntries(keys.map((key, i) => [key, i === 0 ? 1 : 0]));
    return [id, question.type === 'choice'
      ? { type: 'choice', choice: keys[0], confidence: 1, probabilities }
      : { type: 'score', score: 0, confidence: 1, probabilities,
        legend: Object.fromEntries(question.criteria.map((level, i) => [String(i), level])) }];
  }));
  return { model: request.model ?? 'jev-1.13.0', answers, usage: { input_tokens: 25, output_tokens: 5 } };
}

export interface HarnessOptions {
  files?: Record<string, string | Buffer>;
  stdin?: string | Buffer | Readable;
  tty?: boolean;
  env?: ContextOptions['env'];
  transport?: Partial<Transport>;
  realTransport?: boolean;
  signal?: AbortSignal;
  stdout?: Writable;
  credentials?: ContextOptions['credentials'];
}

export function createHarness(options: HarnessOptions = {}) {
  let out = '';
  let err = '';
  const requests: SystemOneRequest[] = [];
  const settings: Settings[] = [];
  const stdout = options.stdout ?? new Writable({ write(chunk, _encoding, callback) { out += String(chunk); callback(); } });
  const stderr = new Writable({ write(chunk, _encoding, callback) { err += String(chunk); callback(); } });
  const transport: Transport = {
    evaluate: async (value, signal) => {
      requests.push(structuredClone(value));
      return options.transport?.evaluate ? options.transport.evaluate(value, signal) : responseFor(value);
    },
    models: options.transport?.models ?? (async () => ({ models: [{ name: 'jev-latest', description: 'Jev', release_date: '2026-09-01' }] })),
  };
  const runtime: ContextOptions = {
    stdin: options.stdin instanceof Readable ? options.stdin : Readable.from(options.stdin === undefined ? [] : [options.stdin]),
    stdinIsTTY: options.tty ?? false,
    stdout, stderr, signal: options.signal,
    env: options.env ?? {},
    credentials: options.credentials,
    openFile(path) {
      if (!Object.hasOwn(options.files ?? {}, path)) throw Object.assign(new Error('Missing file'), { code: 'ENOENT' });
      return Readable.from([options.files![path]!]);
    },
    ...(options.realTransport ? {} : { createTransport: async (value: Settings) => { settings.push(value); return transport; } }),
  };
  return {
    requests, settings,
    get out() { return out; },
    get err() { return err; },
    async run(args: string[]) {
      const code = await runCli(args, runtime);
      return { code, out, err };
    },
  };
}
