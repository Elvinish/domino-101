import { useI18n } from '../i18n';
import type { GameSnapshot, RoomJoined, RoomSnapshot } from '@domino/protocol';

export function Seats({
  room,
  own,
  game,
}: {
  room: RoomSnapshot;
  own: RoomJoined;
  game?: GameSnapshot | null;
}) {
  const { t } = useI18n();
  const positions = ['bottom', 'left', 'top', 'right'];
  return (
    <div className="seats" aria-label={t('seat.group')}>
      {room.seats.map((player, seat) => {
        const relative = (seat - own.seat + 4) % 4;
        const relation =
          relative === 0
            ? t('seat.you')
            : relative === 2
              ? t('seat.partner')
              : t('seat.opponent');
        const active =
          !room.isPaused &&
          game?.public.phase === 'playing' &&
          game.public.turn === seat;
        return (
          <section
            key={seat}
            className={`seat seat-${positions[relative]} ${active ? 'active' : ''} ${relative === 0 ? 'own-seat' : ''} ${player && !player.connected ? 'offline-seat' : ''}`}
            aria-label={t('seat.label', { number: seat + 1, relation })}
            aria-current={active ? 'true' : undefined}
          >
            <span className="avatar" aria-hidden="true">
              {player?.displayName.slice(0, 1).toLocaleUpperCase() ?? '+'}
            </span>
            <div className="seat-copy">
              <strong>{player?.displayName ?? t('seat.open')}</strong>
              <span>
                {relation} ·{' '}
                {t('seat.team', {
                  team: player?.team ?? (seat % 2 === 0 ? 'A' : 'B'),
                })}
                {player?.playerId === room.hostId ? ` · ${t('seat.host')}` : ''}
              </span>
              <span>
                {player
                  ? player.connected
                    ? active
                      ? relative === 0
                        ? t('seat.yourTurn')
                        : t('seat.playing')
                      : t('connection.connected')
                    : t('connection.disconnected')
                  : t('seat.waiting')}
              </span>
              {game && relative !== 0 && (
                <span className="hand-count">
                  {t('seat.tiles', { count: game.public.handCounts[seat]! })}
                </span>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
