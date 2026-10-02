import { describe, expect, it } from 'vitest';
import {
  assertMatchState,
  createDeck,
  createMatch,
  getLegalMoves,
  getOpenEnds,
  nextSeat,
  passTurn,
  playTile,
  selectStarter,
  startNextRound,
  teamOf,
} from '../index.js';
import type {
  MatchState,
  PlayingState,
  RoundEndedState,
  Seat,
  Tile,
} from '../index.js';
import { baglanmaFixture, normalFixture, sekaFixture } from './fixtures.js';
import type { Step } from './fixtures.js';

function replay(initial: MatchState, steps: readonly Step[]): MatchState {
  return steps.reduce((state, step) => {
    const before = JSON.stringify(state);
    const after =
      step[1] === 'pass'
        ? passTurn(state, step[0])
        : playTile(state, step[0], step[1], step[2]);
    expect(JSON.stringify(state)).toBe(before);
    assertMatchState(after);
    if (after.phase !== 'starter-selection') {
      expect(after.round.hands.flat().length + after.round.board.length).toBe(
        28,
      );
      expect(
        new Set([
          ...after.round.hands.flat(),
          ...after.round.board.map((piece) => piece.tile),
        ]).size,
      ).toBe(28);
    }
    return after;
  }, initial);
}
function ended(
  fixture = normalFixture as {
    readonly deck: readonly Tile[];
    readonly moves: readonly Step[];
  },
): RoundEndedState {
  const state = replay(createMatch(fixture.deck), fixture.moves);
  if (state.phase !== 'round-ended')
    throw new Error('Expected completed round');
  return state;
}
function deckWithHand(seat: Seat, hand: readonly Tile[]): readonly Tile[] {
  if (hand.length !== 7) throw new Error('Fixture needs seven tiles');
  const others = createDeck().filter((tile) => !hand.includes(tile));
  let index = 0;
  return Array.from({ length: 28 }, (_, position) =>
    position % 4 === seat ? hand[Math.floor(position / 4)]! : others[index++]!,
  );
}

