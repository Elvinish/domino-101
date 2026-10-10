import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fakeClient,
  gameFixture,
  own,
  roomFixture,
  roomId,
} from '../test/multiplayer';

const clients: ReturnType<typeof fakeClient>[] = [];
function setup() {
  const fake = fakeClient();
  clients.push(fake);
  fake.client.connect();
  return fake;
}
function seated() {
  const f = setup();
  f.receive('room:joined', own);
  f.receive('room:snapshot', roomFixture());
  f.receive('game:snapshot', gameFixture());
  return f;
}
afterEach(() => {
  clients.splice(0).forEach((f) => f.client.dispose());
  vi.useRealTimers();
});
describe('multiplayer transport state', () => {
  it.each(['disconnect', 'room:replaced'])(
    'resets voice on %s and rebinds membership without enabling microphone',
    (event) => {
      const f = seated();
      const reset = vi.spyOn(f.client.voice, 'reset');
      const enable = vi.spyOn(f.client.voice, 'enableMicrophone');
      const membership = vi.spyOn(f.client.voice, 'setMembership');
      if (event === 'disconnect') f.socket.disconnect();
      else f.receive(event, {});
      expect(reset).toHaveBeenCalled();
      f.socket.connect();
      f.receive('room:joined', own);
      expect(membership).toHaveBeenCalledWith(own);
      expect(enable).not.toHaveBeenCalled();
    },
  );
  it('ignores queued private snapshots after disconnect', () => {
    const f = seated();
    f.socket.disconnect();
    f.receive('game:snapshot', { ...gameFixture(), revision: 20 });
    expect(f.client.getSnapshot().game).toBeNull();
  });
  it('validates entry locally and normalizes names', async () => {
    const f = setup();
    expect(await f.client.create(' ')).toBe(false);
    expect(f.socket.emit).not.toHaveBeenCalled();
    const request = f.client.create(' Ayla ');
    expect(f.socket.emit.mock.calls[0]?.slice(0, 2)).toEqual([
      'room:create',
      { displayName: 'Ayla' },
    ]);
    f.ack({ ok: true, roomId, revision: 1 });
    expect(await request).toBe(true);
  });
  it('sends only name and code when joining', async () => {
    const f = setup();
    const request = f.client.join(`  ${roomId.toUpperCase()}  `, 'Guest');
    expect(f.socket.emit.mock.calls[0]?.slice(0, 2)).toEqual([
      'room:join',
      { roomId, displayName: 'Guest' },
    ]);
    f.ack({ ok: false, error: { code: 'ROOM_FULL' } });
    expect(await request).toBe(false);
    expect(f.client.getSnapshot().error).toBe('errors.ROOM_FULL');
  });
  it('sends UUID and latest revision, blocks double submission, and never optimistically mutates', async () => {
    const f = seated();
    const before = f.client.getSnapshot().game;
    const request = f.client.act({ type: 'play', tile: '1:1', end: 'start' });
    expect(f.socket.emit.mock.calls[0]?.[1]).toMatchObject({
      expectedRevision: 5,
      commandId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      roomId,
    });
    expect(f.client.getSnapshot().game).toBe(before);
    expect(f.client.getSnapshot().pending).toBe(true);
    expect(await f.client.act({ type: 'pass' })).toBe(false);
    expect(f.socket.emit).toHaveBeenCalledTimes(1);
    f.ack({ ok: true, roomId, revision: 6 });
    await request;
    expect(f.client.getSnapshot().game).toBe(before);
  });
  it('ignores older snapshots and acknowledgement revisions', async () => {
    const f = seated();
    const request = f.client.start();
    const room = roomFixture();
    room.revision = 7;
    f.receive('room:snapshot', room);
    const game = gameFixture();
    game.revision = 7;
    f.receive('game:snapshot', game);
    f.receive('room:snapshot', roomFixture());
    f.receive('game:snapshot', gameFixture());
    f.ack({ ok: true, roomId, revision: 2 });
    await request;
    expect(f.client.getSnapshot().game?.revision).toBe(7);
    expect(f.client.getSnapshot().room?.revision).toBe(7);
  });
  it('recovers from stale revision using snapshots without retrying the rejected action', async () => {
    const f = seated();
    const request = f.client.act({ type: 'pass' });
    const game = gameFixture();
    game.revision = 6;
    f.receive('room:snapshot', { ...roomFixture(), revision: 6 });
    f.receive('game:snapshot', game);
    f.ack({ ok: false, error: { code: 'STALE_REVISION' } });
    await request;
    expect(f.client.getSnapshot().error).toBe('errors.STALE_REVISION');
    expect(f.client.getSnapshot().game?.revision).toBe(6);
    expect(f.socket.emit).toHaveBeenCalledTimes(1);
  });
  it('ignores foreign rooms and private projections for another player', () => {
    const f = seated();
    const before = f.client.getSnapshot();
    f.receive('room:snapshot', {
      ...roomFixture(),
      roomId: 'b'.repeat(32),
      revision: 8,
    });
    f.receive('game:snapshot', {
      ...gameFixture(),
      playerId: roomFixture().seats[1]!.playerId,
      seat: 1,
      revision: 8,
    });
    expect(f.client.getSnapshot()).toBe(before);
  });
  it('fails closed on malformed snapshots without retaining private data', () => {
    const f = seated();
    f.receive('game:snapshot', { ...gameFixture(), hiddenHands: [] });
    expect(f.client.getSnapshot().status).toBe('disconnected');
    expect(f.client.getSnapshot().game).toBeNull();
  });
  it('clears private hand and pending work on disconnect; late acknowledgements cannot restore it', async () => {
    const f = seated();
    const request = f.client.act({ type: 'pass' });
    f.socket.disconnect();
    expect(await request).toBe(false);
    f.ack({ ok: true, roomId, revision: 6 });
    expect(f.client.getSnapshot()).toMatchObject({
      status: 'disconnected',
      pending: false,
      game: null,
    });
    expect(await f.client.act({ type: 'pass' })).toBe(false);
    expect(f.socket.connect).toHaveBeenCalledTimes(1);
  });
  it('times out uncertain requests and never automatically resends', async () => {
    vi.useFakeTimers();
    const f = seated();
    const request = f.client.start();
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await request).toBe(false);
    expect(f.client.getSnapshot().status).toBe('disconnected');
    expect(f.socket.emit).toHaveBeenCalledTimes(1);
  });
  it('does not send during mismatched revisions or a paused room', async () => {
    const f = seated();
    f.receive('room:snapshot', { ...roomFixture(), revision: 6 });
    expect(await f.client.act({ type: 'pass' })).toBe(false);
    f.receive('game:snapshot', { ...gameFixture(), revision: 6 });
    f.receive('room:snapshot', {
      ...roomFixture(),
      revision: 7,
      isPaused: true,
    });
    expect(await f.client.act({ type: 'pass' })).toBe(false);
    expect(f.socket.emit).not.toHaveBeenCalled();
  });
  it('cleans all listeners and snapshots when leaving', async () => {
    const f = seated();
    const leaving = f.client.leave();
    f.ack({ ok: true, roomId, revision: 6 });
    await leaving;
    expect(f.client.getSnapshot()).toMatchObject({
      joined: null,
      room: null,
      game: null,
      status: 'connected',
    });
    expect(f.socket.removeAllListeners).toHaveBeenCalledTimes(1);
  });
  it('validates chat history, sends bounded intent, and tracks unread messages', async () => {
    const f = seated();
    f.receive('chat:history', { roomId, messages: [] });
    const request = f.client.sendChat(' hello ');
    expect(f.socket.emit.mock.calls.at(-1)?.slice(0, 2)).toEqual([
      'chat:send',
      expect.objectContaining({ roomId, text: ' hello ' }),
    ]);
    f.ack({
      ok: true,
      commandId: f.socket.emit.mock.calls.at(-1)?.[1].commandId,
    });
    expect(await request).toBe(true);
    f.receive('chat:message', {
      messageId: '20000000-0000-4000-8000-000000000000',
      sender: {
        playerId: '00000000-0000-4000-8000-000000000001',
        displayName: 'Guest',
        seat: 1,
      },
      text: 'hello',
      timestamp: 1,
    });
    expect(f.client.getSnapshot().unreadChat).toBe(1);
    f.client.markChatRead();
    expect(f.client.getSnapshot().unreadChat).toBe(0);
  });
  it('clears chat and cancels social requests on disconnect', async () => {
    const f = seated();
    f.receive('chat:message', {
      messageId: '20000000-0000-4000-8000-000000000000',
      sender: {
        playerId: '00000000-0000-4000-8000-000000000001',
        displayName: 'Guest',
        seat: 1,
      },
      text: 'hello',
      timestamp: 1,
    });
    const request = f.client.sendChat('hello');
    f.socket.disconnect();
    expect(await request).toBe(false);
    expect(f.client.getSnapshot().chat).toEqual([]);
  });
});
