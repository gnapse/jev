import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

export async function verifyMcp(executable, { env, cwd, mode = 'legacy', offline = false }) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [executable, 'mcp', '--retries', '0', '--deadline-ms', '10000'], env, cwd, stderr: 'pipe' });
  let stderr = '';
  transport.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const client = new Client({ name: 'jev-package-test', version: '1.0.0' }, { versionNegotiation: { mode } });
  const request = { state: 'Please cancel my subscription.', questions: {
    cancel: { type: 'noul', instructions: 'Does this message request cancellation?' },
    team: { type: 'choice', criteria: { billing: 'Billing and subscription requests', other: 'Other requests' } },
    urgency: { type: 'score', instructions: 'How urgent is the request?', criteria: ['No deadline', 'Needs immediate action'] },
  } };
  try {
    await client.connect(transport, { timeout: 10000 });
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name), ['jev_ask', 'jev_batch', 'jev_models', 'jev_validate']);
    const valid = await client.callTool({ name: 'jev_validate', arguments: request });
    assert.equal(valid.structuredContent.valid, true);
    const evaluated = await client.callTool({ name: 'jev_ask', arguments: request });
    if (offline) {
      assert.equal(evaluated.isError, true);
      assert.equal(evaluated.structuredContent.error.code, 'AUTH_ERROR');
    } else {
      assert.notEqual(evaluated.isError, true);
      assert.equal(evaluated.structuredContent.answers.cancel.type, 'noul');
      assert.equal(evaluated.structuredContent.answers.team.type, 'choice');
      assert.equal(evaluated.structuredContent.answers.urgency.type, 'score');
      const models = await client.callTool({ name: 'jev_models', arguments: {} });
      assert(models.structuredContent.models.length > 0);
      const batch = await client.callTool({ name: 'jev_batch', arguments: {
        questions: request.questions, records: ['one', 'two'].map(id => ({ id, state: request.state })),
      } });
      assert.equal(batch.structuredContent.summary.succeeded, 2);
      assert.deepEqual(batch.structuredContent.results.map(item => [item.index, item.id]), [[1, 'one'], [2, 'two']]);
    }
    assert.equal(stderr, '');
    return { ok: true, tools: tools.map(tool => tool.name), model: evaluated.structuredContent.model,
      usage: evaluated.structuredContent.usage };
  } finally { await client.close(); await transport.close(); }
}