describe('authoritative turns and normal round completion', () => {
  it('starts at the 1:1 holder and only offers the required opening', () => {
    const state = createMatch(normalFixture.deck);
    expect(state.turn).toBe(0);
    expect(state.round.starter).toBe(0);
    expect(getLegalMoves(state, 0)).toEqual([{ tile: '1:1', end: 'start' }]);
    expect(() => playTile(state, 0, '3:5')).toThrow('ILLEGAL_TILE');
    expect(() => passTurn(state, 0)).toThrow('PASS_NOT_ALLOWED');
    expect(() => playTile(state, 1, '4:4')).toThrow('NOT_YOUR_TURN');
    expect(() => playTile(state, 0, '2:2')).toThrow('TILE_NOT_IN_HAND');
    expect(() => playTile(state, 4 as Seat, '1:1')).toThrow('INVALID_SEAT');
    expect(() => playTile(state, 0, '9:9' as Tile)).toThrow('INVALID_TILE');
  });
  it('enforces required 1:1 even if that holder also owns other doubles', () => {
    const deck = deckWithHand(2, [
      '1:1',
      '0:0',
      '6:6',
      '2:2',
      '0:1',
      '0:2',
      '0:3',
    ]);
    const state = createMatch(deck);
    expect(state.turn).toBe(2);
    for (const tile of ['0:0', '6:6', '2:2'] as const)
      expect(() => playTile(state, 2, tile)).toThrow('ILLEGAL_TILE');
  });
  it('advances clockwise and passes only the current player with no legal move', () => {
    const initial = createMatch(normalFixture.deck);
    const first = playTile(initial, 0, '1:1');
    expect(first).toMatchObject({ phase: 'playing', turn: 1 });
    expect(getLegalMoves(first, 1)).toEqual([]);
    expect(() => passTurn(first, 2)).toThrow('NOT_YOUR_TURN');
    const passed = passTurn(first, 1);
    expect(passed.turn).toBe(2);
    if (first.phase !== 'playing') throw new Error('Expected playing');
    expect(passed.round).toEqual(first.round);
    expect(passed.score).toEqual(first.score);
    expect(() => passTurn(passed, 2)).toThrow('PASS_NOT_ALLOWED');
    expect(() => playTile(passed, 2, '3:4')).toThrow('ILLEGAL_TILE');
    expect(() => playTile(passed, 2, '1:6')).toThrow('END_REQUIRED');
    const next = playTile(passed, 2, '1:6', 'right');
    expect(next).toMatchObject({ phase: 'playing', turn: 3 });
    const wrap = playTile(next, 3, '0:6', 'right');
    expect(wrap).toMatchObject({ phase: 'playing', turn: 0 });
  });
  it('completes a legal round immediately on the last tile and scores only the losing team', () => {
    const state = ended();
    expect(state.round.hands[2]).toEqual([]);
    expect(state.round.hands[0]).not.toEqual([]);
    expect(state.result).toEqual({
      kind: 'normal',
      winner: 'A',
      normalPoints: 40,
      remainingPoints: { A: 8, B: 40 },
    });
    expect(state.score.teams.A.officialScore).toBe(40);
    expect(state.awardedPoints).toBe(40);
    expect(() => playTile(state, 0, '2:6')).toThrow('INVALID_PHASE');
    expect(() => passTurn(state, 0)).toThrow('INVALID_PHASE');
    expect(() => getLegalMoves(state, 0)).toThrow('INVALID_PHASE');
  });
  it('detects a blocked round immediately, without waiting for four passes', () => {
    const state = ended(baglanmaFixture);
    expect(state.round.hands.every((hand) => hand.length > 0)).toBe(true);
    expect(state.result).toEqual({
      kind: 'baglanma',
      winner: 'A',
      normalPoints: 46,
      remainingPoints: { A: 20, B: 46 },
    });
    expect(getOpenEnds(state.round.board)).toEqual({ left: 3, right: 3 });
    expect(state.score.teams.A.officialScore).toBe(46);
  });
  it('finishes the match as soon as the round takes an official score past 101', () => {
    const base = createMatch(normalFixture.deck);
    const initial: PlayingState = {
      ...base,
      score: {
        ...base.score,
        teams: {
          ...base.score.teams,
          A: {
            isScoreOpened: true,
            officialScore: 98,
            pendingOpeningPoints: 0,
          },
        },
      },
    };
    const state = replay(initial, normalFixture.moves);
    expect(state).toMatchObject({
      phase: 'match-finished',
      winner: 'A',
      awardedPoints: 40,
      score: { teams: { A: { officialScore: 138 } } },
    });
    expect(() => startNextRound(state, createDeck())).toThrow('INVALID_PHASE');
    expect(() => selectStarter(state, 0)).toThrow('INVALID_PHASE');
    expect(() => playTile(state, 0, '2:6')).toThrow('INVALID_PHASE');
    expect(() => passTurn(state, 0)).toThrow('INVALID_PHASE');
  });
});

