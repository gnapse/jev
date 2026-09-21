import { describe, expect, it } from 'vitest';
import { createHarness } from '../../test-support/harness.js';

describe('primitive request builders', () => {
  it.each([
    { args: ['choice', 'Where?', '--option', 'a=b,c', '--option', 'other'], type: 'choice', criteria: { 'a=b,c': null, other: null } },
    { args: ['noul', 'Is it true?', '--yes', 'Yes definition', '--no', 'No definition'], type: 'noul', criteria: { true: 'Yes definition', false: 'No definition' } },
    { args: ['score', 'How much?', '--level', 'Small', '--level', 'Large'], type: 'score', criteria: ['Small', 'Large'] },
  ])('builds $type through the shared pipeline', async ({ args, type, criteria }) => {
    const result = await createHarness({ stdin: 'source' }).run([...args, '--id', 'answer', '--dry-run']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual({ state: 'source', model: 'jev-latest',
      questions: { answer: { type, instructions: args[1], criteria } } });
  });

  it('accepts structured instruction and criteria files', async () => {
    const result = await createHarness({ files: { instructions: '{"question":"Which?","context":[1,true]}', criteria: '{"a":{"rubric":["x"]},"none":null}' } })
      .run(['choice', '--instructions-file', 'instructions', '--criteria-file', 'criteria', '--state', '', '--dry-run']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).questions.result.instructions.context).toEqual([1, true]);
  });

  it.each([
    ['choice', 'Which?', '--option', 'a', '--option', 'a'],
    ['score', 'How much?', '--level', 'Only one'],
    ['noul'],
    ['noul', 'True?', '--instructions-file', 'i'],
    ['noul', 'True?', '--criteria-file', 'c', '--yes', 'true'],
  ].map(args => ({ args })))('rejects invalid primitive input: $args', async ({ args }) => {
    const h = createHarness();
    const result = await h.run([...args, '--state', 'source']);
    expect(result.code).toBe(2);
    expect(h.requests).toHaveLength(0);
  });
});
