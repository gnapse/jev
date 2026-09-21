import { addAbortSignal, type Readable } from 'node:stream';
import { parseTree, type ParseError } from 'jsonc-parser';
import type { Context } from './context.js';
import { invalid, ioError } from './errors.js';
import { JevError } from '../core/errors.js';

export const DEFAULT_MAX_INPUT_BYTES = 16 * 1024 * 1024;

export function parseJson(text: string): unknown {
  try {
    const errors: ParseError[] = [];
    const root = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
    if (!root || errors.length) invalid('Input must contain valid JSON, without comments or trailing commas.');
    const nodes = [root];
    while (nodes.length) {
      const node = nodes.pop()!;
      if (node.type === 'object') {
        const keys = new Set<string>();
        for (const property of node.children ?? []) {
          const key = property.children?.[0]?.value as string;
          if (keys.has(key)) invalid('JSON objects must not contain duplicate keys.');
          keys.add(key);
        }
      }
      if (node.type === 'number' && !Number.isFinite(node.value)) invalid('JSON numbers must be finite.');
      for (const child of node.children ?? []) nodes.push(child);
    }
    // JSON.parse preserves own properties such as __proto__; do not build objects by assignment.
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof JevError) throw error;
    invalid('Input must contain valid JSON within the parser nesting limit.');
  }
}

export function decode(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { invalid('Input must be valid UTF-8.'); }
}

export function openInput(context: Context, file: string, signal = context.signal): Readable {
  context.checkAborted();
  if (file === '-') {
    if (context.stdinClaimed) invalid('Only one input can read stdin.');
    if (context.runtime.stdinIsTTY) invalid('Stdin is a terminal. Provide a file or pipe input.');
    context.stdinClaimed = true;
  }
  try {
    return addAbortSignal(signal, file === '-' ? context.runtime.stdin : context.runtime.openFile(file));
  } catch (error) { throw ioError(error); }
}

export async function readText(context: Context, file: string, maxBytes: number): Promise<string> {
  const stream = openInput(context, file);
  const parts: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      bytes += part.length;
      if (bytes > maxBytes) invalid('Input exceeds --max-input-bytes.');
      parts.push(part);
    }
  } catch (error) {
    context.checkAborted();
    if (error instanceof JevError) throw error;
    throw ioError(error);
  }
  if (file === '-' && bytes === 0) invalid('Stdin is empty.');
  return decode(Buffer.concat(parts, bytes));
}

export async function readJson(context: Context, file: string, maxBytes: number): Promise<unknown> {
  return parseJson(await readText(context, file, maxBytes));
}

export interface InputLine { line: number; text?: string; error?: JevError }

/** Split bytes before decoding so even oversized or invalid UTF-8 lines stay bounded. */
export async function* readLines(context: Context, file: string, maxBytes: number, signal = context.signal): AsyncGenerator<InputLine> {
  const stream = openInput(context, file, signal);
  let parts: Buffer[] = [];
  let bytes = 0;
  let oversized = false;
  let line = 0;
  const append = (part: Buffer) => {
    bytes += part.length;
    if (bytes > maxBytes) { oversized = true; parts = []; }
    else if (!oversized && part.length) parts.push(part);
  };
  const finish = (): InputLine => {
    line++;
    try {
      if (oversized) invalid('JSONL line exceeds --max-input-bytes.');
      const text = decode(Buffer.concat(parts, bytes)).replace(/\r$/, '');
      return { line, text };
    } catch (error) {
      return { line, error: error as JevError };
    } finally { parts = []; bytes = 0; oversized = false; }
  };
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      let start = 0;
      for (let end = buffer.indexOf(10); end !== -1; end = buffer.indexOf(10, start)) {
        append(buffer.subarray(start, end));
        yield finish();
        context.checkAborted();
        start = end + 1;
      }
      append(buffer.subarray(start));
    }
    if (bytes || oversized) yield finish();
  } catch (error) {
    context.checkAborted();
    if (error instanceof JevError) throw error;
    throw ioError(error);
  }
}
