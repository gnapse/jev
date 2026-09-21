import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { verifyMcp } from './mcp-smoke.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
// Explicit developer test entry point. The distributed CLI never searches for .env.
try { await access(envFile); process.loadEnvFile(envFile); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not load the local .env file.'); }

if (!process.env.TYPESAFE_API_KEY?.trim()) {
  console.error('Set TYPESAFE_API_KEY in the environment, or copy .env.example to .env and fill it in.');
  process.exitCode = 3;
} else {
  const exec = promisify(execFile);
  const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
  const run = async args => {
    try { return await exec(process.execPath, [cli, ...args], { cwd: root, env: process.env, maxBuffer: 2 * 1024 * 1024 }); }
    catch (error) {
      // CLI diagnostics are structured and omit keys, input state, and response bodies.
      if (error.stderr) process.stderr.write(error.stderr);
      throw new Error(`Live command failed: jev ${args[0]}`);
    }
  };
  try {
    const models = JSON.parse((await run(['models'])).stdout);
    assert(Array.isArray(models.models));
    const result = JSON.parse((await run(['ask', '--questions', 'examples/triage.questions.json', '--state-file', 'examples/ticket.json', '--state-format', 'json'])).stdout);
    assert.equal(result.answers.team.type, 'choice');
    assert.equal(result.answers.urgent.type, 'noul');
    assert.equal(result.answers.impact.type, 'score');
    const batch = await run(['batch', '--input', 'examples/tickets.jsonl', '--questions', 'examples/triage.questions.json', '--ordered', '--concurrency', '2', '--model', result.model]);
    const records = batch.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(records.length, 3);
    assert(records.every(record => record.ok));
    const fixturePath = 'test/fixtures/compatibility.requests.jsonl';
    const compatibility = await run(['batch', '--input', fixturePath, '--model', result.model, '--ordered', '--concurrency', '2']);
    const compatible = compatibility.stdout.trim().split('\n').map(line => JSON.parse(line));
    const fixtures = (await readFile(new URL(`../${fixturePath}`, import.meta.url), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(compatible.length, fixtures.length);
    assert(compatible.every(record => record.ok));
    const structured = compatible.find(record => record.id === 'structured-score');
    const structuredRequest = fixtures.find(record => record.id === 'structured-score').request;
    assert.deepEqual(Object.values(structured.response.answers.impact.legend), structuredRequest.questions.impact.criteria);
    const mcp = await verifyMcp(cli, { cwd: root, env: process.env });
    console.log(JSON.stringify({ ok: true, model: result.model, models_listed: models.models.length, mcp,
      single_request_usage: result.usage, batch: JSON.parse(batch.stderr),
      compatibility: { cases: compatible.map(record => record.id), summary: JSON.parse(compatibility.stderr) } }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
