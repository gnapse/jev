import { describe, expect, it } from 'vitest';
import { parseJson } from './input.js';
import { createHarness, request } from '../test-support/harness.js';

describe('strict input', () => {
  it.each(['{"a":1,"a":2}', '{"a":{"x":1,"x":2}}', '{"a":1,"\\u0061":2}', '{/* x */"a":1}', '[1,]', '1e999', '', 'true false'])('rejects invalid or lossy JSON %s', text => {
    expect(() => parseJson(text)).toThrow();
  });
  it('keeps prototype-like keys as own data properties', () => {
    const result = parseJson('{"__proto__":{"x":true},"constructor":"ok"}') as object;
    expect(Object.hasOwn(result, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
  it('rejects malformed UTF-8 without a request', async () => {
    const h = createHarness({ stdin: Buffer.from([0xc3, 0x28]) });
    expect((await h.run(['noul', 'True?'])).code).toBe(2);
    expect(h.requests).toHaveLength(0);
  });
  it('enforces input size before parsing', async () => {
    const result = await createHarness({ stdin: JSON.stringify(request) }).run(['ask', '--request', '-', '--max-input-bytes', '10']);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.err).error.message).toContain('max-input-bytes');
  });
  it('does not wait for terminal input', async () => {
    expect((await createHarness({ tty: true }).run(['noul', 'True?'])).code).toBe(2);
  });
});
