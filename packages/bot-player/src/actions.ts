import {
  getLegalMoves,
  passTurn,
  playTile,
  SEATS,
  selectStarter,
  teamOf,
} from '@domino/game-engine';
import type { Four, MatchState, Seat } from '@domino/game-engine';
import { freeze } from './immutable.js';
import type { BotCommand, BotView } from './types.js';

export function roundNumber(state: MatchState): number {
  return state.phase === 'starter-selection'
    ? state.roundNumber
    : state.round.number;
}
export function handCounts(state: MatchState): Four<number> {
  const hands =
    state.phase === 'starter-selection' ? state.hands : state.round.hands;
  return [hands[0].length, hands[1].length, hands[2].length, hands[3].length];
}
export function getBotView(state: MatchState, seat: Seat): BotView {
  teamOf(seat); // Public engine validation of the requested seat.
  const hands =
    state.phase === 'starter-selection' ? state.hands : state.round.hands;
  const legalActions: BotCommand[] = [];
  if (state.phase === 'playing' && state.turn === seat) {
    const moves = getLegalMoves(state, seat);
    for (const move of moves)
      legalActions.push({ type: 'play', seat, ...move });
    if (moves.length === 0) legalActions.push({ type: 'pass', seat });
  } else if (
    state.phase === 'starter-selection' &&
    teamOf(seat) === state.eligibleTeam
  ) {
    for (const selected of SEATS)
      if (teamOf(selected) === state.eligibleTeam)
        legalActions.push({ type: 'select-starter', seat, selected });
  }
  // Stable canonical order is independent of the ordering of the player's hand.
  legalActions.sort((a, b) => {
    if (a.type === 'play' && b.type === 'play')
      return a.tile < b.tile
        ? -1
        : a.tile > b.tile
          ? 1
          : ['start', 'left', 'right'].indexOf(a.end) -
            ['start', 'left', 'right'].indexOf(b.end);
    if (a.type === 'select-starter' && b.type === 'select-starter')
      return a.selected - b.selected;
    return 0;
  });
  return freeze({
    phase: state.phase,
    seat,
    roundNumber: roundNumber(state),
    hand: [...hands[seat]],
    handCounts: handCounts(state),
    board:
      state.phase === 'starter-selection'
        ? []
        : state.round.board.map((piece) => ({ ...piece })),
    score: {
      teams: { A: { ...state.score.teams.A }, B: { ...state.score.teams.B } },
      sekaBank: state.score.sekaBank,
    },
    turn: state.phase === 'playing' ? state.turn : null,
    eligibleTeam:
      state.phase === 'starter-selection' ? state.eligibleTeam : null,
    legalActions,
  });
}
/** No private-state access or alternate transition path for bots. */
export function applyBotCommand(
  state: MatchState,
  command: BotCommand,
): MatchState {
  switch (command.type) {
    case 'play':
      return playTile(state, command.seat, command.tile, command.end);
    case 'pass':
      return passTurn(state, command.seat);
    case 'select-starter':
      return selectStarter(state, command.seat, command.selected);
  }
}
