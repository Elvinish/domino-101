import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDeck } from '@domino/game-engine';
import type { ReconnectSession } from '@domino/protocol';
import { MemoryPersistence } from '../__tests__/memory-persistence.js';
import { RoomService } from './service.js';
import { serializeRoom } from '../persistence/codec.js';
import type { Room } from './types.js';
import { ChatService } from '../chat/service.js';

const active: RoomService[] = [];
afterEach(async () => {
  await Promise.all(active.splice(0).map((service) => service.close()));
});
function connection() {
  const value = {
    id: randomUUID(),
    connected: true,
    isConnected: () => value.connected,
  };
  return value;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function setup(start = true) {
  const store = new MemoryPersistence();
  const updates = vi.fn<(room: Room) => void>();
  const sessions = new Map<string, ReconnectSession>();
  const joined = vi.fn();
  const replaced = vi.fn();
  const service = new RoomService({
    persistence: store,
    makeDeck: createDeck,
    onUpdate: updates,
    onJoined: joined,
    onSession: (id, value) => sessions.set(id, value),
    onReplaced: replaced,
  });
  active.push(service);
  const players = Array.from({ length: 4 }, connection);
  const created = await service.createAsync(players[0]!, {
    displayName: 'Host',
  });
  if (!created.ok) throw new Error('Create failed');
  const roomId = created.roomId;
  for (let seat = 1; seat < 4; seat++)
    await service.join(players[seat]!, {
      roomId,
      displayName: `Player ${seat}`,
    });
  if (start) await service.start(players[0]!, { roomId });
  const room = updates.mock.lastCall![0];
  const move = {
    roomId,
    commandId: randomUUID(),
    expectedRevision: 5,
    command: { type: 'play' as const, tile: '1:1' as const },
  };
  return {
    store,
    service,
    players,
    updates,
    sessions,
    joined,
    replaced,
    room,
    roomId,
    move,
  };
}
describe('durable write ordering and failure recovery', () => {
  it('keeps RAM, memberships and broadcasts unchanged until commit resolves', async () => {
    const f = await setup();
    const before = serializeRoom(f.room);
    const gate = deferred(),
      entered = deferred();
    f.store.beforeWrite = () => {
      entered.resolve();
      return gate.promise;
    };
    const calls = f.updates.mock.calls.length;
    const pending = f.service.game(f.players[3]!, f.move);
    await entered.promise;
    expect(serializeRoom(f.room)).toEqual(before);
    expect(f.store.rooms.get(f.roomId)).toEqual(before);
    expect(f.updates).toHaveBeenCalledTimes(calls);
    gate.resolve();
    expect(await pending).toMatchObject({ ok: true, revision: 6 });
    expect(f.store.rooms.get(f.roomId)).toEqual(serializeRoom(f.room));
    expect(f.updates).toHaveBeenCalledTimes(calls + 1);
  });
  it('fails closed on a rejected write, including already queued commands', async () => {
    const f = await setup();
    const before = serializeRoom(f.room),
      calls = f.updates.mock.calls.length;
    f.store.fail = true;
    const rejected = expect(
      f.service.game(f.players[3]!, f.move),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    const queued = expect(
      f.service.game(f.players[3]!, f.move),
    ).rejects.toMatchObject({ code: 'SERVER_BUSY' });
    await Promise.all([rejected, queued]);
    expect(serializeRoom(f.room)).toEqual(before);
    expect(f.store.rooms.get(f.roomId)).toEqual(before);
    expect(f.updates).toHaveBeenCalledTimes(calls);
    await f.service.disconnect(f.players[0]!.id);
    await f.service.close();
    expect(f.store.rooms.get(f.roomId)).toEqual(before);
  });
  it('never overwrites an uncertain commit during disconnect or shutdown; recovery reads its result', async () => {
    const f = await setup();
    f.store.uncertain = true;
    await expect(f.service.game(f.players[3]!, f.move)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(f.room.revision).toBe(5);
    expect(f.store.rooms.get(f.roomId)?.revision).toBe(6);
    await f.service.disconnect(f.players[3]!.id);
    await f.service.close();
    expect(f.store.rooms.get(f.roomId)?.revision).toBe(6);
    f.store.uncertain = false;
    const recovered = new RoomService({
      persistence: f.store,
      onJoined: () => {},
      onUpdate: () => {},
    });
    active.push(recovered);
    await recovered.restore();
    const replacement = connection();
    await recovered.reconnect(replacement, f.sessions.get(f.players[3]!.id)!);
    expect(await recovered.game(replacement, f.move)).toMatchObject({
      ok: true,
      revision: 6,
    });
    expect(f.store.rooms.get(f.roomId)?.revision).toBe(7);
  });
  it.each(['start', 'leave', 'disconnect', 'reconnect'] as const)(
    'stages %s and preserves the committed room on failure',
    async (operation) => {
      const f = await setup(false);
      const before = serializeRoom(f.room),
        calls = f.updates.mock.calls.length;
      f.store.fail = true;
      const pending =
        operation === 'start'
          ? f.service.start(f.players[0]!, { roomId: f.roomId })
          : operation === 'leave'
            ? f.service.leave(f.players[0]!, { roomId: f.roomId })
            : operation === 'disconnect'
              ? f.service.disconnect(f.players[0]!.id)
              : f.service.reconnect(
                  connection(),
                  f.sessions.get(f.players[0]!.id)!,
                );
      await expect(pending).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(serializeRoom(f.room)).toEqual(before);
      expect(f.store.rooms.get(f.roomId)).toEqual(before);
      expect(f.updates).toHaveBeenCalledTimes(calls);
      expect(f.replaced).not.toHaveBeenCalled();
    },
  );
  it('does not reveal a reconnect identity or success for a failed create/join', async () => {
    const f = await setup(false);
    f.store.fail = true;
    const newcomer = connection(),
      sessions = f.sessions.size,
      calls = f.joined.mock.calls.length;
    await expect(
      f.service.createAsync(newcomer, { displayName: 'New' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(f.sessions.size).toBe(sessions);
    expect(f.joined).toHaveBeenCalledTimes(calls);
    f.store.fail = false;
    const other = await f.service.createAsync(connection(), {
      displayName: 'Other',
    });
    if (!other.ok) throw new Error('Create failed');
    const before = f.store.rooms.get(other.roomId);
    f.store.fail = true;
    await expect(
      f.service.join(newcomer, { roomId: other.roomId, displayName: 'New' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(f.sessions.has(newcomer.id)).toBe(false);
    expect(f.store.rooms.get(other.roomId)).toEqual(before);
    f.store.fail = false;
  });
  it('reserves socket ownership across concurrent async writes to different rooms', async () => {
    const f = await setup(false);
    const one = await f.service.createAsync(connection(), {
      displayName: 'One',
    });
    const two = await f.service.createAsync(connection(), {
      displayName: 'Two',
    });
    if (!one.ok || !two.ok) throw new Error('Create failed');
    const guest = connection(),
      gate = deferred(),
      entered = deferred();
    f.store.beforeWrite = () => {
      entered.resolve();
      return gate.promise;
    };
    const pending = f.service.join(guest, {
      roomId: one.roomId,
      displayName: 'Guest',
    });
    await entered.promise;
    await expect(
      f.service.join(guest, { roomId: two.roomId, displayName: 'Guest' }),
    ).rejects.toMatchObject({ code: 'ALREADY_ROOM_MEMBER' });
    gate.resolve();
    expect((await pending).ok).toBe(true);
  });
  it('cleans up a socket that disconnects while its join is being committed', async () => {
    const f = await setup(false);
    const other = await f.service.createAsync(connection(), {
      displayName: 'Other',
    });
    if (!other.ok) throw new Error('Create failed');
    const guest = connection(),
      gate = deferred(),
      entered = deferred();
    f.store.beforeWrite = () => {
      entered.resolve();
      return gate.promise;
    };
    const pending = f.service.join(guest, {
      roomId: other.roomId,
      displayName: 'Guest',
    });
    await entered.promise;
    guest.connected = false;
    await f.service.disconnect(guest.id);
    gate.resolve();
    await pending;
    await f.service.runRoom(other.roomId, () => {});
    expect(f.service.chatRecipients(other.roomId)).not.toContain(guest.id);
    expect(f.store.rooms.get(other.roomId)?.revision).toBe(3);
    expect(f.sessions.has(guest.id)).toBe(false);
  });
  it.each(['chat', 'reaction'] as const)(
    'does not publish %s when the durable write fails and blocks game mutations',
    async (kind) => {
      const f = await setup();
      const published = vi.fn();
      const chat = new ChatService({
        persistence: f.store,
        resolveMember: (conn, roomId) => f.service.chatMember(conn, roomId),
        recipients: (roomId) => f.service.chatRecipients(roomId),
        runRoom: (roomId, operation) => f.service.runRoom(roomId, operation),
        onPersistenceFailure: (roomId) => f.service.blockRoom(roomId),
        onMessage: published,
        onHistory: () => {},
        onReaction: published,
      });
      f.store.fail = true;
      const base = { roomId: f.roomId, commandId: randomUUID() };
      const result =
        kind === 'chat'
          ? await chat.send(f.players[0]!, { ...base, text: 'hello' })
          : await chat.sendReaction(f.players[0]!, {
              ...base,
              reaction: 'thumbs-up',
            });
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'INTERNAL_ERROR' },
      });
      expect(published).not.toHaveBeenCalled();
      expect(f.store.chat.size).toBe(0);
      await expect(f.service.game(f.players[3]!, f.move)).rejects.toMatchObject(
        { code: 'SERVER_BUSY' },
      );
    },
  );
});