describe('starter selection and later-round opening', () => {
  it('applies the same starter rights to team B after a normal win', () => {
    const deck = normalFixture.deck.map(
      (_, i) => normalFixture.deck[((i + 3) % 4) + Math.floor(i / 4) * 4]!,
    );
    const moves: Step[] = normalFixture.moves.map((step) =>
      step[1] === 'pass'
        ? [((step[0] + 1) % 4) as Seat, 'pass']
        : [((step[0] + 1) % 4) as Seat, step[1], step[2]],
    );
    const finished = ended({ deck, moves });
    const selection = startNextRound(finished, createDeck());
    expect(selection).toMatchObject({
      phase: 'starter-selection',
      eligibleTeam: 'B',
    });
    expect(selectStarter(selection, 1, 3).round.starter).toBe(3);
    expect(selectStarter(selection, 3, 1).round.starter).toBe(1);
    expect(() => selectStarter(selection, 0, 1)).toThrow(
      'STARTER_NOT_ELIGIBLE',
    );
  });

  it('gives rights to the winning team, not just the winning player', () => {
    const selection = startNextRound(ended(), createDeck());
    expect(selection).toMatchObject({
      phase: 'starter-selection',
      eligibleTeam: 'A',
      roundNumber: 2,
    });
    expect(selectStarter(selection, 0, 2).round.starter).toBe(2);
    expect(selectStarter(selection, 2, 0).round.starter).toBe(0);
    expect(selectStarter(selection, 0).turn).toBe(0);
    expect(selectStarter(selection, 2).turn).toBe(2);
  });
  it('rejects ineligible actor/target and locks the first valid selection', () => {
    const selection = startNextRound(ended(), createDeck());
    expect(() => selectStarter(selection, 1, 0)).toThrow(
      'STARTER_NOT_ELIGIBLE',
    );
    expect(() => selectStarter(selection, 0, 1)).toThrow(
      'STARTER_NOT_ELIGIBLE',
    );
    expect(() => selectStarter(selection, 3)).toThrow('STARTER_NOT_ELIGIBLE');
    expect(() => playTile(selection, 0, '0:0')).toThrow('INVALID_PHASE');
    expect(() => passTurn(selection, 0)).toThrow('INVALID_PHASE');
    const selected = selectStarter(selection, 0, 2);
    expect(() => selectStarter(selected, 2, 0)).toThrow('INVALID_PHASE');
    expect(selected.turn).toBe(2);
    expect(selected.round.board).toEqual([]);
  });
  it('requires the only double even when another tile could open an empty board', () => {
    const deck = deckWithHand(0, [
      '2:2',
      '0:1',
      '0:2',
      '0:3',
      '0:4',
      '0:5',
      '0:6',
    ]);
    const state = selectStarter(startNextRound(ended(), deck), 0);
    expect(getLegalMoves(state, 0)).toEqual([{ tile: '2:2', end: 'start' }]);
    expect(() => playTile(state, 0, '0:1')).toThrow('ILLEGAL_TILE');
    expect(playTile(state, 0, '2:2')).toMatchObject({
      phase: 'playing',
      turn: 1,
    });
  });
  it('allows any held double, including 0:0 and 6:6, after the first round', () => {
    const deck = deckWithHand(0, [
      '0:0',
      '2:2',
      '6:6',
      '0:1',
      '0:2',
      '0:3',
      '0:4',
    ]);
    const state = selectStarter(startNextRound(ended(), deck), 2, 0);
    expect(getLegalMoves(state, 0).map((move) => move.tile)).toEqual([
      '0:0',
      '2:2',
      '6:6',
    ]);
    for (const tile of ['0:0', '2:2', '6:6'] as const)
      expect(playTile(state, 0, tile).phase).toBe('playing');
  });
  it('allows any tile when the selected starter has no doubles', () => {
    const hand = ['0:1', '0:2', '0:3', '0:4', '0:5', '0:6', '1:2'] as const;
    const state = selectStarter(
      startNextRound(ended(), deckWithHand(0, hand)),
      0,
    );
    expect(getLegalMoves(state, 0)).toHaveLength(7);
    for (const tile of hand)
      expect(playTile(state, 0, tile).phase).toBe('playing');
  });
  it('does not impose opening-double restrictions after a tile has been played', () => {
    const initial = selectStarter(
      startNextRound(
        ended(),
        deckWithHand(0, ['0:0', '2:2', '6:6', '0:1', '0:2', '0:3', '0:4']),
      ),
      0,
    );
    const state = playTile(initial, 0, '0:0');
    expect(state.phase).toBe('playing');
    if (state.phase !== 'playing') throw new Error('Expected playing');
    const legal = getLegalMoves(state, state.turn);
    expect(legal.some((move) => move.tile === '0:5')).toBe(true);
  });
  it('a blocked winner gets rights even if the previous starter belongs to the other team', () => {
    const previous = ended(baglanmaFixture);
    expect(teamOf(previous.round.starter)).toBe('B');
    expect(startNextRound(previous, createDeck())).toMatchObject({
      phase: 'starter-selection',
      eligibleTeam: 'A',
    });
  });
});

