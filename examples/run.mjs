import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runCli } from './_lib/cli.mjs';
import { compare } from './_lib/checks.mjs';
import { extractEmail } from './extract-email/extract.mjs';

const workflows = ['ci-triage', 'verify-claims', 'semantic-search', 'diff-checks', 'extract-email'];
const [name = 'all', ...flags] = process.argv.slice(2);
const file = path => new URL(path, import.meta.url);
const load = async path => JSON.parse(await readFile(file(path), 'utf8'));
const model = 'jev-1.13.0';

try {
  if ((name !== 'all' && !workflows.includes(name)) || flags.some(flag => flag !== '--check')) {
    throw new Error(`Usage: node examples/run.mjs [all|${workflows.join('|')}] [--check]`);
  }
  const report = { tested_at: new Date().toISOString(), model,
    note: 'Synthetic demonstration cases, not a production accuracy benchmark. Thresholds are illustrative.',
    usage: { input_tokens: 0, output_tokens: 0 }, requests: 0, checks: { passed: 0, failed: 0 }, runs: [] };
  for (const workflow of name === 'all' ? workflows : [name]) {
    const start = performance.now();
    let cases;
    if (workflow === 'extract-email') {
      cases = [];
      for (const sample of await load('extract-email/cases.json')) {
        const result = await extractEmail(sample.document, model);
        const checks = Object.entries(sample.expected).map(([field, expected]) => ({
          field, expected, actual: result[field], pass: result[field] === expected,
        }));
        cases.push({ id: sample.id, ...result, checks });
      }
    } else {
      const expected = await load(`${workflow}/expected.json`);
      const { stdout } = await runCli(['batch', '--input', fileURLToPath(file(`${workflow}/cases.jsonl`)),
        '--questions', fileURLToPath(file(`${workflow}/questions.json`)),
        '--model', model, '--concurrency', '2', '--ordered']);
      cases = stdout.trim().split('\n').map(line => {
        const result = JSON.parse(line);
        if (!result.ok) throw new Error(`An example record failed: ${result.id}`);
        return { ...result, checks: compare(result.response.answers, expected[result.id]) };
      });
    }
    const elapsed_ms = Math.round(performance.now() - start);
    for (const result of cases) {
      if (result.response) {
        report.requests++;
        report.usage.input_tokens += result.response.usage.input_tokens;
        report.usage.output_tokens += result.response.usage.output_tokens;
      }
      for (const check of result.checks) report.checks[check.pass ? 'passed' : 'failed']++;
    }
    report.runs.push({ workflow, elapsed_ms, cases });
    console.error(`${workflow}: ${cases.length} cases in ${elapsed_ms} ms`);
  }
  console.log(JSON.stringify(report, null, 2));
  if (flags.includes('--check') && report.checks.failed) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
