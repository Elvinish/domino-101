import { createDeck } from '@domino/game-engine';
import type { Tile } from '@domino/game-engine';

export function assertSeed(seed: number): void {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new RangeError('Seed must be an unsigned 32-bit integer');
}
/** Mulberry32, version 1. Explicit state; no ambient randomness, including seed 0. */
export function nextRandom(state: number): {
  readonly state: number;
  readonly value: number;
} {
  assertSeed(state);
  const next = (state + 0x6d2b79f5) >>> 0;
  let value = Math.imul(next ^ (next >>> 15), next | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return Object.freeze({
    state: next,
    value: ((value ^ (value >>> 14)) >>> 0) / 0x100000000,
  });
}
export function shuffleDeck(state: number): {
  readonly state: number;
  readonly deck: readonly Tile[];
} {
  assertSeed(state);
  const deck = [...createDeck()];
  for (let index = deck.length - 1; index > 0; index--) {
    const draw = nextRandom(state);
    state = draw.state;
    const selected = Math.floor(draw.value * (index + 1));
    [deck[index], deck[selected]] = [deck[selected]!, deck[index]!];
  }
  return Object.freeze({ state, deck: Object.freeze(deck) });
}
