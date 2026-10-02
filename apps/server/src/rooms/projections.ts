import { getLegalMoves, getOpenEnds, SEATS, teamOf } from '@domino/game-engine';
import type { MatchState } from '@domino/game-engine';
import { gameSnapshotSchema, roomSnapshotSchema } from '@domino/protocol';
import type {
  GameAction,
  GameSnapshot,
  PublicGame,
  RoomSnapshot,
} from '@domino/protocol';
import { requireRoom } from './errors.js';
import { roomReady } from './types.js';
import type { Player, Room } from './types.js';

/** Explicit allow-list. Internal Player/Room/Match objects must never be emitted. */
export function projectRoom(room: Room): RoomSnapshot {
  return roomSnapshotSchema.parse({
    roomId: room.id,
    hostId: room.hostId,
    revision: room.revision,
    lifecycle: room.lifecycle,
    isPaused: room.lifecycle === 'playing' && !roomReady(room),
    seats: room.seats.map((player) =>
      player
        ? {
            playerId: player.playerId,
            displayName: player.displayName,
            seat: player.seat,
            team: teamOf(player.seat),
            connected: player.socketId !== null,
          }
        : null,
    ),
  });
}
export function projectPublicGame(state: MatchState): PublicGame {
  const hands =
    state.phase === 'starter-selection' ? state.hands : state.round.hands;
  const board = state.phase === 'starter-selection' ? [] : state.round.board;
  const ended =
    state.phase === 'round-ended' || state.phase === 'match-finished';
  return {
    phase: state.phase,
    roundNumber:
      state.phase === 'starter-selection'
        ? state.roundNumber
        : state.round.number,
    board: board.map((piece) => ({
      tile: piece.tile,
      left: piece.left,
      right: piece.right,
    })),
    openEnds: getOpenEnds(board),
    turn: state.phase === 'playing' ? state.turn : null,
    starter: state.phase === 'starter-selection' ? null : state.round.starter,
    eligibleTeam:
      state.phase === 'starter-selection' ? state.eligibleTeam : null,
    handCounts: [
      hands[0].length,
      hands[1].length,
      hands[2].length,
      hands[3].length,
    ],
    score: {
      teams: {
        A: {
          isScoreOpened: state.score.teams.A.isScoreOpened,
          officialScore: state.score.teams.A.officialScore,
          pendingOpeningPoints: state.score.teams.A.pendingOpeningPoints,
        },
        B: {
          isScoreOpened: state.score.teams.B.isScoreOpened,
          officialScore: state.score.teams.B.officialScore,
          pendingOpeningPoints: state.score.teams.B.pendingOpeningPoints,
        },
      },
      sekaBank: state.score.sekaBank,
    },
    result: ended
      ? state.result.kind === 'seka'
        ? {
            kind: 'seka',
            remainingPoints: {
              A: state.result.remainingPoints.A,
              B: state.result.remainingPoints.B,
            },
          }
        : {
            kind: state.result.kind,
            winner: state.result.winner,
            normalPoints: state.result.normalPoints,
            remainingPoints: {
              A: state.result.remainingPoints.A,
              B: state.result.remainingPoints.B,
            },
          }
      : null,
    awardedPoints: ended ? state.awardedPoints : null,
    winner: state.phase === 'match-finished' ? state.winner : null,
  };
}
export function projectGame(room: Room, player: Player): GameSnapshot {
  requireRoom(
    room.match && room.seats[player.seat] === player,
    'NOT_ROOM_MEMBER',
  );
  const state = room.match.state;
  const hand = (
    state.phase === 'starter-selection' ? state.hands : state.round.hands
  )[player.seat];
  const legalActions: GameAction[] = [];
  if (roomReady(room)) {
    if (state.phase === 'playing' && state.turn === player.seat) {
      const moves = getLegalMoves(state, player.seat);
      if (moves.length === 0) legalActions.push({ type: 'pass' });
      else
        for (const move of moves)
          legalActions.push({ type: 'play', tile: move.tile, end: move.end });
    } else if (
      state.phase === 'starter-selection' &&
      teamOf(player.seat) === state.eligibleTeam
    ) {
      for (const seat of SEATS)
        if (teamOf(seat) === state.eligibleTeam)
          legalActions.push({ type: 'select-starter', selected: seat });
    } else if (state.phase === 'round-ended' && room.hostId === player.playerId)
      legalActions.push({ type: 'next-round' });
  }
  return gameSnapshotSchema.parse({
    roomId: room.id,
    matchId: room.match.id,
    revision: room.revision,
    playerId: player.playerId,
    seat: player.seat,
    public: projectPublicGame(state),
    private: { hand: [...hand], legalActions },
  });
}
