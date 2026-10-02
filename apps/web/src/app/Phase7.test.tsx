import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import {
  fakeClient,
  gameFixture,
  own,
  roomFixture,
  roomId,
} from '../test/multiplayer';
import { languageKey, translate } from '../i18n';
import { SoundService } from '../sound/service';

function setup() {
  const f = fakeClient();
  const sound = new SoundService(() => {
    throw new Error('No hardware required');
  });
  render(
    <MemoryRouter initialEntries={[`/room/${roomId}`]}>
      <App client={f.client} sound={sound} />
    </MemoryRouter>,
  );
  const room = roomFixture(),
    game = gameFixture();
  act(() => {
    f.receive('room:joined', own);
    f.receive('room:snapshot', room);
    f.receive('game:snapshot', game);
  });
  return { ...f, sound, room, game };
}
describe('localized accessible game feedback', () => {
  it('distinguishes reconnect attempts from exhausted retries and cleans manager listeners', () => {
    const f = setup();
    act(() => {
      f.socket.disconnect();
      f.managerReceive('reconnect_attempt');
    });
    expect(document.querySelector('.connection')).toHaveTextContent(
      'Reconnecting…',
    );
    act(() => f.managerReceive('reconnect_failed'));
    expect(document.querySelector('.connection')).toHaveTextContent(
      'Disconnected',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Automatic reconnect stopped',
    );
    act(() => f.client.dispose());
    expect(f.socket.io.off).toHaveBeenCalledTimes(2);
  });
  it.each(['en', 'ru', 'az'] as const)(
    'shows turn, pending, selection and victory states in %s',
    (locale) => {
      localStorage.setItem(languageKey, locale);
      const f = setup();
      const t = (
        key: Parameters<typeof translate>[1],
        params?: Record<string, string | number>,
      ) => translate(locale, key, params);
      const live = screen.getByRole('status', { name: t('announce.label') });
      expect(live).toHaveTextContent(t('game.yourTurn'));
      const ownSeat = screen.getByRole('region', {
        name: t('seat.label', { number: 1, relation: t('seat.you') }),
      });
      expect(ownSeat).toHaveAttribute('aria-current', 'true');
      expect(ownSeat).toHaveTextContent(t('seat.yourTurn'));
      fireEvent.click(
        screen.getByRole('button', {
          name: t('game.playTile', { tile: '1:1' }),
        }),
      );
      expect(
        screen.getByRole('region', { name: t('game.hand') }),
      ).toHaveAttribute('aria-busy', 'true');
      expect(
        screen.getByRole('button', {
          name: t('game.playTile', { tile: '1:1' }),
        }),
      ).toBeDisabled();
      act(() => f.ack({ ok: false, error: { code: 'STALE_REVISION' } }));
      expect(screen.getByRole('alert')).toHaveTextContent(
        t('errors.STALE_REVISION'),
      );
      const selection = structuredClone(f.game);
      selection.revision++;
      selection.public.phase = 'starter-selection';
      selection.public.turn = null;
      selection.public.eligibleTeam = 'A';
      selection.private.legalActions = [
        { type: 'select-starter', selected: 2 },
      ];
      act(() => {
        f.receive('room:snapshot', { ...f.room, revision: 6 });
        f.receive('game:snapshot', selection);
      });
      expect(live).toHaveTextContent(t('game.chooseStarter', { team: 'A' }));
      expect(
        screen.getByRole('button', {
          name: t('game.letStart', { name: 'Leyla' }),
        }),
      ).toBeEnabled();
      const won = structuredClone(selection);
      won.revision++;
      won.public.phase = 'match-finished';
      won.public.winner = 'A';
      won.private.legalActions = [];
      won.public.result = {
        kind: 'normal',
        winner: 'A',
        normalPoints: 25,
        remainingPoints: { A: 0, B: 25 },
      };
      act(() => {
        f.receive('room:snapshot', {
          ...f.room,
          revision: 7,
          lifecycle: 'completed',
        });
        f.receive('game:snapshot', won);
      });
      expect(live).toHaveTextContent(t('game.matchWinner', { team: 'A' }));
      expect(
        screen.getByRole('heading', { name: t('game.victory', { team: 'A' }) }),
      ).toBeVisible();
    },
  );
  it('announces disconnection and keeps private data out of DOM and accessibility text', () => {
    const f = setup();
    const token = 'a'.repeat(43);
    act(() =>
      f.receive('room:session', {
        roomId,
        playerId: own.playerId,
        reconnectToken: token,
      }),
    );
    const room = structuredClone(f.room);
    room.revision++;
    room.isPaused = true;
    room.seats[1]!.connected = false;
    act(() => f.receive('room:snapshot', room));
    expect(
      screen.getByRole('status', { name: 'Table updates' }),
    ).toHaveTextContent('Murad disconnected.');
    expect(
      screen.getByRole('region', { name: 'Seat 2, Opponent' }),
    ).toHaveClass('offline-seat');
    expect(document.body.innerHTML.includes(token)).toBe(false);
    expect(document.body.innerHTML.includes('reconnectToken')).toBe(false);
    expect(
      screen.queryByRole('button', { name: 'Play 6:6' }),
    ).not.toBeInTheDocument();
    act(() => f.receive('room:replaced', {}));
    expect(screen.getByRole('alert')).toHaveTextContent('another tab');
    expect(
      screen.queryByRole('region', { name: 'Your hand' }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ru' } });
    expect(screen.getByRole('alert')).toHaveTextContent('другой вкладке');
  });
  it('keeps announcements unchanged for chat and non-turn updates, and enables sound by action', () => {
    const f = setup();
    const live = screen.getByRole('status', { name: 'Table updates' });
    const observer = vi.fn();
    const mutation = new MutationObserver(observer);
    mutation.observe(live, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    act(() => f.receive('chat:history', { roomId, messages: [] }));
    expect(live).toHaveTextContent('Your turn');
    expect(mutation.takeRecords()).toHaveLength(0);
    mutation.disconnect();
    expect(
      screen.getByRole('button', { name: /Enable sound/ }),
    ).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: /Enable sound/ }));
    expect(screen.getByRole('button', { name: /Mute sound/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: /Mute sound/ }));
    expect(localStorage.getItem('domino101.sound')).toBe('off');
    expect(
      within(screen.getByRole('region', { name: 'Your hand' })).getAllByRole(
        'button',
      ),
    ).toHaveLength(7);
  });
});
