import { useI18n } from '../i18n';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { roomIdSchema } from '@domino/protocol';
import type { ClientState, MultiplayerClient } from '../multiplayer/client';
import { Domino } from './Domino';

export function Entry({
  client,
  state,
  roomId,
}: {
  client: MultiplayerClient;
  state: ClientState;
  roomId?: string;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const navigate = useNavigate();
  const validRoute =
    roomId === undefined || roomIdSchema.safeParse(roomId).success;
  const disabled = state.status !== 'connected' || state.pending;
  async function enter(mode: 'create' | 'join') {
    const ok =
      mode === 'create'
        ? await client.create(name)
        : await client.join(roomId ?? code.trim(), name);
    const joined = client.getSnapshot().joined;
    if (ok && joined) void navigate(`/room/${joined.roomId}`);
  }
  return (
    <main id="main-content" tabIndex={-1} className="entry-layout">
      <section className="welcome">
        <p className="eyebrow">{t('entry.eyebrow')}</p>
        <h1 className="preserve-lines">{t('entry.title')}</h1>
        <p className="intro preserve-lines">{t('entry.intro')}</p>
        <div className="hero-tiles" aria-hidden="true">
          <Domino left={1} right={1} />
          <Domino left={0} right={6} />
          <Domino left={6} right={6} />
        </div>
        <div className="welcome-foot">
          <span>{t('entry.invite')}</span>
          <span>{t('entry.partner')}</span>
          <span>{t('entry.play')}</span>
        </div>
      </section>
      <section className="entry-card">
        <p className="eyebrow">{t('entry.private')}</p>
        <h2>{roomId ? t('entry.awaiting') : t('entry.seat')}</h2>
        {!validRoute ? (
          <>
            <p role="alert">{t('entry.invalidLink')}</p>
            <a href="/">{t('entry.home')}</a>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void enter(roomId ? 'join' : 'create');
            }}
          >
            <label htmlFor="display-name">{t('entry.name')}</label>
            <input
              id="display-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={32}
              autoComplete="nickname"
              placeholder={t('entry.nameHint')}
            />
            {roomId ? (
              <>
                <p className="muted">{t('entry.friend')}</p>
                <button className="primary" type="submit" disabled={disabled}>
                  {state.pending ? t('entry.joining') : t('entry.join')}
                </button>
              </>
            ) : (
              <>
                <button className="primary" type="submit" disabled={disabled}>
                  {state.pending ? t('entry.wait') : t('entry.create')}
                </button>
                <div className="or">
                  <span>{t('entry.or')}</span>
                </div>
                <label htmlFor="room-code">{t('room.code')}</label>
                <input
                  id="room-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  maxLength={32}
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={t('entry.codeHint')}
                />
                <button
                  type="button"
                  className="secondary"
                  disabled={disabled || !name.trim() || !code.trim()}
                  onClick={() => void enter('join')}
                >
                  {t('entry.join')}
                </button>
              </>
            )}
            <p className="fine-print">{t('entry.noAccount')}</p>
          </form>
        )}
      </section>
    </main>
  );
}
