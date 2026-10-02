import { describe, expect, it } from 'vitest';
import { createDeck } from '@domino/game-engine';
import { nextRandom, shuffleDeck } from '../index.js';

function sequence(seed: number, count = 20) {
  const values: number[] = [];
  for (let index = 0; index < count; index++) {
    const next = nextRandom(seed);
    values.push(next.value);
    seed = next.state;
  }
  return values;
}
describe('explicit seeded RNG', () => {
  it.each([0, 1, 123456789, 0xffffffff])(
    'repeats exactly for seed %i',
    (seed) => {
      expect(sequence(seed)).toEqual(sequence(seed));
      expect(sequence(seed).every((value) => value >= 0 && value < 1)).toBe(
        true,
      );
    },
  );
  it('has a stable reference vector and different seeds differ', () => {
    expect(sequence(1, 3)).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
    ]);
    expect(sequence(0)).not.toEqual(sequence(1));
  });
  it.each([-1, 0.5, NaN, Infinity, 0x100000000])(
    'rejects invalid seed %s',
    (seed) => {
      expect(() => nextRandom(seed)).toThrow(RangeError);
      expect(() => shuffleDeck(seed)).toThrow(RangeError);
    },
  );
  it('shuffles a complete deck deterministically without mutating the canonical set', () => {
    const canonical = createDeck();
    const first = shuffleDeck(123);
    expect(first).toEqual(shuffleDeck(123));
    expect(first.deck).not.toEqual(shuffleDeck(124).deck);
    expect(first.deck).toHaveLength(28);
    expect(new Set(first.deck).size).toBe(28);
    expect([...first.deck].sort()).toEqual(canonical);
    expect(canonical[0]).toBe('0:0');
    expect(Object.isFrozen(first.deck)).toBe(true);
  });
  it('resumes exactly from the returned RNG state', () => {
    const first = nextRandom(42);
    expect(nextRandom(first.state).value).toBe(sequence(42, 2)[1]);
  });
});
