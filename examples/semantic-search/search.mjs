import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runCli } from '../_lib/cli.mjs';

export function chunks(path, text, query) {
  const lines = text.split(/\r?\n/);
  const result = [];
  for (let start = 0; start < lines.length; start += 20) {
    const end = Math.min(start + 30, lines.length);
    const content = lines.slice(start, end).join('\n');
    if (content.trim()) result.push({ query,
      candidate: { path, start_line: start + 1, end_line: end, text: content } });
    if (end === lines.length) break;
  }
  return result;
}

export async function search(query, paths) {
  const states = [];
  for (const path of paths) {
    if ((await stat(path)).size > 256 * 1024) throw new Error('Use text files no larger than 256 KiB.');
    const buffer = await readFile(path);
    if (buffer.includes(0)) throw new Error('Binary files are not supported.');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    states.push(...chunks(path, text, query));
    if (states.length > 32) throw new Error('More than 32 passages; narrow the file list or input first.');
  }
  if (!states.length) return { policy: { minimumAnswerProbability: 0.8 }, hits: [] };
  const input = states.map((state, index) => JSON.stringify({ id: String(index), state })).join('\n');
  const { stdout } = await runCli(['batch', '--input', '-', '--questions',
    fileURLToPath(new URL('questions.json', import.meta.url)), '--model', 'jev-1.13.0', '--concurrency', '2'], input);
  const hits = stdout.trim().split('\n').map(line => {
    const record = JSON.parse(line);
    if (!record.ok) throw new Error('Search did not complete; inspect the failed batch record.');
    return { ...states[Number(record.id)].candidate,
      relevance: record.response.answers.relevance.score,
      answers_query: record.response.answers.answers_query.noul,
      has_answer: record.response.answers.answers_query.noul >= 0.8,
      response: record.response };
  }).sort((a, b) => b.relevance - a.relevance);
  return { policy: { minimumAnswerProbability: 0.8 }, hits };
}
