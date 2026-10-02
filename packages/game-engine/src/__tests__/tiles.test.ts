import { describe, expect, it } from 'vitest';
import {
  createDeck,
  createTile,
  dealTiles,
  EngineError,
  findFirstStarter,
  isDouble,
  isTile,
  nextSeat,
  OPENING_DOUBLE_PRIORITY,
  teamOf,
  tilePips,
} from '../index.js';
import type { Hands, Seat, Tile } from '../index.js';

describe('double-six tiles and dealing', () => {
  it('creates exactly the 28 canonical unique tiles', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(28);
    expect(new Set(deck).size).toBe(28);
    expect(deck.filter(isDouble)).toHaveLength(7);
    expect(deck[0]).toBe('0:0');
    expect(deck[27]).toBe('6:6');
    for (let a = 0; a <= 6; a++)
      for (let b = a; b <= 6; b++) expect(deck).toContain(`${a}:${b}`);
  });
  it('normalizes pips without orientation-dependent tile identities', () => {
    expect(createTile(6, 1)).toBe('1:6');
    expect(createTile(1, 6)).toBe('1:6');
    expect(tilePips('1:6')).toEqual([1, 6]);
    expect(isTile('6:1')).toBe(false);
  });
  it.each([-1, 7, 0.5, NaN, Infinity])('rejects invalid pip %s', (value) => {
    expect(() => createTile(value, 0)).toThrow(EngineError);
    expect(() => createTile(0, value)).toThrow(EngineError);
  });
  it.each(['6:1', '7:7', '00:0', '', null, 11])(
    'rejects noncanonical identity %j',
    (value) => {
      expect(isTile(value)).toBe(false);
    },
  );
  it('deals deterministically round-robin, with no leftovers or input mutation', () => {
    const deck = [...createDeck()];
    const original = [...deck];
    const hands = dealTiles(deck);
    expect(hands.map((hand) => hand.length)).toEqual([7, 7, 7, 7]);
    expect([...hands.flat()].sort()).toEqual([...deck].sort());
    expect(hands[0]).toEqual(deck.filter((_, index) => index % 4 === 0));
    expect(hands).toEqual(dealTiles(deck));
    expect(dealTiles([...deck].reverse())).not.toEqual(hands);
    expect(deck).toEqual(original);
    expect(Object.isFrozen(deck)).toBe(false);
    expect(Object.isFrozen(hands[0])).toBe(true);
  });
  it('rejects short, long, duplicate, noncanonical, and sparse decks', () => {
    const deck = [...createDeck()];
    const sparse = [...deck];
    delete sparse[2];
    for (const bad of [
      deck.slice(1),
      [...deck, '0:0'],
      ['0:0', ...deck.slice(0, 27)],
      ['6:1', ...deck.slice(1)],
      sparse,
    ]) {
      expect(() => dealTiles(bad as Tile[])).toThrow('INVALID_DECK');
    }
  });
  it.each([0, 1, 2, 3] as const)(
    'maps seat %i to its opposite partner and clockwise successor',
    (seat) => {
      expect(teamOf(seat)).toBe(seat % 2 === 0 ? 'A' : 'B');
      expect(teamOf(((seat + 2) % 4) as Seat)).toBe(teamOf(seat));
      expect(nextSeat(seat)).toBe((seat + 1) % 4);
    },
  );
  it.each([-1, 4, 0.5, NaN])('rejects invalid seat %s', (seat) => {
    expect(() => teamOf(seat as Seat)).toThrow('INVALID_SEAT');
    expect(() => nextSeat(seat as Seat)).toThrow('INVALID_SEAT');
  });
});

describe('opening-double priority', () => {
  it.each(OPENING_DOUBLE_PRIORITY)(
    'selects %s ahead of every lower-priority fallback',
    (tile) => {
      const index = OPENING_DOUBLE_PRIORITY.indexOf(tile);
      const hands: Hands = [
        [],
        [],
        [tile],
        OPENING_DOUBLE_PRIORITY.slice(index + 1),
      ];
      expect(findFirstStarter(hands)).toEqual({ seat: 2, requiredTile: tile });
    },
  );
  it('finds 1:1 in a complete deal even though 0:0 sorts first', () => {
    const hands = dealTiles(createDeck());
    const starter = findFirstStarter(hands);
    expect(starter.requiredTile).toBe('1:1');
    expect(hands[starter.seat]).toContain('1:1');
  });
  it('rejects a partial fixture with no double', () => {
    expect(() =>
      findFirstStarter([['0:1'], ['2:3'], ['4:5'], ['1:6']]),
    ).toThrow('NO_OPENING_DOUBLE');
  });
  it('rejects missing seats and duplicate ownership', () => {
    expect(() => findFirstStarter([[], [], []] as unknown as Hands)).toThrow(
      'INVALID_HANDS',
    );
    expect(() => findFirstStarter([['1:1'], ['1:1'], [], []])).toThrow(
      'INVALID_HANDS',
    );
  });
});
