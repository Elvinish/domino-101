import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';
import { App } from '../app/App';
import {
  fakeClient,
  gameFixture,
  own,
  roomFixture,
  roomId,
} from '../test/multiplayer';
import { languageKey, resources } from '../i18n';

function setup(host = true) {
  const f = fakeClient(),
    room = roomFixture();
  room.lifecycle = 'lobby';
  room.seats[2] = null;
  room.seats[3] = null;
  room.seats[1] = { ...room.seats[1]!, kind: 'bot', connected: false };
  if (!host) room.hostId = '00000000-0000-4000-8000-000000000099';
  render(
    <MemoryRouter initialEntries={[`/room/${roomId}`]}>
      <App client={f.client} />
    </MemoryRouter>,
  );
  act(() => {
    f.receive('room:joined', own);
    f.receive('room:snapshot', room);
  });
  return { ...f, room };
}
it('offers host add/remove/fill and emits only validated seat actions with the current revision', async () => {
  const f = setup();
  const add = within(
    screen.getByRole('region', { name: 'Seat 3, Partner' }),
  ).getByRole('button', { name: 'Add bot' });
  for (const [button, action] of [
    [add, { type: 'add', seat: 2 }],
    [
      screen.getByRole('button', { name: 'Remove bot' }),
      { type: 'remove', seat: 1 },
    ],
    [
      screen.getByRole('button', { name: 'Fill empty seats with bots' }),
      { type: 'fill' },
    ],
  ] as const) {
    fireEvent.click(button);
    expect(f.socket.emit.mock.calls.at(-1)?.slice(0, 2)).toEqual([
      'room:bots',
      { roomId, expectedRevision: f.room.revision, action },
    ]);
    expect(button).toBeDisabled();
    await act(async () =>
      f.ack({ ok: true, roomId, revision: f.room.revision }),
    );
    expect(button).toBeEnabled();
  }
  expect(screen.getByText('Murad · Bot')).toBeVisible();
  expect(screen.getByText('Ready', { exact: true })).toBeVisible();
  expect(
    screen.queryByText('Disconnected', { exact: true }),
  ).not.toBeInTheDocument();
});
it('hides controls from non-hosts and also refuses programmatic non-host requests', async () => {
  const f = setup(false);
  expect(
    screen.queryByRole('button', { name: /bot/i }),
  ).not.toBeInTheDocument();
  expect(await f.client.manageBots({ type: 'fill' })).toBe(false);
  expect(f.socket.emit).not.toHaveBeenCalled();
});
it('starts with socketless bots, then hides lobby controls during play', () => {
  const f = setup();
  const full = roomFixture();
  full.lifecycle = 'lobby';
  full.revision = 6;
  full.seats = full.seats.map((p, i) =>
    i ? { ...p!, kind: 'bot', connected: false } : p,
  ) as typeof full.seats;
  act(() => f.receive('room:snapshot', full));
  expect(screen.getByRole('button', { name: 'Start match' })).toBeEnabled();
  expect(
    screen.queryByRole('button', { name: 'Fill empty seats with bots' }),
  ).not.toBeInTheDocument();
  full.lifecycle = 'playing';
  full.revision = 7;
  act(() => {
    f.receive('room:snapshot', full);
    f.receive('game:snapshot', { ...gameFixture(), revision: 7 });
  });
  expect(
    screen.queryByRole('button', { name: /(?:Add|Remove) bot/ }),
  ).not.toBeInTheDocument();
});
it('disables bot management while disconnected and hides it after socket replacement', () => {
  const f = setup();
  act(() => f.socket.disconnect());
  expect(
    screen.getByRole('button', { name: 'Fill empty seats with bots' }),
  ).toBeDisabled();
  act(() => f.receive('room:replaced', {}));
  expect(
    screen.queryByRole('button', { name: /bot/i }),
  ).not.toBeInTheDocument();
});
it.each(['en', 'ru', 'az'] as const)(
  'localizes bot controls and seat labels in %s',
  (locale) => {
    localStorage.setItem(languageKey, locale);
    setup();
    const strings = resources[locale];
    expect(
      screen.getByRole('button', { name: strings['bots.fill'] }),
    ).toBeVisible();
    expect(
      screen.getAllByRole('button', { name: strings['bots.add'] }),
    ).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: strings['bots.remove'] }),
    ).toBeVisible();
    expect(screen.getByText(`Murad · ${strings['bots.label']}`)).toBeVisible();
    expect(screen.getByText(strings['bots.ready'])).toBeVisible();
  },
);
