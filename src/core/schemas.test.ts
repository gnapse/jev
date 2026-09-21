import { describe, expect, it } from 'vitest';
import { validate, checkResponse } from './schemas.js';
import { request, responseFor } from '../test-support/harness.js';

describe('schema boundaries', () => {
  it.each([255, 256])('Choice with %d options', count => {
    const value = { flag: { type: 'choice', instructions: 'Which?', criteria: Object.fromEntries(Array.from({ length: count }, (_, i) => [`a${i}`, null])) } };
    if (count === 255) expect(() => validate('questions', value)).not.toThrow();
    else expect(() => validate('questions', value)).toThrow();
  });
  it.each([1, 2, 10, 11])('Score with %d levels', count => {
    const value = { score: { type: 'score', instructions: 'Rate', criteria: Array.from({ length: count }, (_, i) => `Level ${i}`) } };
    if (count >= 2 && count <= 10) expect(() => validate('questions', value)).not.toThrow();
    else expect(() => validate('questions', value)).toThrow();
  });
  it('rejects null state while preserving nested nulls and optional instructions', () => {
    expect(() => validate('request', { state: null, questions: { x: { type: 'noul' } } })).toThrow();
    expect(() => validate('request', { state: { value: null }, questions: { x: { type: 'noul' } } })).not.toThrow();
    expect(() => validate('request', { state: {}, questions: { x: { type: 'noul', instructions: null, criteria: { true: null, false: null } } } })).not.toThrow();
    expect(() => validate('request', { questions: { x: { type: 'noul' } } })).toThrow();
    expect(() => validate('questions', {})).toThrow();
  });
  it.each([false, true])('rejects server-incompatible nulls with passthrough=%s', passthrough => {
    expect(() => validate('request', { ...request, state: null }, passthrough)).toThrow();
    expect(() => validate('batch-state-record', { id: 'x', state: null }, passthrough)).toThrow();
    expect(() => validate('questions', { impact: { type: 'score', criteria: [null, 'Blocked'] } }, passthrough)).toThrow();
  });
  it('rejects out-of-range or mismatched answers', () => {
    for (const answer of [{ type: 'noul', noul: 1.1 }, { type: 'score', score: 0 }]) {
      expect(() => checkResponse({ ...responseFor(request), answers: { flag: answer } }, request)).toThrow();
    }
  });
});
