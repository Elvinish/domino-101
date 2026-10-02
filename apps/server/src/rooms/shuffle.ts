import { randomInt } from 'node:crypto';
import { createDeck } from '@domino/game-engine';
import type { Tile } from '@domino/game-engine';

export function secureDeck(): readonly Tile[] {
  const deck = [...createDeck()];
  for (let index = deck.length - 1; index > 0; index--) {
    const selected = randomInt(index + 1);
    [deck[index], deck[selected]] = [deck[selected]!, deck[index]!];
  }
  return deck;
}