describe('SEKA transitions', () => {
  it('preserves a partner chosen after a non-SEKA win, not the old first starter', () => {
    const first = ended();
    expect(first.round.starter).toBe(0);
    // Move the SEKA fixture's starter from seat 3 to seat 2.
    const deck = sekaFixture.deck.map(
      (_, i) => sekaFixture.deck[((i + 1) % 4) + Math.floor(i / 4) * 4]!,
    );
    const moves: Step[] = sekaFixture.moves.map((step) =>
      step[1] === 'pass'
        ? [((step[0] + 3) % 4) as Seat, 'pass']
        : [((step[0] + 3) % 4) as Seat, step[1], step[2]],
    );
    const selected = selectStarter(startNextRound(first, deck), 0, 2);
    const seka = replay(selected, moves);
    expect(seka).toMatchObject({
      phase: 'round-ended',
      result: { kind: 'seka' },
      round: { starter: 2 },
    });
    expect(startNextRound(seka, createDeck())).toMatchObject({
      phase: 'playing',
      turn: 2,
      round: { starter: 2, number: 3 },
    });
  });

  it('preserves the exact first-round starter and applies later opening rules next time', () => {
    const state = ended(sekaFixture);
    expect(state.result).toEqual({
      kind: 'seka',
      remainingPoints: { A: 19, B: 19 },
    });
    expect(state.score.sekaBank).toBe(38);
    expect(state.score.teams.A.officialScore).toBe(0);
    expect(state.score.teams.B.officialScore).toBe(0);
    expect(state.awardedPoints).toBe(0);
    const next = startNextRound(state, normalFixture.deck);
    expect(next).toMatchObject({
      phase: 'playing',
      turn: 3,
      round: { number: 2, starter: 3, opening: { kind: 'later' } },
    });
    expect(getLegalMoves(next, 3)).toEqual([{ tile: '0:0', end: 'start' }]);
    expect(() => selectStarter(next, 1)).toThrow('INVALID_PHASE');
  });
  it('preserves the starter across repeated SEKA and awards the bank in a later legal win', () => {
    const first = ended(sekaFixture);
    const secondOpening = startNextRound(first, sekaFixture.deck);
    const second = replay(secondOpening, sekaFixture.moves);
    expect(second).toMatchObject({
      phase: 'round-ended',
      score: { sekaBank: 76 },
      round: { starter: 3, number: 2 },
    });
    // Rotate the normal trace and deal so its former seat 0 is now starter 3.
    const rotated = normalFixture.deck.map(
      (_, i) => normalFixture.deck[((i + 1) % 4) + Math.floor(i / 4) * 4]!,
    );
    const thirdOpening = startNextRound(second, rotated);
    const steps: Step[] = normalFixture.moves.map((step) =>
      step[1] === 'pass'
        ? [((step[0] + 3) % 4) as Seat, 'pass']
        : [((step[0] + 3) % 4) as Seat, step[1], step[2]],
    );
    const third = replay(thirdOpening, steps);
    expect(third).toMatchObject({
      phase: 'match-finished',
      winner: 'B',
      awardedPoints: 116,
      score: { sekaBank: 0, teams: { B: { officialScore: 116 } } },
    });
  });
});

describe('snapshot invariants and phase validation', () => {
  it('freezes returned state but copies caller-owned deck input', () => {
    const deck = [...normalFixture.deck];
    const state = createMatch(deck);
    expect(Object.isFrozen(deck)).toBe(false);
    expect(Object.isFrozen(state.round.hands[0])).toBe(true);
    expect(Object.isFrozen(state.score.teams.A)).toBe(true);
    expect(() => (state.round.hands[0] as Tile[]).push('0:0')).toThrow(
      TypeError,
    );
    deck.reverse();
    expect(state.round.hands[0][0]).toBe('3:5');
  });
  it('is deterministic for identical inputs and does not freeze mutable caller snapshots', () => {
    const state = createMatch(normalFixture.deck);
    expect(playTile(state, 0, '1:1')).toEqual(playTile(state, 0, '1:1'));
    const copy = JSON.parse(JSON.stringify(state)) as PlayingState;
    playTile(copy, 0, '1:1');
    expect(Object.isFrozen(copy.round.hands[0])).toBe(false);
    expect(copy.round.board).toEqual([]);
  });
  it('rejects illegal phase transitions and invalid next decks without changing the old state', () => {
    const initial = createMatch(createDeck());
    expect(() => startNextRound(initial, createDeck())).toThrow(
      'INVALID_PHASE',
    );
    expect(() => selectStarter(initial, 0)).toThrow('INVALID_PHASE');
    const state = ended();
    const before = JSON.stringify(state);
    expect(() => startNextRound(state, createDeck().slice(1))).toThrow(
      'INVALID_DECK',
    );
    expect(JSON.stringify(state)).toBe(before);
  });
  it('rejects missing/duplicate tiles and invalid turns rather than delegating invariants to UI', () => {
    const state = createMatch(normalFixture.deck);
    const missing = {
      ...state,
      round: {
        ...state.round,
        hands: [state.round.hands[0].slice(1), ...state.round.hands.slice(1)],
      },
    } as unknown as PlayingState;
    expect(() => playTile(missing, 0, '1:1')).toThrow('INVALID_DECK');
    expect(() =>
      assertMatchState({ ...state, turn: nextSeat(state.turn) }),
    ).toThrow('INVALID_STATE');
    expect(() =>
      assertMatchState({ ...state, phase: 'unknown' } as unknown as MatchState),
    ).toThrow('INVALID_PHASE');
  });
});
