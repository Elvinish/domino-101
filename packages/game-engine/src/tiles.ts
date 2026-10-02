import { EngineError, requireRule, freeze } from './errors.js';
import type { Hands, Pip, Seat, Team, Tile } from './types.js';

export const SEATS: readonly Seat[] = Object.freeze([0, 1, 2, 3]);
export const OPENING_DOUBLE_PRIORITY: readonly Tile[] = Object.freeze([
  '1:1',
  '2:2',
  '3:3',
  '4:4',
  '5:5',
  '6:6',
  '0:0',
]);
export function isTile(value: unknown): value is Tile {
  return (
    typeof value === 'string' &&
    /^[0-6]:[0-6]$/.test(value) &&
    value[0]! <= value[2]!
  );
}
export function createTile(a: number, b: number): Tile {
  requireRule(
    Number.isInteger(a) &&
      Number.isInteger(b) &&
      a >= 0 &&
      b >= 0 &&
      a <= 6 &&
      b <= 6,
    'INVALID_TILE',
  );
  return `${Math.min(a, b)}:${Math.max(a, b)}` as Tile;
}
export function tilePips(tile: Tile): readonly [Pip, Pip] {
  requireRule(isTile(tile), 'INVALID_TILE');
  return Object.freeze([Number(tile[0]) as Pip, Number(tile[2]) as Pip]);
}
export function isDouble(tile: Tile): boolean {
  const [a, b] = tilePips(tile);
  return a === b;
}
export function createDeck(): readonly Tile[] {
  const tiles: Tile[] = [];
  for (let a = 0; a <= 6; a++)
    for (let b = a; b <= 6; b++) tiles.push(createTile(a, b));
  return Object.freeze(tiles);
}
export function assertSeat(seat: Seat): void {
  requireRule(Number.isInteger(seat) && seat >= 0 && seat <= 3, 'INVALID_SEAT');
}
export function assertTeam(team: Team): void {
  requireRule(team === 'A' || team === 'B', 'INVALID_TEAM');
}
export function teamOf(seat: Seat): Team {
  assertSeat(seat);
  return seat % 2 === 0 ? 'A' : 'B';
}
export function nextSeat(seat: Seat): Seat {
  assertSeat(seat);
  return ((seat + 1) % 4) as Seat;
}
export function otherTeam(team: Team): Team {
  assertTeam(team);
  return team === 'A' ? 'B' : 'A';
}
export function assertHands(hands: Hands): void {
  requireRule(
    Array.isArray(hands) &&
      hands.length === 4 &&
      Array.from(hands).every(
        (hand) =>
          Array.isArray(hand) &&
          hand.length <= 7 &&
          Array.from(hand).every(isTile),
      ),
    'INVALID_HANDS',
  );
  const tiles = hands.flat();
  requireRule(new Set(tiles).size === tiles.length, 'INVALID_HANDS');
}
/** Supplied order is dealt round-robin: positions 0,4,8,... go to seat 0. */
export function dealTiles(deck: readonly Tile[]): Hands {
  requireRule(
    Array.isArray(deck) &&
      deck.length === 28 &&
      Array.from(deck).every(isTile) &&
      new Set(deck).size === 28,
    'INVALID_DECK',
  );
  const hands: [Tile[], Tile[], Tile[], Tile[]] = [[], [], [], []];
  deck.forEach((tile, index) => hands[(index % 4) as Seat].push(tile));
  return freeze(hands);
}
/** Also accepts partial hands to exercise every priority fallback deterministically. */
export function findFirstStarter(hands: Hands): {
  readonly seat: Seat;
  readonly requiredTile: Tile;
} {
  assertHands(hands);
  for (const tile of OPENING_DOUBLE_PRIORITY) {
    for (const seat of SEATS)
      if (hands[seat].includes(tile))
        return Object.freeze({ seat, requiredTile: tile });
  }
  throw new EngineError('NO_OPENING_DOUBLE');
}
