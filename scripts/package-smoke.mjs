import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { verifyMcp } from './mcp-smoke.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'jev-package-'));
const npmPath = process.env.npm_execpath;
assert(npmPath, 'Run this script through npm run test:package.');
const runNpm = (args, cwd = root) => exec(process.execPath, [npmPath, ...args], { cwd, maxBuffer: 2 * 1024 * 1024 });
const env = { ...process.env };
for (const key of ['TYPESAFE_API_KEY', 'TYPESAFE_BASE_URL', 'TYPESAFE_DEFAULT_MODEL', 'TYPESAFE_LOG_LEVEL']) delete env[key];
// Tests must never read or replace the developer's saved credentials.
env.XDG_CONFIG_HOME = join(temp, 'config');
env.APPDATA = join(temp, 'config');
let server;

try {
  const packed = JSON.parse((await runNpm(['pack', '--json', '--ignore-scripts', '--pack-destination', temp])).stdout)[0];
  const paths = packed.files.map(file => file.path);
  assert(paths.includes('dist/index.js'));
  assert(paths.includes('dist/mcp/server.js'));
  assert(paths.includes('dist/mcp/index.js'));
  assert(paths.includes('dist/mcp/index.d.ts'));
  assert(paths.includes('schemas/request.json'));
  assert(paths.includes('skills/jev/SKILL.md'));
  assert(paths.every(path => !path.startsWith('examples/')), 'Repository examples must not be distributed');
  assert(paths.includes('README.md'));
  assert(paths.includes('docs/cli.md'));
  assert(paths.includes('docs/mcp.md'));
  assert(paths.includes('CONTRIBUTING.md'));
  assert(paths.every(path => !/(^|\/)(\.env[^/]*|node_modules|test-support|reports)(\/|$)|\.test\.[^/]+$/.test(path)), 'Unexpected private, report, or test files in package');
  const install = join(temp, 'install');
  await mkdir(install);
  await runNpm(['install', '--prefix', install, '--omit=dev', '--ignore-scripts', '--package-lock=false', '--no-audit', '--no-fund', join(temp, packed.filename)], install);
  const executable = join(install, 'node_modules', ...packed.name.split('/'), 'dist', 'index.js');
  const installedSkill = join(install, 'node_modules', ...packed.name.split('/'), 'skills', 'jev', 'SKILL.md');
  assert.equal(await readFile(installedSkill, 'utf8'), await readFile(join(root, 'skills', 'jev', 'SKILL.md'), 'utf8'));
  const cli = (args, extraEnv = {}, input) => {
    const pending = exec(process.execPath, [executable, ...args], { cwd: install, env: { ...env, ...extraEnv }, maxBuffer: 2 * 1024 * 1024 });
    if (input !== undefined) pending.child.stdin.end(input);
    return pending;
  };
  assert.equal((await cli(['--version'])).stdout.trim(), packed.version);
  assert.equal((await runNpm(['exec', '--offline', '--prefix', install, '--', 'jev', '--version'], install)).stdout.trim(), packed.version);
  const description = JSON.parse((await cli(['describe'])).stdout);
  assert.equal(description.commands.length, 11);
  assert.equal(JSON.parse((await cli(['schema', 'request'])).stdout).type, 'object');
  // Resolve the public ESM entry point from a fresh install, without invoking
  // the executable or relying on source/deep imports.
  await exec(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import { createJevMcpServerFactory } from '@gnapse/jev/mcp';
    import { createMcpHandler } from '@modelcontextprotocol/server';
    import schema from '@gnapse/jev/schemas/request.json' with { type: 'json' };
    assert.equal(schema.type, 'object');
    const handler = createMcpHandler(createJevMcpServerFactory());
    try {
      const response = await handler.fetch(new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      }));
      assert.equal(response.status, 200);
      const body = await response.text();
      for (const name of ['jev_ask', 'jev_batch', 'jev_models', 'jev_validate']) assert(body.includes(name));
    } finally { await handler.close(); }
  `], { cwd: install, env, maxBuffer: 2 * 1024 * 1024 });
  // Supply fixtures from the repository to the independently installed CLI.
  const examples = join(root, 'examples');
  const example = join(examples, 'triage.request.json');
  assert.equal(JSON.parse((await cli(['validate', '--request', example])).stdout).valid, true);
  assert.deepEqual(JSON.parse((await cli(['ask', '--request', example, '--dry-run'])).stdout), JSON.parse(await readFile(example, 'utf8')));

  let calls = 0;
  server = createServer(async (req, res) => {
    try {
      calls++;
      assert.equal(req.headers.authorization, 'Bearer package-test-key');
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/models') {
        res.end(JSON.stringify({ models: [{ name: 'jev-latest', description: 'Test model', release_date: '2026-09-21' }] }));
        return;
      }
      assert.equal(req.url, '/v1/systemone');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
        if (question.type === 'noul') return [id, { type: 'noul', noul: 0.8 }];
        const keys = question.type === 'choice' ? Object.keys(question.criteria) : question.criteria.map((_, i) => String(i));
        const probabilities = Object.fromEntries(keys.map((key, i) => [key, i === 0 ? 1 : 0]));
        return [id, question.type === 'choice'
          ? { type: 'choice', choice: keys[0], confidence: 1, probabilities }
          : { type: 'score', score: 0, confidence: 1, probabilities, legend: Object.fromEntries(question.criteria.map((level, i) => [String(i), level])) }];
      }));
      res.end(JSON.stringify({ model: 'jev-package-test', answers, usage: { input_tokens: 20, output_tokens: 4 } }));
    } catch { res.destroy(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const apiEnv = { TYPESAFE_API_KEY: 'package-test-key', TYPESAFE_BASE_URL: `http://127.0.0.1:${server.address().port}` };
  assert.equal(JSON.parse((await cli(['models'], apiEnv)).stdout).models.length, 1);
  const result = await cli(['ask', '--request', example], apiEnv);
  assert.equal(result.stderr, '');
  assert.deepEqual(Object.keys(JSON.parse(result.stdout).answers), ['team', 'urgent', 'impact']);
  const batch = await cli(['batch', '--input', join(examples, 'tickets.jsonl'), '--questions', join(examples, 'triage.questions.json'), '--ordered'], apiEnv);
  assert.equal(batch.stdout.trim().split('\n').length, 3);
  assert.equal(JSON.parse(batch.stderr).succeeded, 3);
  assert.equal(calls, 5);
  // Repository-only example scripts use the checkout build. Exercise them from
  // another working directory against the same mock API.
  const runExample = args => exec(process.execPath, args, {
    cwd: install, env: { ...env, ...apiEnv }, maxBuffer: 2 * 1024 * 1024,
  });
  const exampleReport = JSON.parse((await runExample([join(examples, 'run.mjs'), 'all'])).stdout);
  assert.equal(exampleReport.requests, 23);
  assert.equal(exampleReport.runs.length, 5);
  const search = JSON.parse((await runExample([join(examples, 'semantic-search', 'run.mjs'),
    'How do I read JSON?', join(examples, 'semantic-search', 'guide.txt')])).stdout);
  assert.equal(search.hits.length, 1);
  assert.equal(search.hits[0].response.model, 'jev-package-test');
  const extraction = JSON.parse((await runExample([join(examples, 'extract-email', 'run.mjs'),
    join(examples, 'extract-email', 'message.txt')])).stdout);
  assert(extraction.candidates.includes(extraction.email));
  assert.equal(calls, 30);
  await verifyMcp(executable, { cwd: install, env: { ...env, ...apiEnv } });
  await verifyMcp(executable, { cwd: install, env: { ...env, ...apiEnv }, mode: { pin: '2026-07-28' } });
  assert.equal(calls, 38);
  await verifyMcp(executable, { cwd: install, env, offline: true });
  assert.equal(JSON.parse((await cli(['auth', 'status'])).stdout).configured, false);
  const loggedIn = await cli(['auth', 'login', '--stdin'], { ...apiEnv, TYPESAFE_API_KEY: 'overridden-key' }, 'package-test-key\n');
  assert.equal(JSON.parse(loggedIn.stdout).saved, true);
  assert(!(loggedIn.stdout + loggedIn.stderr).includes('package-test-key'));
  const savedEnv = { TYPESAFE_BASE_URL: apiEnv.TYPESAFE_BASE_URL };
  assert.equal(JSON.parse((await cli(['auth', 'status'])).stdout).source, 'file');
  assert.equal(JSON.parse((await cli(['models'], savedEnv)).stdout).models.length, 1);
  await verifyMcp(executable, { cwd: install, env: { ...env, ...savedEnv } });
  await verifyMcp(executable, { cwd: install, env: { ...env, ...savedEnv }, mode: { pin: '2026-07-28' } });
  assert.equal(calls, 48);
  assert.equal(JSON.parse((await cli(['auth', 'logout'])).stdout).removed, true);
  await assert.rejects(cli(['models'], savedEnv), error => error.code === 3 && JSON.parse(error.stderr).error.code === 'AUTH_ERROR');
  assert.equal(JSON.parse((await cli(['models'], apiEnv)).stdout).models.length, 1);
  // A client may close stdin without an MCP handshake. The server must exit.
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [executable, 'mcp'], { cwd: install, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { child.kill(); reject(new Error('MCP did not exit on stdin EOF')); }, 5000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`MCP EOF exit ${code}`)); });
    child.stdin.end();
  });
  console.log(`Package smoke passed: ${packed.name}@${packed.version}, ${paths.length} files, ${packed.size} bytes packed; fresh install and mock-API calls verified.`);
} finally {
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await rm(temp, { recursive: true, force: true });
}
