import { afterEach, expect, it } from 'vitest';
import {
  CLIENT_EVENTS,
  roomSnapshotSchema,
  gameSnapshotSchema,
} from '@domino/protocol';
import { harness, send, until, command } from './harness.js';
import { botClock } from './bot-clock.js';
import { MemoryPersistence } from './memory-persistence.js';
import { randomUUID } from 'node:crypto';
import { createDeck } from '@domino/game-engine';
const opened: Awaited<ReturnType<typeof harness>>[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((h) => h.close()));
});
async function setup() {
  const timing = botClock(),
    store = new MemoryPersistence();
  const h = await harness({
    botClock: timing.clock,
    persistence: store,
    makeDeck: createDeck,
  });
  opened.push(h);
  const host = await h.connect();
  const created = await send(host, CLIENT_EVENTS.create, {
    displayName: 'Host',
  });
  if (!created.ok) throw new Error('Expected room');
  const roomId = created.roomId;
  const manage = (action: unknown) =>
    send(host, CLIENT_EVENTS.bots, {
      roomId,
      expectedRevision: host.room!.revision,
      action,
    });
  return { h, host, roomId, timing, store, manage };
}
it('supports real host add/remove/fill and one-human gameplay without bot sockets or private bot events', async () => {
  const f = await setup();
  expect((await f.manage({ type: 'add', seat: 2 })).ok).toBe(true);
  expect(f.host.room!.seats[2]).toMatchObject({
    kind: 'bot',
    seat: 2,
    connected: false,
  });
  expect((await f.manage({ type: 'remove', seat: 2 })).ok).toBe(true);
  expect((await f.manage({ type: 'fill' })).ok).toBe(true);
  expect(f.h.clients).toHaveLength(1);
  expect(f.host.events.filter((e) => e.event === 'room:session')).toHaveLength(
    1,
  );
  expect(
    (await send(f.host, CLIENT_EVENTS.start, { roomId: f.roomId })).ok,
  ).toBe(true);
  await until(() => f.host.game !== null);
  expect(f.host.room!.isPaused).toBe(false);
  const botTurn = f.timing.next()!;
  const revision = f.host.game!.revision;
  f.timing.fire();
  botTurn.callback();
  await until(() => f.host.game!.revision === revision + 1);
  expect(f.host.game!.public.board).toHaveLength(1);
  const record = f.store.rooms.get(f.roomId)!;
  expect(
    record.players
      .slice(1)
      .every((p) => p.kind === 'bot' && p.tokenHash === null),
  ).toBe(true);
  for (const event of f.host.events) {
    if (event.event === 'room:snapshot')
      expect(roomSnapshotSchema.safeParse(event.payload).success).toBe(true);
    if (event.event === 'game:snapshot') {
      const game = gameSnapshotSchema.parse(event.payload);
      expect(game.public).not.toHaveProperty('revealedHands');
      expect(game.playerId).toBe(f.host.joined!.playerId);
      expect(game.private.hand).toEqual(
        record.matchState!.phase === 'starter-selection'
          ? record.matchState!.hands[0]
          : record.matchState!.round.hands[0],
      );
    }
    if (event.event !== 'room:session')
      expect(JSON.stringify(event.payload)).not.toContain(
        f.host.session!.reconnectToken,
      );
  }
  expect(
    f.store.rooms
      .get(f.roomId)!
      .players.reduce((n, p) => n + p.commands.length, 0),
  ).toBe(1);
});
it('rejects non-host, outsider, occupied, full and malformed/spoofed bot requests', async () => {
  const f = await setup(),
    guest = await f.h.connect(),
    outsider = await f.h.connect();
  await send(guest, CLIENT_EVENTS.join, {
    roomId: f.roomId,
    displayName: 'Guest',
  });
  const payload = {
    roomId: f.roomId,
    expectedRevision: f.host.room!.revision,
    action: { type: 'fill' },
  };
  expect(await send(guest, CLIENT_EVENTS.bots, payload)).toMatchObject({
    ok: false,
    error: { code: 'NOT_HOST' },
  });
  expect(await send(outsider, CLIENT_EVENTS.bots, payload)).toMatchObject({
    ok: false,
    error: { code: 'NOT_ROOM_MEMBER' },
  });
  expect(await f.manage({ type: 'add', seat: 1 })).toMatchObject({
    ok: false,
    error: { code: 'INVALID_PAYLOAD' },
  });
  for (const action of [
    { type: 'add', seat: 4 },
    { type: 'add', seat: 2, playerId: randomUUID() },
    { type: 'add', seat: 2, team: 'B' },
  ])
    expect(await f.manage(action)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
  expect((await f.manage({ type: 'fill' })).ok).toBe(true);
  expect(await f.manage({ type: 'fill' })).toMatchObject({
    ok: false,
    error: { code: 'ROOM_FULL' },
  });
  expect(f.host.room!.seats.filter(Boolean)).toHaveLength(4);
});
it('reserves current socket ownership for bot management after replacement and rejects reconnect as a bot', async () => {
  const f = await setup();
  await f.manage({ type: 'fill' });
  const replacement = await f.h.connect();
  await send(replacement, CLIENT_EVENTS.reconnect, f.host.session!);
  expect(replacement.room!.seats.map((p) => p?.displayName)).toEqual(
    f.host.room!.seats.map((p) => p?.displayName),
  );
  expect(await f.manage({ type: 'remove', seat: 1 })).toMatchObject({
    ok: false,
    error: { code: 'NOT_ROOM_MEMBER' },
  });
  expect(
    await send(replacement, CLIENT_EVENTS.bots, {
      roomId: f.roomId,
      expectedRevision: replacement.room!.revision,
      action: { type: 'remove', seat: 1 },
    }),
  ).toMatchObject({ ok: true });
  const intruder = await f.h.connect();
  expect(
    await send(intruder, CLIENT_EVENTS.reconnect, {
      ...f.host.session!,
      playerId: replacement.room!.seats[2]!.playerId,
    }),
  ).toMatchObject({ ok: false, error: { code: 'INVALID_SESSION' } });
  f.host.socket.disconnect();
  expect(replacement.room!.seats[0]!.connected).toBe(true);
});
it('rejects bot edits during play and advances after a human command using the normal real socket path', async () => {
  const f = await setup();
  await f.manage({ type: 'fill' });
  await send(f.host, CLIENT_EVENTS.start, { roomId: f.roomId });
  expect(await f.manage({ type: 'remove', seat: 3 })).toMatchObject({
    ok: false,
    error: { code: 'ROOM_ALREADY_STARTED' },
  });
  f.timing.fire();
  await until(() => !!f.host.game?.private.legalActions.length);
  const revision = f.host.game!.revision;
  expect(
    (await command(f.host, f.host.game!.private.legalActions[0]!)).ok,
  ).toBe(true);
  f.timing.fire();
  await until(() => f.host.game!.revision === revision + 2);
  expect(f.host.game!.public.board.length).toBeGreaterThanOrEqual(2);
});
