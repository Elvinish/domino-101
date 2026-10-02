import { describe, expect, it } from 'vitest';
import {
  createDeck,
  createMatch,
  nextSeat,
  playTile,
  selectStarter,
  startNextRound,
  teamOf,
} from '@domino/game-engine';
import type { MatchState, PlayingState, Seat, Tile } from '@domino/game-engine';
import {
  assertIllegalCommandsRejected,
  assertSimulationState,
  assertSimulationTransition,
  chooseCommand,
  getBotView,
  InvariantFailure,
} from '../index.js';
import { firstRound } from './helpers.js';

describe('independent simulation invariants', () => {
  it('accepts complete genuine engine snapshots and valid transitions', () => {
    const before = createMatch(createDeck());
    const after = playTile(before, before.turn, '1:1');
    expect(() => assertSimulationState(before)).not.toThrow();
    expect(() =>
      assertSimulationTransition(
        before,
        { type: 'play', seat: before.turn, tile: '1:1', end: 'start' },
        after,
      ),
    ).not.toThrow();
  });
  it('rejects lost and duplicate tiles', () => {
    const state = createMatch(createDeck());
    const hands = state.round.hands.map((hand) => [...hand]);
    hands[0]!.pop();
    expect(() =>
      assertSimulationState({
        ...state,
        round: { ...state.round, hands },
      } as unknown as MatchState),
    ).toThrow('TILE_CONSERVATION');
    hands[0]!.push(hands[1]![0]!);
    expect(() =>
      assertSimulationState({
        ...state,
        round: { ...state.round, hands },
      } as unknown as MatchState),
    ).toThrow('TILE_CONSERVATION');
  });
  it('rejects invalid turns and negative counters', () => {
    const state = createMatch(createDeck());
    expect(() => assertSimulationState({ ...state, turn: 4 as Seat })).toThrow(
      'VALID_TURN',
    );
    expect(() =>
      assertSimulationState({
        ...state,
        score: { ...state.score, sekaBank: -1 },
      }),
    ).toThrow('NONNEGATIVE_BANK');
    expect(() =>
      assertSimulationState({
        ...state,
        score: {
          ...state.score,
          teams: {
            ...state.score.teams,
            A: {
              isScoreOpened: false,
              officialScore: 0,
              pendingOpeningPoints: -1,
            },
          },
        },
      }),
    ).toThrow('NONNEGATIVE_SCORES');
  });
  it('rejects an accepted illegal pass and a falsely reported placement', () => {
    const initial = createMatch(createDeck());
    const after = playTile(initial, initial.turn, '1:1');
    expect(() =>
      assertSimulationTransition(
        initial,
        { type: 'pass', seat: initial.turn },
        after,
      ),
    ).toThrow('LEGAL_PASS');
    expect(() =>
      assertSimulationTransition(
        initial,
        { type: 'play', seat: initial.turn, tile: '0:0', end: 'start' },
        after,
      ),
    ).toThrow('LEGAL_PLACEMENT');
  });
  it('probes illegal pass/placement rejection without mutating state', () => {
    const state = createMatch(createDeck());
    const before = JSON.stringify(state);
    expect(() => assertIllegalCommandsRejected(state)).not.toThrow();
    expect(JSON.stringify(state)).toBe(before);
  });
  it('checks winner eligibility and rejects unauthorized starter commands', () => {
    const ended = firstRound();
    const selected = startNextRound(ended, createDeck());
    expect(selected.phase).toBe('starter-selection');
    if (selected.phase !== 'starter-selection')
      throw new Error('Expected selection');
    const eligible = selected.eligibleTeam === 'A' ? 0 : 1;
    const ineligible = nextSeat(eligible);
    expect(getBotView(selected, eligible).legalActions).toHaveLength(2);
    expect(
      chooseCommand(getBotView(selected, ineligible), 'seeded-random', 0)
        .command,
    ).toBeNull();
    expect(
      chooseCommand(getBotView(ended, eligible), 'deterministic-first', 0)
        .command,
    ).toBeNull();
    assertIllegalCommandsRejected(selected);
    const command = chooseCommand(
      getBotView(selected, eligible),
      'deterministic-first',
      0,
    ).command!;
    expect(command.type).toBe('select-starter');
    const next = selectStarter(selected, eligible);
    assertSimulationTransition(ended, { type: 'next-round' }, selected);
    assertSimulationTransition(
      selected,
      { type: 'select-starter', seat: eligible, selected: eligible },
      next,
    );
    expect(teamOf(next.round.starter)).toBe(selected.eligibleTeam);
    expect(() =>
      assertSimulationTransition(
        ended,
        { type: 'next-round' },
        {
          ...selected,
          eligibleTeam: selected.eligibleTeam === 'A' ? 'B' : 'A',
        },
      ),
    ).toThrow('WINNER_STARTER_RIGHTS');
  });
  it('rejects unfinished play with a winning official score', () => {
    const state = createMatch(createDeck());
    const invalid: PlayingState = {
      ...state,
      score: {
        ...state.score,
        teams: {
          ...state.score.teams,
          A: {
            isScoreOpened: true,
            officialScore: 101,
            pendingOpeningPoints: 0,
          },
        },
      },
    };
    expect(() => assertSimulationState(invalid)).toThrow('MATCH_MUST_FINISH');
  });
  it('rejects an engine-inconsistent board while preserving encapsulation', () => {
    const initial = createMatch(createDeck());
    const state = playTile(initial, initial.turn, '1:1');
    if (state.phase !== 'playing') throw new Error('Expected playing');
    const bad = {
      ...state,
      round: {
        ...state.round,
        board: [{ tile: '1:1' as Tile, left: 2 as const, right: 1 as const }],
      },
    };
    expect(() => assertSimulationState(bad)).toThrow(InvariantFailure);
  });
});
