import { Ajv2020 } from 'ajv/dist/2020.js';
import type { AnySchema, ValidateFunction } from 'ajv';
import type { SystemOneRequest, SystemOneResult, Questions } from '@typesafe-ai/sdk';
import { JevError, invalid } from './errors.js';

export type Schema = Record<string, unknown>;
const string = { type: 'string' };
const nonempty = { type: 'string', minLength: 1 };
const positive = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const nonnegative = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const probability = { type: 'number', minimum: 0, maximum: 1 };
const entry = { type: ['string', 'object', 'array', 'null'] };
// The SDK's EntryType is broader than the live service at these two locations.
const nonNullEntry = { type: ['string', 'object', 'array'] };
const object = (properties: Schema, required: string[], additionalProperties: unknown = false): Schema =>
  ({ type: 'object', properties, required, additionalProperties });
const map = (value: unknown): Schema => ({ type: 'object', additionalProperties: value });

function questionsSchema(passthrough = false): Schema {
  return { type: 'object', minProperties: 1, additionalProperties: { oneOf: [
    object({ type: { const: 'choice' }, instructions: entry,
      criteria: { ...map(entry), minProperties: 1, maxProperties: 255 } }, ['type', 'criteria'], passthrough),
    object({ type: { const: 'score' }, instructions: entry,
      criteria: { type: 'array', items: nonNullEntry, minItems: 2, maxItems: 10 } }, ['type', 'criteria'], passthrough),
    object({ type: { const: 'noul' }, instructions: entry,
      criteria: { anyOf: [object({ true: entry, false: entry }, []), { type: 'null' }] } }, ['type'], passthrough),
  ] } };
}

function requestSchema(passthrough = false): Schema {
  return object({ state: nonNullEntry, model: nonempty, questions: questionsSchema(passthrough) },
    ['state', 'questions'], passthrough);
}

const answer = { oneOf: [
  object({ type: { const: 'noul' }, noul: probability }, ['type', 'noul'], true),
  object({ type: { const: 'choice' }, choice: string, confidence: probability,
    probabilities: map(probability) }, ['type', 'choice', 'confidence', 'probabilities'], true),
  object({ type: { const: 'score' }, score: { type: 'number', minimum: 0 }, confidence: probability,
    probabilities: map(probability), legend: map(entry) },
  ['type', 'score', 'confidence', 'probabilities', 'legend'], true),
] };

const response = object({ model: nonempty, answers: map(answer),
  usage: object({ input_tokens: nonnegative, output_tokens: nonnegative },
    ['input_tokens', 'output_tokens'], true) }, ['model', 'answers', 'usage'], true);
const error = object({ code: nonempty, message: nonempty, retryable: { type: 'boolean' },
  request_id: string,
  http_status: { type: 'integer', minimum: 100, maximum: 599 },
  details: { type: 'array', items: object({ path: string, rule: string }, ['path', 'rule']) } },
['code', 'message', 'retryable']);
const config = object({ model: nonempty, base_url: nonempty, timeout_ms: positive,
  deadline_ms: positive, concurrency: positive, max_input_bytes: positive, headers: map(string),
  retry: object({ maxRetries: nonnegative, apiConnectionError: { type: 'boolean' },
    apiTimeoutError: { type: 'boolean' }, backoffInitialMs: nonnegative, backoffMaxMs: nonnegative,
    backoffJitter: probability, respectRetryAfter: { type: 'boolean' }, maxRetryAfterMs: nonnegative,
    httpStatuses: { type: 'array', uniqueItems: true,
      items: { type: 'integer', minimum: 100, maximum: 599 } } }, []) }, []);
const batchBase = { line: positive, id: { type: ['string', 'null'] } };
const commandDescription = object({ name: nonempty, description: string,
    arguments: { type: 'array', items: string }, flags: { type: 'array', items:
      object({ flags: string, description: string }, ['flags', 'description']) },
    input_schemas: { type: 'array', items: string }, output_schema: string,
    network: { type: 'boolean' }, stdin: string,
    subcommands: { type: 'array', items: { $ref: '#/$defs/command' } } },
  ['name', 'description', 'arguments', 'flags', 'input_schemas', 'output_schema']);
const description = { ...object({ cli_version: nonempty, contract_version: positive,
  commands: { type: 'array', items: { $ref: '#/$defs/command' } },
  stdin_rules: { type: 'array', items: string }, environment: map(string), exit_codes: map(string),
  schema_names: { type: 'array', items: string } },
['cli_version', 'contract_version', 'commands', 'stdin_rules', 'environment', 'exit_codes', 'schema_names']),
  $defs: { command: commandDescription } };

const authSource = { enum: ['environment', 'file', 'none'] };

