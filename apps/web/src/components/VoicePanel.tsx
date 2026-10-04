import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { RoomJoined, RoomSnapshot } from '@domino/protocol';
import type { VoiceClient } from '../voice/client';
import { useI18n } from '../i18n';

export function RemoteAudio({
  stream,
  name,
}: {
  stream: MediaStream;
  name: string;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLAudioElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const audio = ref.current!;
    let active = true;
    audio.srcObject = stream;
    audio.setAttribute('playsinline', '');
    void audio
      .play()
      .then(() => {
        if (active) setBlocked(false);
      })
      .catch(() => {
        if (active) setBlocked(true);
      });
    return () => {
      active = false;
      audio.pause();
      audio.srcObject = null;
    };
  }, [stream]);
  return (
    <>
      <audio autoPlay ref={ref} aria-label={t('voice.audioFor', { name })} />
      {blocked && (
        <button
          className="quiet"
          onClick={() => {
            void ref.current
              ?.play()
              .then(() => setBlocked(false))
              .catch(() => setBlocked(true));
          }}
        >
          {t('voice.playAudio', { name })}
        </button>
      )}
    </>
  );
}

export function VoicePanel({
  voice,
  room,
  own,
  disabled,
}: {
  voice: VoiceClient;
  room: RoomSnapshot;
  own: RoomJoined;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const state = useSyncExternalStore(voice.subscribe, voice.getSnapshot);
  useEffect(() => () => voice.leave(), [voice]);
  const joined = state.status === 'connected';
  const joining = state.status === 'joining';
  const retry = state.peers.some(
    (peer) => peer.status === 'failed' || peer.status === 'disconnected',
  );
  const localStatus =
    state.status === 'error'
      ? 'voice.unavailable'
      : joining
        ? 'voice.joining'
        : joined
          ? state.muted
            ? 'voice.muted'
            : 'voice.micEnabled'
          : 'voice.micOff';
  return (
    <section className="voice-panel" aria-labelledby="voice-title">
      <div className="voice-heading">
        <h2 id="voice-title">{t('voice.title')}</h2>
        <p role="status">{t(localStatus)}</p>
      </div>
      <div className="voice-controls">
        {joined ? (
          <button
            className="quiet"
            disabled={disabled}
            aria-pressed={state.muted}
            onClick={() => void voice.toggleMute()}
          >
            {t(state.muted ? 'voice.unmute' : 'voice.mute')}
          </button>
        ) : (
          <button
            className="quiet"
            disabled={disabled || joining}
            onClick={() => void voice.enableMicrophone()}
          >
            {t(joining ? 'voice.joining' : 'voice.enable')}
          </button>
        )}
        {(joined || joining) && (
          <button className="quiet" onClick={voice.leave}>
            {t('voice.leave')}
          </button>
        )}
        {retry && (
          <button
            className="quiet"
            disabled={disabled || joining}
            onClick={voice.retry}
          >
            {t('voice.retry')}
          </button>
        )}
      </div>
      {state.error && <p role="alert">{t(state.error)}</p>}
      {state.notice && (
        <p className="fine-print" role="status">
          {t(state.notice)}
        </p>
      )}
      <ul className="voice-participants">
        {room.seats.flatMap((player) => {
          if (!player) return [];
          const participant = state.participants.find(
            (entry) => entry.playerId === player.playerId,
          );
          const peer = state.peers.find(
            (entry) => entry.playerId === player.playerId,
          );
          const self = player.playerId === own.playerId;
          const status = self
            ? localStatus
            : !participant
              ? 'voice.notJoined'
              : !participant.ready
                ? 'voice.joining'
                : participant.muted
                  ? 'voice.muted'
                  : 'voice.micEnabled';
          const connection =
            peer?.status === 'connected'
              ? 'voice.connected'
              : peer?.status === 'connecting'
                ? 'voice.connecting'
                : peer?.status === 'disconnected'
                  ? 'voice.peerDisconnected'
                  : peer?.status === 'failed'
                    ? 'voice.unavailable'
                    : null;
          return (
            <li key={player.playerId}>
              <span className="voice-name">
                {player.displayName}
                {self ? ` · ${t('seat.you')}` : ''}
              </span>
              <span>
                {t(status)}
                {connection ? ` · ${t(connection)}` : ''}
              </span>
              {peer?.stream && (
                <RemoteAudio stream={peer.stream} name={player.displayName} />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
