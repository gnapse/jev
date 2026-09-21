import { Server, ProtocolError, type CallToolResult, type Tool } from '@modelcontextprotocol/server';
import type { Questions } from '@typesafe-ai/sdk';
import packageJson from '../../package.json' with { type: 'json' };
import { createSdkTransport, type Transport, withDeadline } from '../core/api.js';
import { evaluate, listModels, resolveRequest, validateRequest } from '../core/evaluate.js';
import { asJevError, cancelled, invalid } from '../core/errors.js';
import { schemas, validate } from '../core/schemas.js';
import type { Runtime, Settings } from '../core/settings.js';
import { Limiter } from '../core/limiter.js';
import { prepareBatchRecord, processBatch, type BatchResult } from '../core/batch.js';

const definitions = [
  { name: 'jev_ask', input: 'request', output: 'response', network: true,
    description: 'Ask typed questions about text or JSON using Jev. Combine independent Choice, Noul, and Score questions over the same state in one call. Returns all answers, probabilities, confidence where applicable, model, and token usage. Calls the TypeSafe API and consumes tokens.' },
  { name: 'jev_batch', input: 'mcp-batch-input', output: 'mcp-batch-result', network: true,
    description: 'Evaluate up to 100 records using Jev. Supply {id, request} records, or {id, state} records with shared questions. Results preserve input order and include 1-based index, id, and per-record success or error. Check summary.complete and each result. Calls consume TypeSafe tokens.' },
  { name: 'jev_models', input: 'mcp-empty', output: 'models', network: true,
    description: 'List model cards available to the configured TypeSafe account.' },
  { name: 'jev_validate', input: 'request', output: 'validation', network: false,
    description: 'Validate a Jev request offline and return prompting/model warnings. Does not evaluate the state, call the API, or require credentials.' },
] as const;

export const tools: Tool[] = definitions.map(tool => ({
  name: tool.name, description: tool.description,
  inputSchema: schemas[tool.input] as unknown as Tool['inputSchema'],
  outputSchema: schemas[tool.output] as Tool['outputSchema'],
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: tool.network,
    idempotentHint: !tool.network },
}));

export interface McpOptions {
  settings: Settings;
  runtime: Runtime;
  transport?: Transport;
}

function result(value: Record<string, unknown>, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, ...(isError ? { isError: true } : {}) };
}

/** Share one service across protocol instances, so all calls use the same limit. */
export function createMcpService(options: McpOptions) {
  const { settings, runtime } = options;
  const limiter = new Limiter(settings.concurrency);
  let activeCalls = 0;
  let transport: Promise<Transport> | undefined;
  const getTransport = () => {
    if (options.transport) return Promise.resolve(options.transport);
    transport ??= createSdkTransport(settings, runtime).catch(error => { transport = undefined; throw error; });
    return transport;
  };
  return async (name: string, args: unknown, clientSignal: AbortSignal): Promise<CallToolResult> => {
    const definition = definitions.find(tool => tool.name === name);
    if (!definition) throw new ProtocolError(-32602, 'Unknown tool. Use tools/list for available tools.');
    if (activeCalls >= 32) return result({ error: { code: 'BUSY', message: 'Too many outstanding tool calls. Retry later.', retryable: true } }, true);
    activeCalls++;
    const signal = AbortSignal.any([runtime.signal, clientSignal]);
    try {
      if (signal.aborted) throw cancelled();
      const input = args ?? {};
      if (Buffer.byteLength(JSON.stringify(input), 'utf8') > settings.maxInputBytes) invalid('Tool arguments exceed the configured input byte limit.');
      validate(definition.input, input);
      let value: Record<string, unknown>;
      if (name === 'jev_validate') value = validateRequest(resolveRequest(input, settings));
      else {
        const api = await getTransport();
        const callRuntime = { ...runtime, signal };
        // Include time waiting for the shared limiter in the call deadline.
        value = await withDeadline(callRuntime, settings, async deadlineSignal => {
          const scoped = { ...runtime, signal: deadlineSignal };
          const ask = (request: unknown, requestSignal = deadlineSignal) => limiter.run(requestSignal,
            () => evaluate(api, settings, resolveRequest(request, settings), { ...runtime, signal: requestSignal }));
          if (name === 'jev_ask') return { ...await ask(input) };
          if (name === 'jev_models') return limiter.run(deadlineSignal, () => listModels(api, settings, scoped));
          const batch = input as { records: unknown[]; questions?: Questions; fail_fast?: boolean };
          const results: BatchResult[] = [];
          const summary = await processBatch(async function* (inputSignal) {
            for (const [index, record] of batch.records.entries()) {
              inputSignal.throwIfAborted();
              yield prepareBatchRecord(record, index + 1, batch.questions);
            }
          }, ask, { concurrency: settings.concurrency, ordered: true, failFast: batch.fail_fast ?? false,
            signal: deadlineSignal }, async item => { results.push(item); });
          return { results, summary };
        });
      }
      validate(definition.output, value, false, true);
      return result(value);
    } catch (error) {
      const failure = signal.aborted ? cancelled() : asJevError(error);
      return result({ error: failure.body }, true);
    } finally { activeCalls--; }
  };
}

export function createMcpServer(call: ReturnType<typeof createMcpService>): Server {
  const server = new Server({ name: packageJson.name, version: packageJson.version }, {
    capabilities: { tools: {} },
    instructions: 'Jev returns typed judgments rather than generated prose. Group independent questions over one state with jev_ask. Preserve uncertainty and token usage; the caller decides what action to take. The server uses its configured TypeSafe account.',
  });
  server.setRequestHandler('tools/list', async () => ({ tools }));
  server.setRequestHandler('tools/call', async (request, context) => call(request.params.name, request.params.arguments, context.mcpReq.signal));
  return server;
}
