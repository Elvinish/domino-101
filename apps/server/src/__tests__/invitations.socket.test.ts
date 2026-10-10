import { afterEach, expect, it } from 'vitest';
import { CLIENT_EVENTS } from '@domino/protocol';
import { harness, send } from './harness.js';
import { MemoryPersistence } from './memory-persistence.js';

const servers: Awaited<ReturnType<typeof harness>>[] = [];
afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  servers.length = 0;
});
it('restores a persisted lobby and joins its exact canonical code with independent identity and snapshots', async () => {
  const persistence = new MemoryPersistence();
  const first = await harness({ persistence });
  servers.push(first);
  const host = await first.connect();
  const created = await send(host, CLIENT_EVENTS.create, {
    displayName: 'Host',
  });
  if (!created.ok) throw new Error('Create failed');
  const session = host.session!;
  await first.close();
  servers.pop();
  const restored = await harness({ persistence });
  servers.push(restored);
  const returning = await restored.connect();
  expect((await send(returning, CLIENT_EVENTS.reconnect, session)).ok).toBe(
    true,
  );
  const guest = await restored.connect();
  expect(
    await send(guest, CLIENT_EVENTS.join, {
      roomId: ` ${created.roomId.toUpperCase()} `,
      displayName: ' Guest ',
    }),
  ).toMatchObject({ ok: true, roomId: created.roomId });
  expect(guest.joined!.roomId).toBe(created.roomId);
  expect(guest.joined!.playerId).not.toBe(session.playerId);
  // The guest acknowledgement does not order delivery on the host's socket.
  await expect.poll(() => returning.room).toEqual(guest.room);
  expect(
    guest.room!.seats.slice(0, 2).map((player) => player!.displayName),
  ).toEqual(['Host', 'Guest']);
  expect(persistence.rooms.size).toBe(1);
  const missing = await restored.connect();
  expect(
    await send(missing, CLIENT_EVENTS.join, {
      roomId: 'f'.repeat(32),
      displayName: 'Missing',
    }),
  ).toMatchObject({ ok: false, error: { code: 'ROOM_NOT_FOUND' } });
  expect(persistence.rooms.size).toBe(1);
});
