import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import { useState } from 'react';
import type { ClientState, MultiplayerClient } from '../multiplayer/client';
import { Seats } from './Seats';
import { GameTable } from './GameTable';
import { ChatPanel } from './ChatPanel';
import { VoicePanel } from './VoicePanel';

export function Room({
  client,
  state,
}: {
  client: MultiplayerClient;
  state: ClientState;
}) {
  const { t } = useI18n();
  const [copyStatus, setCopyStatus] = useState<MessageKey | null>(null);
  const { joined, room, game } = state;
  if (!joined || !room)
    return (
      <main id="main-content" tabIndex={-1} className="room-page">
        <p role="status">{t('room.preparing')}</p>
      </main>
    );
  const ready = room.seats.every(
    (player) => player && (player.kind === 'bot' || player.connected),
  );
  const host = room.hostId === joined.playerId;
  const disabled = state.pending || state.status !== 'connected';
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus('room.copied');
    } catch {
      setCopyStatus('room.copyFailed');
    }
  }
  return (
    <main id="main-content" tabIndex={-1} className="room-page">
      <div className="room-heading">
        <div>
          <p className="eyebrow">{t('room.private')}</p>
          <h1>{room.lifecycle === 'lobby' ? t('room.title') : 'Domino 101'}</h1>
        </div>
        <div className="share-actions">
          <button
            className="quiet"
            onClick={() =>
              void copy(`${window.location.origin}/room/${room.roomId}`)
            }
          >
            {t('room.copyLink')}
          </button>
          <button className="quiet" onClick={() => void copy(room.roomId)}>
            {t('room.copyCode')}
          </button>
        </div>
      </div>
      <div className="room-code">
        <span>{t('room.code')}</span> <code>{room.roomId}</code>
      </div>
      <p className="copy-status" role="status">
        {copyStatus && t(copyStatus)}
      </p>
      {room.isPaused && state.status === 'connected' && !state.replaced && (
        <p className="notice" role="alert">
          {t('room.paused')}
        </p>
      )}
      {room.lifecycle === 'lobby' ? (
        <>
          <p className="lobby-intro">{t('room.invite')}</p>
          <div className="table-shell lobby-table">
            <Seats
              room={room}
              own={joined}
              botControls={
                host && !state.replaced
                  ? { disabled, onAction: client.manageBots }
                  : undefined
              }
            />
            <section className="lobby-center">
              <p className="eyebrow">{t('room.fourSeats')}</p>
              <strong>
                {room.seats.filter(Boolean).length}
                <span> / 4</span>
              </strong>
              <p>{ready ? t('room.ready') : t('room.waiting')}</p>
              {host ? (
                <button
                  className="primary"
                  disabled={disabled || !ready}
                  onClick={() => void client.start()}
                >
                  {state.pending ? t('room.starting') : t('room.start')}
                </button>
              ) : (
                <p>{t('room.hostStarts')}</p>
              )}
            </section>
          </div>
          {host &&
            !state.replaced &&
            room.seats.some((player) => player === null) && (
              <div className="lobby-bot-actions">
                <button
                  className="quiet"
                  disabled={disabled}
                  onClick={() => void client.manageBots({ type: 'fill' })}
                >
                  {t('bots.fill')}
                </button>
              </div>
            )}
          <p className="fine-print">{t('room.saved')}</p>
        </>
      ) : game ? (
        <>
          <GameTable
            room={room}
            own={joined}
            game={game}
            disabled={
              disabled || room.isPaused || room.revision !== game.revision
            }
            pending={state.pending}
            onAction={client.act}
          />
        </>
      ) : (
        <p role="status">
          {state.status === 'disconnected'
            ? t('room.hiddenHand')
            : t('room.receiving')}
        </p>
      )}
      {!state.replaced && (
        <VoicePanel
          voice={client.voice}
          room={room}
          own={joined}
          disabled={state.status !== 'connected' || state.restoring}
        />
      )}
      {!state.replaced && (
        <ChatPanel
          messages={state.chat}
          reactionEvents={state.reactions}
          unread={state.unreadChat}
          pending={state.chatPending}
          disabled={state.status !== 'connected' || state.replaced}
          error={state.chatError}
          onSend={client.sendChat}
          onReaction={client.sendReaction}
          onRead={client.markChatRead}
        />
      )}
    </main>
  );
}
