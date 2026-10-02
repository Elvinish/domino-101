import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDeck } from '@domino/game-engine';
import type { CommandResult } from '@domino/protocol';
import { RoomService } from './service.js';
import type { Room, Connection } from './types.js';

const services: RoomService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});
function connection() {
  const value = {
    id: randomUUID(),
    connected: true,
    isConnected: (): boolean => value.connected,
  };
  return value;
}
async function setup(history = 128) {
  const updates: Room[] = [];
  const service = new RoomService({
    onUpdate: (room) => {
      updates.push(room);
    },
    onJoined: () => {},
    makeDeck: createDeck,
    idempotencyLimit: history,
  });
  services.push(service);
  const clients = [connection(), connection(), connection(), connection()];
  const created = service.create(clients[0]!, { displayName: 'Host' });
  if (!created.ok) throw new Error('Create failed');
  for (const client of clients.slice(1))
    await service.join(client, {
      roomId: created.roomId,
      displayName: 'Guest',
    });
  await service.start(clients[0]!, { roomId: created.roomId });
  return { service, clients, room: updates.at(-1)!, roomId: created.roomId };
}
function error(result: CommandResult, code: string) {
  expect(result).toMatchObject({ ok: false, error: { code } });
}
describe('serialized room authority and bounded idempotency', () => {
  it('rejects queued commands from a socket that disconnected before execution, even for cached IDs', async () => {
    const { service, clients, room, roomId } = await setup();
    const actor = clients[3]!; // Sorted canonical deck puts 1:1 at seat 3.
    const accepted = {
      roomId,
      commandId: randomUUID(),
      expectedRevision: 5,
      command: { type: 'play' as const, tile: '1:1' as const },
    };
    expect(await service.game(actor, accepted)).toMatchObject({
      ok: true,
      revision: 6,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocked = room.queue.run(() => gate);
    const retry = service.game(actor, accepted);
    const rejected = expect(retry).rejects.toMatchObject({
      code: 'NOT_ROOM_MEMBER',
    });
    actor.connected = false;
    const disconnect = service.disconnect(actor.id);
    release();
    await blocked;
    await rejected;
    await disconnect;
    expect(room.revision).toBe(7);
    expect(room.match!.state.phase).toBe('playing');
    if (room.match!.state.phase === 'playing')
      expect(room.match!.state.round.board).toHaveLength(1);
    expect(room.seats[3]!.socketId).toBeNull();
  });
  it('rejects an unrelated socket object that supplies another room ID', async () => {
    const { service, roomId } = await setup();
    const stranger: Connection = connection();
    await expect(
      service.game(stranger, {
        roomId,
        commandId: randomUUID(),
        expectedRevision: 5,
        command: { type: 'pass' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_ROOM_MEMBER' });
  });
  it('bounds history and keeps failed results stable until eviction', async () => {
    const { service, clients, room, roomId } = await setup(2);
    const actor = clients[3]!;
    const first = {
      roomId,
      commandId: randomUUID(),
      expectedRevision: 5,
      command: { type: 'pass' as const },
    };
    const result = await service.game(actor, first);
    error(result, 'PASS_NOT_ALLOWED');
    expect(await service.game(actor, first)).toEqual(result);
    error(
      await service.game(actor, { ...first, expectedRevision: 4 }),
      'DUPLICATE_COMMAND_CONFLICT',
    );
    for (let index = 0; index < 2; index++)
      await service.game(actor, { ...first, commandId: randomUUID() });
    expect(room.seats[3]!.commands.size).toBe(2);
    expect(room.seats[3]!.commands.has(first.commandId)).toBe(false);
    expect(
      await service.game(actor, {
        ...first,
        command: { type: 'play', tile: '1:1' },
      }),
    ).toMatchObject({ ok: true, revision: 6 });
  });
  it('scopes command IDs to the player and checks revision after a retained retry window', async () => {
    const { service, clients, roomId } = await setup(1);
    const id = randomUUID();
    error(
      await service.game(clients[0]!, {
        roomId,
        commandId: id,
        expectedRevision: 5,
        command: { type: 'pass' },
      }),
      'NOT_YOUR_TURN',
    );
    expect(
      await service.game(clients[3]!, {
        roomId,
        commandId: id,
        expectedRevision: 5,
        command: { type: 'play', tile: '1:1' },
      }),
    ).toMatchObject({ ok: true });
  });
  it('does not let a held room queue block another room', async () => {
    const { service, room } = await setup();
    let release!: () => void;
    const held = room.queue.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();
    try {
      const a = connection(),
        b = connection();
      const created = service.create(a, { displayName: 'Other host' });
      if (!created.ok) throw new Error('Create failed');
      expect(
        await service.join(b, { roomId: created.roomId, displayName: 'Guest' }),
      ).toMatchObject({ ok: true, revision: 2 });
    } finally {
      release();
      await held;
    }
  });
  it('admits only one of concurrent membership attempts into distinct rooms', async () => {
    const { service, roomId, clients } = await setup();
    // Active room rejects joining; create two fresh lobbies for the membership race.
    const first = service.create(connection(), { displayName: 'One' });
    const second = service.create(connection(), { displayName: 'Two' });
    if (!first.ok || !second.ok) throw new Error('Create failed');
    const guest = connection();
    const results = await Promise.allSettled([
      service.join(guest, { roomId: first.roomId, displayName: 'Guest' }),
      service.join(guest, { roomId: second.roomId, displayName: 'Guest' }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === 'rejected'),
    ).toMatchObject({ reason: { code: 'ALREADY_ROOM_MEMBER' } });
    await expect(
      service.join(clients[0]!, { roomId, displayName: 'Again' }),
    ).rejects.toMatchObject({ code: 'ALREADY_ROOM_MEMBER' });
  });
});
