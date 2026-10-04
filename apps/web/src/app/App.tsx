import { useI18n, isLocale, locales } from '../i18n';
import { I18nProvider } from '../i18n/Provider';
import { SoundService } from '../sound/service';
import { Feedback } from '../components/Feedback';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  Link,
  Route,
  Routes,
  useNavigate,
  useParams,
  useLocation,
} from 'react-router';
import { createMultiplayerClient } from '../multiplayer/client';
import type { ClientState, MultiplayerClient } from '../multiplayer/client';
import { parseWebEnv } from '../config/env';
import { Entry } from '../components/Entry';
import { Room } from '../components/Room';

function RoomRoute({
  client,
  state,
}: {
  client: MultiplayerClient;
  state: ClientState;
}) {
  const { t } = useI18n();
  const { roomId } = useParams();
  if (state.restoring)
    return (
      <main id="main-content" tabIndex={-1} className="room-page">
        <p role="status">{t('connection.restoring')}</p>
      </main>
    );
  if (state.joined?.roomId === roomId)
    return <Room client={client} state={state} />;
  if (state.joined)
    return (
      <main id="main-content" tabIndex={-1} className="room-page">
        <h1>{t('app.alreadySeated')}</h1>
        <Link to={`/room/${state.joined.roomId}`}>{t('app.returnTable')}</Link>
        <p>{t('app.leaveFirst')}</p>
      </main>
    );
  return (
    <Entry
      key={roomId}
      client={client}
      state={state}
      {...(roomId ? { roomId } : {})}
    />
  );
}
export function App(props: {
  client?: MultiplayerClient;
  sound?: SoundService;
}) {
  return (
    <I18nProvider>
      <AppContent {...props} />
    </I18nProvider>
  );
}
function AppContent({
  client: provided,
  sound: providedSound,
}: {
  client?: MultiplayerClient;
  sound?: SoundService;
}) {
  const { t, locale, setLocale } = useI18n();
  const [sound] = useState(() => providedSound ?? new SoundService());
  const soundState = useSyncExternalStore(sound.subscribe, sound.getSnapshot);
  useEffect(() => () => sound.dispose(), [sound]);
  const [client] = useState(
    () =>
      provided ??
      createMultiplayerClient(
        parseWebEnv(import.meta.env).VITE_API_BASE_URL,
        parseWebEnv(import.meta.env).VITE_WEBRTC_ICE_SERVERS,
      ),
  );
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    client.setRoom(
      /^\/room\/([a-f0-9]{32})$/.exec(location.pathname)?.[1] ?? null,
    );
  }, [client, location.pathname]);
  useEffect(() => {
    client.connect();
    return client.dispose;
  }, [client]);
  async function leave() {
    await client.leave();
    void navigate('/');
  }
  return (
    <div onPointerDownCapture={sound.unlock} onKeyDownCapture={sound.unlock}>
      <a className="skip-link" href="#main-content">
        {t('app.skip')}
      </a>
      <header className="site-header">
        <Link
          className="brand"
          to={state.joined ? `/room/${state.joined.roomId}` : '/'}
        >
          <span aria-hidden="true" className="brand-mark">
            ▦
          </span>{' '}
          DOMINO <b>101</b>
        </Link>
        <div className="header-actions">
          <label className="language-control">
            <span className="sr-only">{t('app.language')}</span>
            <select
              value={locale}
              onChange={(event) => {
                if (isLocale(event.target.value)) setLocale(event.target.value);
              }}
            >
              {Object.entries(locales).map(([value, label]) => (
                <option key={value} value={value} lang={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="quiet sound-toggle"
            aria-pressed={soundState.enabled}
            onClick={sound.toggle}
          >
            <span aria-hidden="true">{soundState.enabled ? '♪' : '♩'}</span>{' '}
            {t(soundState.enabled ? 'sound.mute' : 'sound.enable')}
          </button>
          <span className={`connection ${state.status}`} role="status">
            {state.replaced
              ? t('connection.replaced')
              : state.restoring
                ? t('connection.restoring')
                : state.reconnecting
                  ? t('connection.reconnecting')
                  : state.status === 'connecting'
                    ? t('connection.connecting')
                    : state.status === 'connected'
                      ? t('connection.connected')
                      : t('connection.disconnected')}
          </span>
          {state.joined && (
            <button
              className="quiet"
              disabled={state.pending}
              onClick={() => void leave()}
            >
              {state.replaced ? t('app.dismissTable') : t('app.leave')}
            </button>
          )}
        </div>
      </header>
      {state.error && (
        <div className="error-banner" role="alert">
          <span>{t(state.error)}</span>
          <button
            className="quiet"
            onClick={client.clearError}
            aria-label={t('app.dismissError')}
          >
            ×
          </button>
        </div>
      )}
      {state.status === 'disconnected' && !state.replaced && (
        <div className="notice">
          <button onClick={client.retry}>{t('app.retry')}</button>
        </div>
      )}
      {state.storageWarning && (
        <p className="notice" role="status">
          {t(state.storageWarning)}
        </p>
      )}
      {soundState.unavailable && (
        <p className="notice" role="status">
          {t('sound.unavailable')}
        </p>
      )}
      <Feedback state={state} sound={sound} />
      <Routes>
        <Route
          path="/"
          element={
            state.joined ? (
              <main id="main-content" tabIndex={-1} className="room-page">
                <h1>{t('app.openTable')}</h1>
                <Link to={`/room/${state.joined.roomId}`}>
                  {t('app.returnTable')}
                </Link>
              </main>
            ) : (
              <Entry client={client} state={state} />
            )
          }
        />
        <Route
          path="/room/:roomId"
          element={<RoomRoute client={client} state={state} />}
        />
        <Route
          path="*"
          element={
            <main id="main-content" tabIndex={-1} className="room-page">
              <h1>{t('app.notFound')}</h1>
              <Link to="/">{t('app.home')}</Link>
            </main>
          }
        />
      </Routes>
      <footer className="site-footer">
        <span>{t('app.footer')}</span>
        <span>{t('app.identity')}</span>
      </footer>
    </div>
  );
}
