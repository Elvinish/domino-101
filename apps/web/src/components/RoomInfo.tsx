import { useState } from 'react';
import type { RoomSnapshot } from '@domino/protocol';
import { useI18n, type MessageKey } from '../i18n';

export function RoomInfo({ room }: { room: RoomSnapshot }) {
  const { t } = useI18n();
  const [copyStatus, setCopyStatus] = useState<MessageKey | null>(null);
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus('room.copied');
    } catch {
      setCopyStatus('room.copyFailed');
    }
  }
  return (
    <>
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
    </>
  );
}
