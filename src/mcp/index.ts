import type { Server } from '@modelcontextprotocol/server';
import { resolveSettings, type FileConfig } from '../core/settings.js';
import { createMcpServer, createMcpService } from './server.js';

/** Explicit server configuration, using the same fields as a Jev JSON config. */
export type JevMcpConfig = FileConfig;

export interface JevMcpOptions {
  /** The host supplies credentials. No environment variables or files are read. */
  apiKey?: string;
  config?: JevMcpConfig;
  /** Aborting this signal cancels work across every server made by the factory. */
  signal?: AbortSignal;
  /** Optional diagnostics omit credentials and request/response bodies. */
  log?: (event: Record<string, unknown>) => void | Promise<void>;
}

/**
 * Create once per account/workload, then pass the returned factory to an MCP SDK
 * transport. Each invocation returns a fresh protocol server; all instances
 * share API concurrency and outstanding-call limits. No transport is started.
 */
export function createJevMcpServerFactory(options: JevMcpOptions = {}): () => Server {
  const settings = resolveSettings({ TYPESAFE_API_KEY: options.apiKey }, options.config ?? {});
  const call = createMcpService({
    settings,
    runtime: { signal: options.signal ?? new AbortController().signal, log: options.log },
  });
  return () => createMcpServer(call);
}
