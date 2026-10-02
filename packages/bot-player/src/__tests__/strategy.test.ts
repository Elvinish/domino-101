import { describe, expect, it } from 'vitest';
import {
  createDeck,
  createMatch,
  getLegalMoves,
  playTile,
} from '@domino/game-engine';
import type { PlayingState, Tile } from '@domino/game-engine';
import {
  applyBotCommand,
  chooseCommand,
  getBotView,
  shuffleDeck,
  simulateMatch,
} from '../index.js';
import type { Strategy } from '../index.js';

const deck: readonly Tile[] = [
  '3:5',
  '4:4',
  '0:2',
  '0:5',
  '2:5',
  '2:4',
  '3:4',
  '4:5',
  '3:6',
  '6:6',
  '5:5',
  '1:4',
  '2:3',
  '0:3',
  '3:3',
  '5:6',
  '1:1',
  '0:4',
  '1:6',
  '0:0',
  '1:5',
  '4:6',
  '1:2',
  '0:1',
  '2:6',
  '2:2',
  '1:3',
  '0:6',
];

describe('bot view and strategy', () => {
  it('only exposes its own hand, public counts and table data', () => {
    const state = createMatch(deck);
    const view = getBotView(state, 0);
    expect(view.hand).toEqual(state.round.hands[0]);
    expect(view.handCounts).toEqual([7, 7, 7, 7]);
    expect(view).not.toHaveProperty('hands');
    expect(view).not.toHaveProperty('round');
    expect(view.hand).not.toBe(state.round.hands[0]);
    expect(JSON.stringify(view)).not.toContain('4:4');
    expect(Object.isFrozen(view.hand)).toBe(true);
    expect(Object.isFrozen(view.legalActions)).toBe(true);
  });
  it('has identical observations when only opponent hands change', () => {
    const state = createMatch(deck);
    const changed: PlayingState = {
      ...state,
      round: {
        ...state.round,
        hands: [
          state.round.hands[0],
          state.round.hands[3],
          state.round.hands[2],
          state.round.hands[1],
        ],
      },
    };
    expect(getBotView(changed, 0)).toEqual(getBotView(state, 0));
    expect(chooseCommand(getBotView(changed, 0), 'seeded-random', 77)).toEqual(
      chooseCommand(getBotView(state, 0), 'seeded-random', 77),
    );
  });
  it.each(['deterministic-first', 'seeded-random'] as const)(
    '%s obeys the required opening double',
    (strategy) => {
      const state = createMatch(deck);
      const chosen = chooseCommand(getBotView(state, 0), strategy, 0);
      expect(chosen.command).toEqual({
        type: 'play',
        seat: 0,
        tile: '1:1',
        end: 'start',
      });
      expect(applyBotCommand(state, chosen.command!).phase).toBe('playing');
    },
  );
  it('returns no command for a waiting seat without consuming RNG', () => {
    const chosen = chooseCommand(
      getBotView(createMatch(deck), 1),
      'seeded-random',
      1,
    );
    expect(chosen).toEqual({ command: null, rngState: 1 });
  });
  it('passes only when the engine supplies zero legal moves', () => {
    const state = playTile(createMatch(deck), 0, '1:1');
    const chosen = chooseCommand(
      getBotView(state, 1),
      'deterministic-first',
      0,
    );
    expect(chosen.command).toEqual({ type: 'pass', seat: 1 });
    const next = applyBotCommand(state, chosen.command!);
    expect(next).toMatchObject({ phase: 'playing', turn: 2 });
    expect(() => applyBotCommand(next, { type: 'pass', seat: 2 })).toThrow(
      'PASS_NOT_ALLOWED',
    );
  });
  it('returns explicit left/right alternatives and submits the chosen end', () => {
    const state = applyBotCommand(playTile(createMatch(deck), 0, '1:1'), {
      type: 'pass',
      seat: 1,
    });
    const view = getBotView(state, 2);
    expect(view.legalActions).toContainEqual({
      type: 'play',
      seat: 2,
      tile: '1:6',
      end: 'left',
    });
    expect(view.legalActions).toContainEqual({
      type: 'play',
      seat: 2,
      tile: '1:6',
      end: 'right',
    });
    const ends = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      const chosen = chooseCommand(view, 'seeded-random', seed).command!;
      expect(() => applyBotCommand(state, chosen)).not.toThrow();
      if (chosen.type === 'play') ends.add(chosen.end);
    }
    expect([...ends].sort()).toEqual(['left', 'right']);
  });
  it('sorts first actions independently of hand ordering and leaves RNG unchanged', () => {
    let state = applyBotCommand(playTile(createMatch(deck), 0, '1:1'), {
      type: 'pass',
      seat: 1,
    });
    if (state.phase !== 'playing') throw new Error('Expected playing');
    const original = getBotView(state, 2);
    state = {
      ...state,
      round: {
        ...state.round,
        hands: [
          state.round.hands[0],
          state.round.hands[1],
          [...state.round.hands[2]].reverse(),
          state.round.hands[3],
        ],
      },
    };
    const chosen = chooseCommand(
      getBotView(state, 2),
      'deterministic-first',
      55,
    );
    expect(chosen).toEqual(chooseCommand(original, 'deterministic-first', 55));
    expect(chosen.rngState).toBe(55);
    expect(chosen.command).toEqual({
      type: 'play',
      seat: 2,
      tile: '1:2',
      end: 'left',
    });
  });
  it('only chooses actions from the real engine legal move set across deals', () => {
    for (let seed = 0; seed < 20; seed++) {
      const state = createMatch(shuffleDeck(seed).deck);
      const command = chooseCommand(
        getBotView(state, state.turn),
        'seeded-random',
        seed,
      ).command!;
      expect(command.type).toBe('play');
      if (command.type === 'play')
        expect(getLegalMoves(state, command.seat)).toContainEqual({
          tile: command.tile,
          end: command.end,
        });
    }
  });
  it('rejects invalid strategy names', () => {
    expect(() =>
      chooseCommand(
        getBotView(createMatch(createDeck()), 3),
        'unknown' as Strategy,
        0,
      ),
    ).toThrow('Unknown bot strategy');
  });
  it('records only winning-team starter selections and correct later openings in a real match', () => {
    const result = simulateMatch({ seed: 0, recordTrace: true });
    const selections = result.trace!.filter(
      (entry) => entry.command.type === 'select-starter',
    );
    expect(selections.length).toBeGreaterThan(0);
    for (const entry of selections) {
      if (entry.command.type !== 'select-starter')
        throw new Error('Expected selection');
      expect(entry.command.seat % 2 === 0 ? 'A' : 'B').toBe(
        entry.before.eligibleTeam,
      );
      expect(entry.command.selected % 2 === 0 ? 'A' : 'B').toBe(
        entry.before.eligibleTeam,
      );
      expect(entry.after.starter).toBe(entry.command.selected);
    }
    expect(result.coverage.startersWithoutDouble).toBeGreaterThan(0);
    expect(result.coverage.startersWithMultipleDoubles).toBeGreaterThan(0);
  });
});
