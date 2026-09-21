import { describe, expect, it } from 'vitest';
import { createHarness, questions, request, responseFor } from '../../test-support/harness.js';

describe('ask', () => {
  it('preserves structured mixed questions and additive response fields', async () => {
    const mixed = { state: { text: '¿Necesitas ayuda? 東京', count: 2 }, questions: {
      ...questions,
      team: { type: 'choice', instructions: { question: 'Which team?', focus: ['text'] }, criteria: { support: { handles: ['help'] }, other: null } },
      impact: { type: 'score', instructions: 'How severe?', criteria: [{ level: 'small' }, { level: 'large' }] },
    } };
    const h = createHarness({ stdin: JSON.stringify(mixed), transport: { evaluate: async value => ({ ...responseFor(value), trace: 'retained' }) } });
    const result = await h.run(['ask', '--request', '-']);
    expect(result.code).toBe(0);
    expect(result.err).toBe('');
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]).toEqual({ ...mixed, model: 'jev-latest' });
    expect(JSON.parse(result.out).trace).toBe('retained');
    expect(JSON.parse(result.out).answers.impact.legend['0']).toEqual({ level: 'small' });
  });

  it('preserves string whitespace and reads JSON state only when requested', async () => {
    const files = { q: JSON.stringify(questions) };
    for (const args of [['--state', '{"message":"hi"}'], ['--state-file', '-', '--state-format', 'text']]) {
      const h = createHarness({ files, stdin: ' \nhi\n ' });
      expect((await h.run(['ask', '--questions', 'q', ...args])).code).toBe(0);
      expect(typeof h.requests[0]?.state).toBe('string');
    }
    const h = createHarness({ files, stdin: '{"message":"hi"}' });
    await h.run(['ask', '--questions', 'q', '--state-file', '-', '--state-format', 'json']);
    expect(h.requests[0]?.state).toEqual({ message: 'hi' });
  });

  it('dry-run needs no credential or transport and equals the submitted request', async () => {
    const h = createHarness({ stdin: JSON.stringify(request), realTransport: true });
    const result = await h.run(['ask', '--request', '-', '--dry-run', '--model', 'jev-1.13.0']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual({ ...request, model: 'jev-1.13.0' });
  });

  it.each([
    ['ask', '--request', 'r', '--state', 'hi'],
    ['ask', '--questions', '-', '--state-file', '-'],
    ['ask', '--questions', 'q', '--state', 'hi', '--state-format', 'json'],
    ['ask'],
  ].map(args => ({ args })))('rejects ambiguous inputs without inference: $args', async ({ args }) => {
    const h = createHarness({ files: { r: JSON.stringify(request), q: JSON.stringify(questions) } });
    expect((await h.run(args)).code).toBe(2);
    expect(h.requests).toHaveLength(0);
  });

  it('requires passthrough for unknown request and question fields', async () => {
    const value = { ...request, extension: null, questions: { flag: { ...questions.flag, future: { mode: 'a' } } } };
    for (const pass of [false, true]) {
      const h = createHarness({ stdin: JSON.stringify(value) });
      const result = await h.run(['ask', '--request', '-', ...(pass ? ['--passthrough'] : [])]);
      expect(result.code).toBe(pass ? 0 : 2);
      if (pass) expect(h.requests[0]).toEqual({ ...value, model: 'jev-latest' });
    }
  });

  it('fails malformed provider answers without partial stdout', async () => {
    const h = createHarness({ stdin: JSON.stringify(request), transport: { evaluate: async value => ({ ...responseFor(value), answers: {} }) } });
    const result = await h.run(['ask', '--request', '-']);
    expect(result.code).toBe(8);
    expect(result.out).toBe('');
  });

  it('does not turn low probability or confidence into a process failure', async () => {
    const h = createHarness({ stdin: JSON.stringify(request), transport: { evaluate: async value => ({ ...responseFor(value), answers: { flag: { type: 'noul', noul: 0.1 } } }) } });
    expect((await h.run(['ask', '--request', '-'])).code).toBe(0);
  });
});
