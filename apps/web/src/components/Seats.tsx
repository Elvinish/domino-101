import { useI18n } from '../i18n';
import type {
  BotAction,
  GameSnapshot,
  RoomJoined,
  RoomSnapshot,
} from '@domino/protocol';

export function Seats({
  room,
  own,
  game,
  botControls,
}: {
  room: RoomSnapshot;
  own: RoomJoined;
  game?: GameSnapshot | null;
  botControls?:
    | { disabled: boolean; onAction: (action: BotAction) => Promise<boolean> }
    | undefined;
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
            className={`seat seat-${positions[relative]} ${active ? 'active' : ''} ${relative === 0 ? 'own-seat' : ''} ${player && player.kind !== 'bot' && !player.connected ? 'offline-seat' : ''}`}
            aria-label={t('seat.label', { number: seat + 1, relation })}
            aria-current={active ? 'true' : undefined}
          >
            <span className="avatar" aria-hidden="true">
              {player?.displayName.slice(0, 1).toLocaleUpperCase() ?? '+'}
            </span>
            <div className="seat-copy">
              <strong>
                {player?.displayName ?? t('seat.open')}
                {player?.kind === 'bot' ? ` · ${t('bots.label')}` : ''}
              </strong>
              <span>
                {relation} ·{' '}
                {t('seat.team', {
                  team: player?.team ?? (seat % 2 === 0 ? 'A' : 'B'),
                })}
                {player?.playerId === room.hostId ? ` · ${t('seat.host')}` : ''}
              </span>
              <span>
                {player
                  ? player.connected || player.kind === 'bot'
                    ? active
                      ? relative === 0
                        ? t('seat.yourTurn')
                        : t('seat.playing')
                      : player.kind === 'bot'
                        ? t('bots.ready')
                        : t('connection.connected')
                    : t('connection.disconnected')
                  : t('seat.waiting')}
              </span>
              {botControls &&
                room.lifecycle === 'lobby' &&
                room.hostId === own.playerId &&
                (!player || player.kind === 'bot') && (
                  <button
                    className="quiet bot-seat-control"
                    disabled={botControls.disabled}
                    onClick={() =>
                      void botControls.onAction({
                        type: player ? 'remove' : 'add',
                        seat: seat as 0 | 1 | 2 | 3,
                      })
                    }
                  >
                    {t(player ? 'bots.remove' : 'bots.add')}
                  </button>
                )}
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
