import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { validate } from '../src/core/schemas.ts';
import { parseJson } from '../src/cli/input.ts';
import { buildRequest, extractEmail, interpret } from '../examples/extract-email/extract.mjs';
import { chunks } from '../examples/semantic-search/search.mjs';

const read = path => readFile(new URL(`../examples/${path}`, import.meta.url), 'utf8');
const response = (choice, probabilities, confidence = 1) => ({
  answers: { destination: { type: 'choice', choice, probabilities, confidence } },
});

describe('runnable examples', () => {
  it.each(['ci-triage', 'verify-claims', 'semantic-search', 'diff-checks'])('%s fixtures match the CLI contract and expectations', async workflow => {
    const questions = parseJson(await read(`${workflow}/questions.json`));
    validate('questions', questions);
    const expected = parseJson(await read(`${workflow}/expected.json`));
    const records = (await read(`${workflow}/cases.jsonl`)).trim().split('\n').map(parseJson);
    expect(records.map(record => record.id)).toEqual(Object.keys(expected));
    for (const record of records) {
      validate('batch-state-record', record);
      validate('request', { state: record.state, questions, model: 'jev-1.13.0' });
      for (const id of Object.keys(expected[record.id])) expect(Object.hasOwn(questions, id)).toBe(true);
    }
  });

  it('builds valid requests for each extraction fixture', async () => {
    for (const sample of JSON.parse(await read('extract-email/cases.json'))) {
      const { request } = buildRequest(sample.document);
      if (request) validate('request', request);
    }
  });

  it('returns no candidates without any API call', async () => {
    expect(await extractEmail('Please post the receipt.')).toMatchObject({
      status: 'not_found', email: null, candidates: [], response: null,
    });
  });

  it('copies a selected original value without changing its case or punctuation', () => {
    const { candidates } = buildRequest('To: Billing@example.com. Use Me+Travel@example.com for the receipt.');
    expect(interpret(candidates, response('email_1', { email_0: 0.02, email_1: 0.95, none: 0.02, unclear: 0.01 })))
      .toMatchObject({ status: 'selected', email: 'Me+Travel@example.com' });
  });

  it('retains uncertainty and unknown selections for review', () => {
    const candidates = ['a@example.com', 'b@example.com'];
    expect(interpret(candidates, response('email_0', { email_0: 0.51, email_1: 0.49 })))
      .toMatchObject({ status: 'review', email: null });
    expect(interpret(candidates, response('unclear', { unclear: 1 })))
      .toMatchObject({ status: 'review', email: null });
    expect(interpret(candidates, response('email_99', { email_99: 1 })))
      .toMatchObject({ status: 'review', email: null });
  });

  it('distinguishes confident absence from an uncertain selection', () => {
    expect(interpret(['a@example.com'], response('none', { none: 0.96, email_0: 0.04 })))
      .toMatchObject({ status: 'not_found', email: null });
    expect(interpret(['a@example.com'], response('none', { none: 0.55, email_0: 0.45 })))
      .toMatchObject({ status: 'review', email: null });
  });

  it('reserves fallback options within the model candidate limit', () => {
    const document = Array.from({ length: 254 }, (_, i) => `u${i}@example.com`).join(' ');
    expect(() => buildRequest(document)).toThrow('Too many candidates');
  });

  it('preserves file positions and overlapping context for semantic search', () => {
    const text = Array.from({ length: 65 }, (_, i) => `line ${i + 1}`).join('\r\n');
    const result = chunks('guide with spaces.md', text, 'query');
    expect(result.map(state => [state.candidate.start_line, state.candidate.end_line])).toEqual([[1, 30], [21, 50], [41, 65]]);
    expect(result[1].candidate.text).toContain('line 30\nline 31');
    expect(result[2].candidate.text.endsWith('line 65')).toBe(true);
    expect(chunks('empty', '\n', 'query')).toEqual([]);
  });
});
