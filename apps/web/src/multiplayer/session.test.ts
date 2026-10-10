import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserSessions, sessionKey } from './session';
import {
  fakeClient,
  gameFixture,
  own,
  roomFixture,
  roomId,
} from '../test/multiplayer';

const session = {
  roomId,
  playerId: own.playerId,
  reconnectToken: 'a'.repeat(43),
};
const clients: ReturnType<typeof fakeClient>[] = [];
function setup() {
  const f = fakeClient(browserSessions());
  clients.push(f);
  f.client.setRoom(roomId);
  f.client.connect();
  return f;
}
function snapshots(f: ReturnType<typeof fakeClient>) {
  f.receive('room:joined', own);
  f.receive('room:snapshot', roomFixture());
  f.receive('game:snapshot', gameFixture());
}
afterEach(() => {
  clients.splice(0).forEach((f) => f.client.dispose());
  sessionStorage.clear();
});
describe('private session persistence and restoration', () => {
  it('never adopts a host credential from shared localStorage in a new tab', () => {
    localStorage.setItem(sessionKey(roomId), JSON.stringify(session));
    const f = setup();
    expect(f.socket.emit).not.toHaveBeenCalled();
    expect(browserSessions().read(roomId)).toBeNull();
  });
  it('dismissing a replaced tab preserves the active tab saved session', async () => {
    const f = setup();
    snapshots(f);
    f.receive('room:session', session);
    f.receive('room:replaced', {});
    await f.client.leave();
    expect(browserSessions().read(roomId)).toEqual(session);
    expect(f.client.getSnapshot().joined).toBeNull();
    expect(f.socket.emit).not.toHaveBeenCalled();
  });
  it('persists only minimal owning session outside UI state', () => {
    const f = setup();
    snapshots(f);
    f.receive('room:session', session);
    expect(JSON.parse(sessionStorage.getItem(sessionKey(roomId))!)).toEqual(
      session,
    );
    expect(
      JSON.stringify(f.client.getSnapshot()).includes(session.reconnectToken),
    ).toBe(false);
    f.client.dispose();
    expect(browserSessions().read(roomId)).toEqual(session);
  });
  it('automatically restores the matching saved seat on a fresh client', async () => {
    browserSessions().write(session);
    const f = setup();
    expect(f.socket.emit.mock.calls[0]?.slice(0, 2)).toEqual([
      'room:reconnect',
      session,
    ]);
    expect(f.client.getSnapshot().restoring).toBe(true);
    snapshots(f);
    f.ack({ ok: true, roomId, revision: 5 });
    await Promise.resolve();
    expect(f.client.getSnapshot()).toMatchObject({
      restoring: false,
      joined: own,
      game: gameFixture(),
    });
  });
  it('does not restore a session into an unrelated route', () => {
    browserSessions().write(session);
    const f = fakeClient(browserSessions());
    clients.push(f);
    f.client.setRoom('b'.repeat(32));
    f.client.connect();
    expect(f.socket.emit).not.toHaveBeenCalled();
  });
  it('clears unusable credentials on invalid-session failure and falls back to entry', async () => {
    browserSessions().write(session);
    const f = setup();
    f.ack({ ok: false, error: { code: 'INVALID_SESSION' } });
    await Promise.resolve();
    expect(browserSessions().read(roomId)).toBeNull();
    expect(f.client.getSnapshot()).toMatchObject({
      joined: null,
      game: null,
      pending: false,
      restoring: false,
    });
    expect(f.client.getSnapshot().error).toBe('errors.INVALID_SESSION');
  });
  it('keeps credentials on transient server/network failures', async () => {
    browserSessions().write(session);
    const f = setup();
    f.ack({ ok: false, error: { code: 'SERVER_BUSY' } });
    await Promise.resolve();
    f.socket.disconnect();
    expect(browserSessions().read(roomId)).toEqual(session);
  });
  it('automatically restores when the transport connects again, without replaying gameplay', async () => {
    const f = setup();
    snapshots(f);
    f.receive('room:session', session);
    const request = f.client.act({ type: 'pass' });
    f.socket.disconnect();
    await request;
    f.socket.connect();
    expect(f.socket.emit.mock.calls.map((call) => call[0])).toEqual([
      'game:command',
      'room:reconnect',
    ]);
    snapshots(f);
    f.ack({ ok: true, roomId, revision: 5 });
    await Promise.resolve();
    expect(f.client.getSnapshot().game?.private.hand).toEqual(
      gameFixture().private.hand,
    );
  });
  it('stops replacement-tab reconnect loops and discards old private state', () => {
    const f = setup();
    snapshots(f);
    f.receive('room:session', session);
    f.receive('room:replaced', {});
    expect(f.client.getSnapshot()).toMatchObject({
      replaced: true,
      game: null,
      status: 'disconnected',
    });
    f.socket.connect();
    expect(f.socket.emit).not.toHaveBeenCalled();
    expect(browserSessions().read(roomId)).toEqual(session);
  });
  it('explicit leave clears storage and sends a revocation request', async () => {
    const f = setup();
    snapshots(f);
    f.receive('room:session', session);
    const leaving = f.client.leave();
    expect(browserSessions().read(roomId)).toBeNull();
    expect(f.socket.emit.mock.calls.at(-1)?.slice(0, 2)).toEqual([
      'room:leave',
      { roomId },
    ]);
    f.ack({ ok: true, roomId, revision: 6 });
    await leaving;
    expect(f.client.getSnapshot().joined).toBeNull();
  });
  it('handles denied storage without logging or crashing and keeps the in-tab session', () => {
    const store = browserSessions(() => {
      throw new Error('Denied');
    });
    expect(store.read(roomId)).toBeNull();
    expect(store.write(session)).toBe(false);
    expect(() => store.clear(roomId)).not.toThrow();
    const f = fakeClient(store);
    clients.push(f);
    f.client.connect();
    snapshots(f);
    f.receive('room:session', session);
    expect(f.client.getSnapshot().storageWarning).toBe('errors.storage');
  });
  it('rejects corrupt or foreign stored sessions', () => {
    sessionStorage.setItem(
      sessionKey(roomId),
      JSON.stringify({ ...session, hand: ['1:1'] }),
    );
    expect(browserSessions().read(roomId)).toBeNull();
    expect(sessionStorage.getItem(sessionKey(roomId))).toBeNull();
    sessionStorage.setItem(sessionKey(roomId), '{bad');
    expect(browserSessions().read(roomId)).toBeNull();
  });
  it('ignores a session addressed to another player', () => {
    const f = setup();
    snapshots(f);
    f.receive('room:session', {
      ...session,
      playerId: roomFixture().seats[1]!.playerId,
    });
    expect(sessionStorage.getItem(sessionKey(roomId))).toBeNull();
  });
  it('does not log stored secrets on storage failure', () => {
    const log = vi.spyOn(console, 'error');
    browserSessions(() => {
      throw new Error(session.reconnectToken);
    }).write(session);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