const definitions: Record<string, Schema> = {
  request: requestSchema(), questions: questionsSchema(), response, config, error, description,
  'auth-status': object({ configured: { type: 'boolean' }, source: authSource, path: nonempty }, ['configured', 'source', 'path']),
  'auth-login': object({ saved: { const: true }, verified: { const: true }, source: { enum: ['environment', 'file'] }, path: nonempty },
    ['saved', 'verified', 'source', 'path']),
  'auth-logout': object({ removed: { type: 'boolean' }, configured: { type: 'boolean' }, source: { enum: ['environment', 'none'] }, path: nonempty },
    ['removed', 'configured', 'source', 'path']),
  validation: object({ valid: { const: true }, warnings: { type: 'array', items: string } }, ['valid', 'warnings']),
  'json-schema': { type: 'object' },
  models: object({ models: { type: 'array', items: object({ name: nonempty,
    description: string, release_date: string }, ['name', 'description', 'release_date'], true) } }, ['models'], true),
  'batch-state-record': object({ id: nonempty, state: nonNullEntry }, ['id', 'state']),
  'batch-request-record': object({ id: nonempty, request: requestSchema() }, ['id', 'request']),
  'batch-result': { oneOf: [
    object({ ...batchBase, ok: { const: true }, response }, ['line', 'id', 'ok', 'response']),
    object({ ...batchBase, ok: { const: false }, error }, ['line', 'id', 'ok', 'error']),
  ] },
};
definitions['mcp-empty'] = object({}, []);
definitions['mcp-protocol'] = {
  ...object({ jsonrpc: { const: '2.0' } }, ['jsonrpc'], true),
  description: 'MCP JSON-RPC envelope. The full protocol is defined at https://modelcontextprotocol.io/specification/.',
};
definitions['mcp-batch-input'] = {
  ...object({ records: { type: 'array', minItems: 1, maxItems: 100 }, questions: questionsSchema(),
    fail_fast: { type: 'boolean' } }, ['records']),
  oneOf: [
    { required: ['questions'], properties: { records: { type: 'array', items: definitions['batch-state-record'] } } },
    { not: { required: ['questions'] }, properties: { records: { type: 'array', items: definitions['batch-request-record'] } } },
  ],
};
definitions['mcp-batch-result'] = object({
  results: { type: 'array', items: { oneOf: [
    object({ index: positive, id: { type: ['string', 'null'] }, ok: { const: true }, response }, ['index', 'id', 'ok', 'response']),
    object({ index: positive, id: { type: ['string', 'null'] }, ok: { const: false }, error }, ['index', 'id', 'ok', 'error']),
  ] } },
  summary: object({ type: { const: 'batch_summary' }, consumed: nonnegative, succeeded: nonnegative,
    failed: nonnegative, complete: { type: 'boolean' }, usage: (response.properties as Schema).usage },
  ['type', 'consumed', 'succeeded', 'failed', 'complete', 'usage']),
}, ['results', 'summary']);
export const schemas = Object.fromEntries(Object.entries(definitions).map(([name, schema]) =>
  [name, { $schema: 'https://json-schema.org/draft/2020-12/schema', title: `@gnapse/jev ${name}`, ...schema }]));
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, ownProperties: true });
const validators = new Map<string, ValidateFunction>();

export function validate(name: string, value: unknown, passthrough = false, output = false): void {
  const key = `${name}:${passthrough}`;
  let check = validators.get(key);
  if (!check) {
    let schema: Schema | undefined = schemas[name];
    if (passthrough && name === 'request') schema = requestSchema(true);
    if (passthrough && name === 'questions') schema = questionsSchema(true);
    if (passthrough && name === 'batch-request-record') {
      schema = object({ id: nonempty, request: requestSchema(true) }, ['id', 'request']);
    }
    if (!schema) invalid('Unknown schema name. Use jev describe to list schemas.');
    check = ajv.compile(schema as AnySchema);
    validators.set(key, check);
  }
  if (!check(value)) {
    throw new JevError({
      code: output ? 'INVALID_RESPONSE' : 'INVALID_INPUT',
      message: `Data does not match the ${name} schema.`, retryable: false,
      details: (check.errors ?? []).slice(0, 12).map(e => ({ path: e.instancePath, rule: e.keyword })),
    });
  }
}

export function checkResponse(value: unknown, request: SystemOneRequest): asserts value is SystemOneResult<Questions> {
  validate('response', value, false, true);
  const result = value as SystemOneResult<Questions>;
  const mismatch = () => { throw new JevError({ code: 'INVALID_RESPONSE',
    message: 'The response does not match the requested questions or criteria.', retryable: false }); };
  const sameKeys = (a: object, keys: string[]) => {
    const actual = Object.keys(a);
    return actual.length === keys.length && keys.every(k => Object.hasOwn(a, k));
  };
  if (!sameKeys(result.answers, Object.keys(request.questions))) mismatch();
  for (const [id, question] of Object.entries(request.questions)) {
    const a = result.answers[id]!;
    if (a.type !== question.type) mismatch();
    if (a.type === 'noul') continue;
    const keys = question.type === 'choice' ? Object.keys(question.criteria)
      : (question as { criteria: readonly unknown[] }).criteria.map((_, i) => String(i));
    if (!sameKeys(a.probabilities, keys)) mismatch();
    const sum = Object.values(a.probabilities).reduce((n, p) => n + p, 0);
    if (Math.abs(sum - 1) > 0.01) mismatch();
    if (a.type === 'choice' && !keys.includes(a.choice)) mismatch();
    if (a.type === 'score' && (a.score > keys.length - 1 || !sameKeys(a.legend, keys))) mismatch();
  }
}

export function warnings(questions: Questions, model?: string): string[] {
  const result: string[] = [];
  if (Object.values(questions).some(q => q.instructions == null)) result.push('Some questions have absent or null instructions; make sure the criteria alone state the intended judgment.');
  if (model?.endsWith('-latest') || model?.endsWith('-preview')) result.push('The model alias can change. Pin a versioned model for repeatable automation.');
  return result;
}
