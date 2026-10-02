import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './index.js';

describe('health response contract', () => {
  it('accepts the minimal healthy response', () => {
    expect(healthResponseSchema.parse({ status: 'ok' })).toEqual({
      status: 'ok',
    });
  });
  it.each([{}, { status: 'down' }, { status: 'ok', token: 'secret' }, null])(
    'rejects invalid or extra response fields: %j',
    (input) => {
      expect(healthResponseSchema.safeParse(input).success).toBe(false);
    },
  );
});
