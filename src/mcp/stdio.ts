import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { Readable, Writable } from 'node:stream';
import { cancelled } from '../core/errors.js';
import { createMcpServer, createMcpService, type McpOptions } from './server.js';

export async function runStdio(options: McpOptions & { stdin: Readable; stdout: Writable }): Promise<void> {
  const controller = new AbortController();
  const signal = AbortSignal.any([options.runtime.signal, controller.signal]);
  const call = createMcpService({ ...options, runtime: { ...options.runtime, signal } });
  const transport = new StdioServerTransport(options.stdin, options.stdout, { maxBufferSize: options.settings.maxInputBytes });
  let finish!: () => void;
  const ended = new Promise<void>(resolve => { finish = resolve; });
  // serveStdio owns onclose; wrapping close observes both EOF and protocol teardown.
  const close = transport.close.bind(transport);
  transport.close = async () => { controller.abort(cancelled()); await close(); finish(); };
  const handle = serveStdio(() => createMcpServer(call), { transport,
    onerror: () => { void options.runtime.log?.({ type: 'mcp_error', message: 'MCP transport or protocol error.' }); },
  });
  const stop = () => { void handle.close().finally(finish); };
  options.runtime.signal.addEventListener('abort', stop, { once: true });
  // The SDK transport does not own the caller's stream lifecycle.
  options.stdin.once('end', stop);
  options.stdin.once('close', stop);
  try {
    if (options.runtime.signal.aborted || options.stdin.readableEnded || options.stdin.destroyed) stop();
    await ended;
  } finally {
    options.runtime.signal.removeEventListener('abort', stop);
    options.stdin.off('end', stop);
    options.stdin.off('close', stop);
    await handle.close();
  }
}
