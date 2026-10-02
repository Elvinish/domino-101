import type { GameSnapshot, RoomJoined, RoomSnapshot } from '@domino/protocol';
import type { I18n } from '../i18n';

export function tableStatus(
  room: RoomSnapshot,
  own: RoomJoined,
  game: GameSnapshot,
  t: I18n['t'],
): string {
  const state = game.public;
  if (room.isPaused) return t('game.paused');
  if (state.phase === 'match-finished')
    return t('game.matchWinner', { team: state.winner ?? '' });
  if (state.phase === 'round-ended')
    return state.result && state.result.kind !== 'seka'
      ? t('game.roundWinner', { team: state.result.winner })
      : t('game.sekaResult');
  if (state.phase === 'starter-selection')
    return t('game.chooseStarter', { team: state.eligibleTeam ?? '' });
  return state.turn === own.seat
    ? t('game.yourTurn')
    : t('game.playerTurn', {
        name:
          state.turn === null
            ? ''
            : (room.seats[state.turn]?.displayName ?? ''),
      });
}
