import { useEffect } from 'react';
import type { ClientState } from '../multiplayer/client';
import type { SoundService } from '../sound/service';
import { useI18n } from '../i18n';
import { tableStatus } from './tableStatus';

export function Feedback({
  state,
  sound,
}: {
  state: ClientState;
  sound: SoundService;
}) {
  const { t } = useI18n();
  const { room, joined, game, status } = state;
  useEffect(() => {
    if (
      room &&
      game &&
      status === 'connected' &&
      room.revision !== game.revision
    )
      return;
    sound.observe(
      room && game && status === 'connected'
        ? {
            matchId: game.matchId,
            revision: game.revision,
            seat: game.seat,
            paused: room.isPaused,
            public: game.public,
          }
        : null,
    );
  }, [room, game, status, sound]);
  const message =
    status === 'connected' && room && joined
      ? [
          ...room.seats
            .filter((player) => player && !player.connected)
            .map((player) =>
              t('announce.disconnected', { name: player!.displayName }),
            ),
          game ? tableStatus(room, joined, game, t) : '',
        ]
          .filter(Boolean)
          .join(' ')
      : '';
  return (
    <div
      className="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={t('announce.label')}
    >
      {message}
    </div>
  );
}
