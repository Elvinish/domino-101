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

function setup(route = '/') {
  const f = fakeClient();
  render(
    <MemoryRouter initialEntries={[route]}>
      <App client={f.client} />
    </MemoryRouter>,
  );
  return f;
}
function seat(f: ReturnType<typeof fakeClient>, lobby = false) {
  const room = roomFixture();
  if (lobby) room.lifecycle = 'lobby';
  act(() => {
    f.receive('room:joined', own);
    f.receive('room:snapshot', room);
    if (!lobby) f.receive('game:snapshot', gameFixture());
  });
}
describe('entry and room routes', () => {
  it('creates a room from the display name and navigates to the lobby', async () => {
    const f = setup();
    fireEvent.change(screen.getByLabelText('Your display name'), {
      target: { value: 'Ayla' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Create a private room' }),
    );
    expect(f.socket.emit.mock.calls[0]?.[0]).toBe('room:create');
    await act(async () => {
      seat(f, true);
      f.ack({ ok: true, roomId, revision: 5 });
    });
    expect(
      screen.getByRole('heading', { name: 'Better with four.' }),
    ).toBeVisible();
  });
  it('joins with a name and room code', () => {
    const f = setup();
    fireEvent.change(screen.getByLabelText('Your display name'), {
      target: { value: 'Guest' },
    });
    fireEvent.change(screen.getByLabelText('Room code'), {
      target: { value: roomId },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Join room' }));
    expect(f.socket.emit.mock.calls[0]?.slice(0, 2)).toEqual([
      'room:join',
      { roomId, displayName: 'Guest' },
    ]);
  });
  it('shareable URLs only ask for a name and show missing-room errors', async () => {
    const f = setup(`/room/${roomId}`);
    expect(screen.queryByLabelText('Room code')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your display name'), {
      target: { value: 'Guest' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Join room' }));
    await act(async () =>
      f.ack({ ok: false, error: { code: 'ROOM_NOT_FOUND' } }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('does not exist');
  });
  it('rejects an invalid room link', () => {
    setup('/room/invalid');
    expect(screen.getByRole('alert')).toHaveTextContent('room link is invalid');
    expect(
      screen.queryByRole('button', { name: 'Join room' }),
    ).not.toBeInTheDocument();
  });
  it('provides a way home for an unknown route', () => {
    setup('/missing');
    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Return to Domino 101' }),
    ).toHaveAttribute('href', '/');
  });
  it('shows four opposite seats and enables host start only with four connected players', () => {
    const f = setup(`/room/${roomId}`);
    seat(f, true);
    expect(
      screen.getByRole('region', { name: 'Seat 3, Partner' }),
    ).toHaveTextContent('Leyla');
    expect(
      screen.getByRole('region', { name: 'Seat 2, Opponent' }),
    ).toHaveTextContent('Murad');
    expect(screen.getByRole('button', { name: 'Start match' })).toBeEnabled();
    const room = roomFixture();
    room.lifecycle = 'lobby';
    room.revision = 6;
    room.seats[3] = null;
    act(() => f.receive('room:snapshot', room));
    expect(screen.getByRole('button', { name: 'Start match' })).toBeDisabled();
    expect(screen.getByText('Open seat')).toBeVisible();
  });
  it('does not offer start to nonhosts', () => {
    const f = setup(`/room/${roomId}`);
    act(() => {
      f.receive('room:joined', {
        ...own,
        playerId: roomFixture().seats[1]!.playerId,
        seat: 1,
      });
      f.receive('room:snapshot', { ...roomFixture(), lifecycle: 'lobby' });
    });
    expect(
      screen.queryByRole('button', { name: 'Start match' }),
    ).not.toBeInTheDocument();
  });
  it('copies an invite link and handles clipboard denial', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const f = setup(`/room/${roomId}`);
    seat(f, true);
    fireEvent.click(screen.getByRole('button', { name: 'Copy invite link' }));
    expect(
      await screen.findByText('Copied. Send it to your friends.'),
    ).toBeVisible();
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/room/${roomId}`,
    );
    writeText.mockRejectedValueOnce(new Error('Denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(await screen.findByText(/Copy is unavailable/)).toBeVisible();
  });
  it('shows connection loss, removes private hand, and offers a fresh entry', async () => {
    const f = setup(`/room/${roomId}`);
    seat(f);
    act(() => f.socket.disconnect());
    expect(
      screen.getByText('Disconnected', { selector: '.connection' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('region', { name: 'Your hand' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('seat is reserved');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Leave table' }));
    });
    expect(screen.getByRole('heading', { name: 'Take a seat' })).toBeVisible();
  });
  it('renders only the local private hand and opponent counts', () => {
    const f = setup(`/room/${roomId}`);
    seat(f);
    const hand = screen.getByRole('region', { name: 'Your hand' });
    expect(within(hand).getAllByRole('button')).toHaveLength(7);
    expect(
      screen.queryByRole('button', { name: 'Play 6:6' }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('7 tiles')).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'Your turn' })).toBeVisible();
  });
});
