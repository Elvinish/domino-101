import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  roomSessionSchema,
} from '@domino/protocol';
import { command, harness, send, until } from './harness.js';

const opened: Awaited<ReturnType<typeof harness>>[] = [];
async function setup(options: Parameters<typeof harness>[0] = {}) {
  const h = await harness(options);
  opened.push(h);
  return h;
}
afterEach(async () => {
  await Promise.all(opened.splice(0).map((h) => h.close()));
});

describe('secure real-socket seat restoration', () => {
  it('issues a unique 256-bit private session to each human, never to peers or logs', async () => {
    const h = await setup();
    const logs = [
      vi.spyOn(h.app.log, 'info'),
      vi.spyOn(h.app.log, 'warn'),
      vi.spyOn(h.app.log, 'error'),
      vi.spyOn(h.app.log, 'debug'),
    ];
    const { members } = await h.started();
    await send(members[0]!, CLIENT_EVENTS.reconnect, {
      ...members[0]!.session!,
      reconnectToken: 'x'.repeat(43),
    });
    await send(members[0]!, CLIENT_EVENTS.reconnect, {
      ...members[0]!.session!,
      unexpected: 'SECRET_SENTINEL',
    });
    const tokens = members.map((member) => member.session!.reconnectToken);
    expect(new Set(tokens).size).toBe(4);
    for (const [index, member] of members.entries()) {
      const session = roomSessionSchema.parse(member.session);
      expect(Buffer.from(session.reconnectToken, 'base64url')).toHaveLength(32);
      expect(session.playerId).toBe(member.joined!.playerId);
      expect(
        member.events.filter((event) => event.event === SERVER_EVENTS.session),
      ).toHaveLength(1);
      for (const event of member.events) {
        const text = JSON.stringify(event.payload);
        for (const [other, token] of tokens.entries())
          if (other !== index || event.event !== SERVER_EVENTS.session)
            expect(text.includes(token)).toBe(false);
        if (event.event !== SERVER_EVENTS.session)
          expect(text).not.toContain('reconnectToken');
      }
    }
    expect(logs.flatMap((log) => log.mock.calls)).toEqual([]);
  });
  it('restores a disconnected seat, exact hand/state/team/identity, then continues play', async () => {
    const h = await setup();
    const { members, roomId } = await h.started();
    const original = members[0]!,
      previous = original.game!,
      session = original.session!;
    original.socket.disconnect();
    await until(() => members[1]!.room?.revision === 6);
    expect(members[1]!.room!.seats[0]).toMatchObject({
      playerId: previous.playerId,
      connected: false,
      team: 'A',
    });
    const fresh = await h.connect();
    expect(await send(fresh, CLIENT_EVENTS.reconnect, session)).toMatchObject({
      ok: true,
      roomId,
      revision: 7,
    });
    expect(fresh.joined).toEqual(original.joined);
    expect(fresh.game!.private).toEqual(previous.private);
    expect(fresh.game!.public).toEqual(previous.public);
    expect(fresh.game!.matchId).toBe(previous.matchId);
    expect(fresh.room!.isPaused).toBe(false);
    expect(
      await command(fresh, { type: 'play', tile: '1:1', end: 'start' }),
    ).toMatchObject({ ok: true, revision: 8 });
  });
  it('retains lobby seats and host through disconnect, rejecting a fifth guest', async () => {
    const h = await setup();
    const { members, roomId } = await h.room();
    const host = members[0]!;
    host.socket.disconnect();
    await until(() => members[1]!.room?.revision === 5);
    expect(members[1]!.room!.hostId).toBe(host.joined!.playerId);
    const fresh = await h.connect();
    expect(
      await send(fresh, CLIENT_EVENTS.join, {
        roomId,
        displayName: 'No stealing',
      }),
    ).toMatchObject({ ok: false, error: { code: 'ROOM_FULL' } });
    expect(
      await send(fresh, CLIENT_EVENTS.reconnect, host.session),
    ).toMatchObject({ ok: true, revision: 6 });
    expect(await send(fresh, CLIENT_EVENTS.start, { roomId })).toMatchObject({
      ok: true,
    });
  });
  it('keeps a room recoverable when everyone disconnects', async () => {
    const h = await setup();
    const { members } = await h.started();
    for (const member of members) member.socket.disconnect();
    const returned = await h.connect();
    expect(
      await send(returned, CLIENT_EVENTS.reconnect, members[0]!.session),
    ).toMatchObject({ ok: true });
    expect(returned.game!.private.hand).toEqual(members[0]!.game!.private.hand);
    expect(returned.room!.isPaused).toBe(true);
  });
  it('newest authenticated live socket owns the seat; stale commands and late disconnects cannot change it', async () => {
    const h = await setup();
    const { members, roomId } = await h.started();
    const old = members[0]!,
      fresh = await h.connect();
    expect(
      await send(fresh, CLIENT_EVENTS.reconnect, old.session),
    ).toMatchObject({ ok: true, revision: 5 });
    await until(() =>
      old.events.some((event) => event.event === SERVER_EVENTS.replaced),
    );
    const count = old.events.filter(
      (event) => event.event === SERVER_EVENTS.game,
    ).length;
    expect(await command(old, { type: 'play', tile: '1:1' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_ROOM_MEMBER' },
    });
    old.socket.disconnect();
    expect(await command(fresh, { type: 'play', tile: '1:1' })).toMatchObject({
      ok: true,
      roomId,
      revision: 6,
    });
    await until(() => members[1]!.room?.revision === 6);
    expect(fresh.room!.seats[0]!.connected).toBe(true);
    expect(
      old.events.filter((event) => event.event === SERVER_EVENTS.game),
    ).toHaveLength(count);
  });
  it.each([
    'token',
    'player',
    'room',
    'another-player-token',
    'cross-room-token',
  ] as const)('rejects %s misuse with the same safe error', async (kind) => {
    const h = await setup();
    const { members } = await h.started();
    const intruder = await h.connect();
    const session = { ...members[0]!.session! };
    if (kind === 'token') session.reconnectToken = 'x'.repeat(43);
    if (kind === 'player') session.playerId = randomUUID();
    if (kind === 'room') session.roomId = 'f'.repeat(32);
    if (kind === 'another-player-token')
      session.reconnectToken = members[1]!.session!.reconnectToken;
    if (kind === 'cross-room-token') {
      const other = await h.room();
      session.roomId = other.roomId;
    }
    const result = await send(intruder, CLIENT_EVENTS.reconnect, session);
    expect(result).toEqual({ ok: false, error: { code: 'INVALID_SESSION' } });
    expect(intruder.game).toBeNull();
    expect(intruder.session).toBeNull();
    expect(
      JSON.stringify(intruder.events).includes(session.reconnectToken),
    ).toBe(false);
    expect(members[0]!.room!.revision).toBe(5);
  });
  it.each([
    {},
    { reconnectToken: 'bad' },
    { playerId: 'bad', reconnectToken: 'x'.repeat(43) },
  ])('rejects missing/malformed credentials', async (fields) => {
    const h = await setup();
    const client = await h.connect();
    expect(await send(client, CLIENT_EVENTS.reconnect, fields)).toEqual({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
  });
  it('preserves idempotency and revision checks across replacement', async () => {
    const h = await setup();
    const { members, roomId } = await h.started();
    const original = members[0]!,
      commandId = randomUUID();
    const payload = {
      roomId,
      commandId,
      expectedRevision: 5,
      command: { type: 'play', tile: '1:1', end: 'start' },
    };
    expect(await send(original, CLIENT_EVENTS.command, payload)).toMatchObject({
      ok: true,
      revision: 6,
    });
    const fresh = await h.connect();
    await send(fresh, CLIENT_EVENTS.reconnect, original.session);
    expect(await send(fresh, CLIENT_EVENTS.command, payload)).toMatchObject({
      ok: true,
      revision: 6,
    });
    expect(fresh.game!.public.board).toHaveLength(1);
    expect(await send(original, CLIENT_EVENTS.command, payload)).toMatchObject({
      ok: false,
      error: { code: 'NOT_ROOM_MEMBER' },
    });
    expect(
      await send(fresh, CLIENT_EVENTS.command, {
        ...payload,
        commandId: randomUUID(),
      }),
    ).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    expect(
      await send(fresh, CLIENT_EVENTS.command, {
        ...payload,
        expectedRevision: 6,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'DUPLICATE_COMMAND_CONFLICT' },
    });
    expect(await command(fresh, { type: 'pass' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_YOUR_TURN' },
    });
  });
  it('revokes tokens on explicit leave and never gives away an active private hand', async () => {
    const h = await setup();
    const { members, roomId } = await h.started();
    await send(members[0]!, CLIENT_EVENTS.leave, { roomId });
    const fresh = await h.connect();
    expect(
      await send(fresh, CLIENT_EVENTS.reconnect, members[0]!.session),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_SESSION' } });
    expect(
      await send(fresh, CLIENT_EVENTS.join, { roomId, displayName: 'Guest' }),
    ).toMatchObject({ ok: false, error: { code: 'ROOM_ALREADY_STARTED' } });
  });
  it('cannot use a second valid credential to change a socket already bound to another membership', async () => {
    const h = await setup();
    const { members } = await h.started();
    expect(
      await send(members[1]!, CLIENT_EVENTS.reconnect, members[0]!.session),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_SESSION' } });
    expect(members[1]!.joined!.seat).toBe(1);
  });
});
