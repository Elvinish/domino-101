import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_EVENTS,
  voiceServerSchemas,
  SERVER_EVENTS,
  gameSnapshotSchema,
  roomSnapshotSchema,
  roomJoinedSchema,
  roomSessionSchema,
  roomReplacedSchema,
  commandResultSchema,
  serverErrorSchema,
  chatHistorySchema,
  chatMessageSchema,
  reactionReceivedSchema,
} from '@domino/protocol';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { command, harness, send, until } from './harness.js';

type Harness = Awaited<ReturnType<typeof harness>>;
const opened: Harness[] = [];
async function setup(options: Parameters<typeof harness>[0] = {}) {
  const h = await harness(options);
  opened.push(h);
  return h;
}
afterEach(async () => {
  await Promise.all(opened.splice(0).map((h) => h.close()));
});
function expectError(result: Awaited<ReturnType<typeof send>>, code: string) {
  expect(result).toMatchObject({ ok: false, error: { code } });
}

describe('real Socket.IO rooms and validation', () => {
  it('closes oversized packets without crashing the service', async () => {
    const h = await setup();
    const client = await h.connect();
    const disconnected = new Promise<void>((resolve) =>
      client.socket.once('disconnect', () => resolve()),
    );
    client.socket.emit(CLIENT_EVENTS.create, { displayName: 'x'.repeat(9000) });
    await disconnected;
    expect(
      (await h.app.inject({ method: 'GET', url: '/health' })).statusCode,
    ).toBe(200);
    const next = await h.connect();
    expect(
      await send(next, CLIENT_EVENTS.create, { displayName: 'Still healthy' }),
    ).toMatchObject({ ok: true });
  });
  it('sanitizes unexpected failures in both outbound events and logs', async () => {
    const h = await setup({
      makeDeck: () => {
        throw new Error('PRIVATE_HAND_OR_SECRET_MARKER');
      },
    });
    const log = vi.spyOn(h.app.log, 'error');
    const { members, roomId } = await h.room();
    expectError(
      await send(members[0]!, CLIENT_EVENTS.start, { roomId }),
      'INTERNAL_ERROR',
    );
    expect(
      JSON.stringify(members.flatMap((client) => client.events)),
    ).not.toContain('PRIVATE_HAND_OR_SECRET_MARKER');
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      'PRIVATE_HAND_OR_SECRET_MARKER',
    );
    expect(log).toHaveBeenCalledWith(
      { event: CLIENT_EVENTS.start, code: 'INTERNAL_ERROR' },
      'Room request failed',
    );
    expect(members[0]!.room!.lifecycle).toBe('lobby');
  });

  it('creates a private room and assigns independent server identity/seat', async () => {
    const h = await setup();
    const client = await h.connect();
    const result = await send(client, CLIENT_EVENTS.create, {
      displayName: '  Guest  ',
    });
    expect(result).toMatchObject({ ok: true, revision: 1 });
    expect(client.joined!.roomId).toMatch(/^[a-f0-9]{32}$/);
    expect(client.joined!.playerId).not.toBe(client.socket.id);
    expect(client.joined!.seat).toBe(0);
    expect(client.room!.seats[0]).toMatchObject({
      displayName: 'Guest',
      team: 'A',
      connected: true,
    });
    expectError(
      await send(client, CLIENT_EVENTS.create, { displayName: 'Again' }),
      'ALREADY_ROOM_MEMBER',
    );
  });
  it('supports polling transport as well as WebSocket', async () => {
    const h = await setup();
    const client = await h.connect('polling');
    expect(
      await send(client, CLIENT_EVENTS.create, {
        displayName: 'Polling guest',
      }),
    ).toMatchObject({ ok: true });
  });
  it('rejects an unapproved browser Origin', async () => {
    const h = await setup();
    const socket = io(h.address, {
      transports: ['websocket'],
      extraHeaders: { Origin: 'https://unapproved.example' },
      reconnection: false,
      forceNew: true,
      autoConnect: false,
    });
    try {
      await new Promise<void>((resolve) => {
        socket.once('connect_error', () => resolve());
        socket.connect();
      });
      expect(socket.connected).toBe(false);
    } finally {
      socket.disconnect();
    }
  });
  it('fills exactly four seats, rejects the fifth and rejects missing rooms', async () => {
    const h = await setup();
    const { members, roomId } = await h.room();
    const fifth = await h.connect();
    expect(members[0]!.room!.seats.map((player) => player!.seat)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(members[0]!.room!.seats.map((player) => player!.team)).toEqual([
      'A',
      'B',
      'A',
      'B',
    ]);
    expect(new Set(members.map((client) => client.joined!.playerId)).size).toBe(
      4,
    );
    expectError(
      await send(fifth, CLIENT_EVENTS.join, { roomId, displayName: 'Fifth' }),
      'ROOM_FULL',
    );
    expectError(
      await send(fifth, CLIENT_EVENTS.join, {
        roomId: '0'.repeat(32),
        displayName: 'Nobody',
      }),
      'ROOM_NOT_FOUND',
    );
    expectError(
      await send(members[0]!, CLIENT_EVENTS.join, {
        roomId,
        displayName: 'Duplicate',
      }),
      'ALREADY_ROOM_MEMBER',
    );
  });
  it('only the host can start, requires four seats, and forbids duplicate starts/late joins', async () => {
    const h = await setup();
    const host = await h.connect();
    await send(host, CLIENT_EVENTS.create, { displayName: 'Host' });
    const roomId = host.joined!.roomId;
    expectError(
      await send(host, CLIENT_EVENTS.start, { roomId }),
      'ROOM_NOT_READY',
    );
    expectError(await command(host, { type: 'pass' }), 'INVALID_PHASE');
    const guests = await Promise.all([h.connect(), h.connect(), h.connect()]);
    for (const guest of guests)
      await send(guest, CLIENT_EVENTS.join, { roomId, displayName: 'Guest' });
    expectError(
      await send(guests[0]!, CLIENT_EVENTS.start, { roomId }),
      'NOT_HOST',
    );
    expect(await send(host, CLIENT_EVENTS.start, { roomId })).toMatchObject({
      ok: true,
      revision: 5,
    });
    expectError(
      await send(host, CLIENT_EVENTS.start, { roomId }),
      'ROOM_ALREADY_STARTED',
    );
    const late = await h.connect();
    expectError(
      await send(late, CLIENT_EVENTS.join, { roomId, displayName: 'Late' }),
      'ROOM_ALREADY_STARTED',
    );
  });
  it.each([
    null,
    {},
    { displayName: '' },
    { displayName: 'x'.repeat(33) },
    { displayName: 'bad\u0000name' },
    { displayName: 'Guest', seat: 3 },
    { displayName: 'Guest', playerId: randomUUID() },
  ])(
    'rejects malformed/identity-injecting create payload %j',
    async (payload) => {
      const h = await setup();
      const client = await h.connect();
      expectError(
        await send(client, CLIENT_EVENTS.create, payload),
        'INVALID_PAYLOAD',
      );
      expect(client.joined).toBeNull();
      expect(
        await send(client, CLIENT_EVENTS.create, { displayName: 'Valid' }),
      ).toMatchObject({ ok: true });
    },
  );
  it('validates nested gameplay payloads and all lifecycle requests, without crashing', async () => {
    const h = await setup();
    const { members, roomId } = await h.started();
    const client = members[0]!;
    for (const payload of [
      null,
      {},
      { roomId, playerId: client.joined!.playerId },
      {
        roomId,
        commandId: randomUUID(),
        expectedRevision: 5,
        command: { type: 'win', score: 101 },
      },
      {
        roomId,
        commandId: randomUUID(),
        expectedRevision: 5,
        command: { type: 'pass', seat: 0 },
      },
      {
        roomId,
        commandId: randomUUID(),
        expectedRevision: 5,
        command: { type: 'play', tile: '6:1', end: 'left' },
      },
    ]) {
      expectError(
        await send(client, CLIENT_EVENTS.command, payload),
        'INVALID_PAYLOAD',
      );
    }
    expectError(
      await send(client, CLIENT_EVENTS.start, { roomId, hand: [] }),
      'INVALID_PAYLOAD',
    );
    expectError(
      await send(client, CLIENT_EVENTS.join, {
        roomId: 'short',
        displayName: 'Guest',
      }),
      'INVALID_PAYLOAD',
    );
    expect(
      await command(client, { type: 'play', tile: '1:1', end: 'start' }),
    ).toMatchObject({ ok: true, revision: 6 });
  });
  it('returns structured events even without acknowledgement callbacks', async () => {
    const h = await setup();
    const client = await h.connect();
    client.socket.emit(CLIENT_EVENTS.create, { displayName: '' });
    await until(() =>
      client.events.some((event) => event.event === SERVER_EVENTS.error),
    );
    expect(
      client.events.find((event) => event.event === SERVER_EVENTS.error)!
        .payload,
    ).toEqual({ event: CLIENT_EVENTS.create, code: 'INVALID_PAYLOAD' });
    expect(
      client.events.find((event) => event.event === SERVER_EVENTS.result)!
        .payload,
    ).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
  });
});

describe('network authority, revisions and privacy', () => {
  it('enforces engine legality, explicit ambiguous ends and turn ownership', async () => {
    const h = await setup();
    const { members } = await h.started();
    expectError(
      await command(members[1]!, { type: 'play', tile: '1:1' }),
      'NOT_YOUR_TURN',
    );
    expectError(
      await command(members[0]!, { type: 'play', tile: '6:6' }),
      'TILE_NOT_IN_HAND',
    );
    expectError(
      await command(members[0]!, { type: 'play', tile: '3:5' }),
      'ILLEGAL_TILE',
    );
    expectError(
      await command(members[0]!, { type: 'pass' }),
      'PASS_NOT_ALLOWED',
    );
    expect(
      await command(members[0]!, { type: 'play', tile: '1:1' }),
    ).toMatchObject({ ok: true, revision: 6 });
    await until(() => members.every((client) => client.game?.revision === 6));
    expect(await command(members[1]!, { type: 'pass' })).toMatchObject({
      ok: true,
      revision: 7,
    });
    await until(() => members.every((client) => client.game?.revision === 7));
    expectError(
      await command(members[2]!, { type: 'play', tile: '1:6' }),
      'END_REQUIRED',
    );
    expect(
      await command(members[2]!, { type: 'play', tile: '1:6', end: 'right' }),
    ).toMatchObject({ ok: true, revision: 8 });
  });
  it('replays identical command IDs once, rejects conflicts and stale revisions', async () => {
    const h = await setup();
    const { members, roomId } = await h.started();
    const client = members[0]!;
    const payload = {
      roomId,
      commandId: randomUUID(),
      expectedRevision: 5,
      command: { type: 'play', tile: '1:1', end: 'start' },
    };
    const result = await send(client, CLIENT_EVENTS.command, payload);
    expect(result).toMatchObject({ ok: true, revision: 6 });
    expect(await send(client, CLIENT_EVENTS.command, payload)).toEqual(result);
    expectError(
      await send(client, CLIENT_EVENTS.command, {
        ...payload,
        command: { type: 'pass' },
      }),
      'DUPLICATE_COMMAND_CONFLICT',
    );
    expectError(
      await send(client, CLIENT_EVENTS.command, {
        ...payload,
        commandId: randomUUID(),
      }),
      'STALE_REVISION',
    );
    expect(client.game!.public.board).toHaveLength(1);
    expect(client.game!.revision).toBe(6);
  });
  it('serializes competing commands and duplicate retries in one room', async () => {
    const h = await setup();
    const { members, roomId } = await h.started();
    const payload = {
      roomId,
      commandId: randomUUID(),
      expectedRevision: 5,
      command: { type: 'play', tile: '1:1', end: 'start' },
    };
    const [first, retry, competitor] = await Promise.all([
      send(members[0]!, CLIENT_EVENTS.command, payload),
      send(members[0]!, CLIENT_EVENTS.command, payload),
      command(members[1]!, { type: 'pass' }, { expectedRevision: 5 }),
    ]);
    expect(first).toMatchObject({ ok: true, revision: 6 });
    expect(retry).toEqual(first);
    // The other socket can arrive first (wrong turn) or after the accepted command (stale).
    expect(competitor.ok).toBe(false);
    if (!competitor.ok)
      expect(['NOT_YOUR_TURN', 'STALE_REVISION']).toContain(
        competitor.error.code,
      );
    expect(members[0]!.game!.public.board).toHaveLength(1);
  });
  it('rejects cross-room/wrong-socket authority and handles distinct rooms independently', async () => {
    const h = await setup();
    const a = await h.started();
    const b = await h.started();
    const outsider = await h.connect();
    expectError(
      await command(
        b.members[0]!,
        { type: 'play', tile: '1:1' },
        { roomId: a.roomId },
      ),
      'NOT_ROOM_MEMBER',
    );
    expectError(
      await send(outsider, CLIENT_EVENTS.command, {
        roomId: a.roomId,
        commandId: randomUUID(),
        expectedRevision: 5,
        command: { type: 'play', tile: '1:1' },
      }),
      'NOT_ROOM_MEMBER',
    );
    const results = await Promise.all([
      command(a.members[0]!, { type: 'play', tile: '1:1' }),
      command(b.members[0]!, { type: 'play', tile: '1:1' }),
    ]);
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ok: true, roomId: a.roomId, revision: 6 }),
        expect.objectContaining({ ok: true, roomId: b.roomId, revision: 6 }),
      ]),
    );
    expect(outsider.events).toHaveLength(1 * 2); // its error + result only; no snapshots
    expect(
      a.members[0]!.events.every(
        (event) => !JSON.stringify(event.payload).includes(b.roomId),
      ),
    ).toBe(true);
  });
  it('audits all outbound events: only an owner sees their hand; shared state contains no hands', async () => {
    const h = await setup();
    const { members } = await h.started();
    const schemas = {
      ...voiceServerSchemas,
      [SERVER_EVENTS.joined]: roomJoinedSchema,
      [SERVER_EVENTS.session]: roomSessionSchema,
      [SERVER_EVENTS.replaced]: roomReplacedSchema,
      [SERVER_EVENTS.room]: roomSnapshotSchema,
      [SERVER_EVENTS.game]: gameSnapshotSchema,
      [SERVER_EVENTS.result]: commandResultSchema,
      [SERVER_EVENTS.error]: serverErrorSchema,
      [SERVER_EVENTS.chatHistory]: chatHistorySchema,
      [SERVER_EVENTS.chatMessage]: chatMessageSchema,
      [SERVER_EVENTS.reaction]: reactionReceivedSchema,
    };
    const allHands = members.map((client) => client.game!.private.hand);
    expect(new Set(allHands.flat()).size).toBe(28);
    for (const [index, client] of members.entries()) {
      expect(client.game!.private.hand).toHaveLength(7);
      expect(client.game!.public.handCounts).toEqual([7, 7, 7, 7]);
      for (const event of client.events) {
        expect(
          schemas[event.event as keyof typeof schemas].safeParse(event.payload)
            .success,
        ).toBe(true);
        const text = JSON.stringify(event.payload);
        expect(text).not.toContain('"hands"');
        expect(text).not.toContain('"socketId"');
        expect(text).not.toContain('"commands"');
        for (const [other, hand] of allHands.entries())
          if (other !== index)
            for (const tile of hand) expect(text).not.toContain(`"${tile}"`);
      }
    }
  });
});

describe('disconnect and shutdown', () => {
  it('explicit leave releases lobby seats, transfers host and deletes an empty room', async () => {
    const h = await setup();
    const { members, roomId } = await h.room();
    await send(members[0]!, CLIENT_EVENTS.leave, { roomId });
    await until(() => members[1]!.room?.revision === 5);
    expect(members[1]!.room!.hostId).toBe(members[1]!.joined!.playerId);
    expect(members[1]!.room!.seats[0]).toBeNull();
    const replacement = await h.connect();
    expect(
      await send(replacement, CLIENT_EVENTS.join, {
        roomId,
        displayName: 'Replacement',
      }),
    ).toMatchObject({ ok: true });
    expect(replacement.joined!.seat).toBe(0);
    for (const client of [...members.slice(1), replacement])
      await send(client, CLIENT_EVENTS.leave, { roomId });
    const next = await h.connect();
    expectError(
      await send(next, CLIENT_EVENTS.join, { roomId, displayName: 'Gone' }),
      'ROOM_NOT_FOUND',
    );
  });
  it('reserves active seats, pauses play and rejects a fresh socket claiming an old identity', async () => {
    const h = await setup();
    const { members, roomId } = await h.started();
    const old = members[2]!.joined!;
    members[2]!.socket.disconnect();
    await until(() => members[0]!.room?.revision === 6);
    expect(members[0]!.room!.isPaused).toBe(true);
    expect(members[0]!.room!.seats[2]).toMatchObject({
      playerId: old.playerId,
      connected: false,
    });
    expectError(
      await command(members[0]!, { type: 'play', tile: '1:1' }),
      'ROOM_NOT_READY',
    );
    const fresh = await h.connect();
    expectError(
      await send(fresh, CLIENT_EVENTS.join, {
        roomId,
        displayName: 'Replacement',
      }),
      'ROOM_ALREADY_STARTED',
    );
    expectError(
      await send(fresh, CLIENT_EVENTS.command, {
        roomId,
        commandId: randomUUID(),
        expectedRevision: 6,
        command: { type: 'pass' },
      }),
      'NOT_ROOM_MEMBER',
    );
    expectError(
      await send(fresh, CLIENT_EVENTS.command, {
        roomId,
        playerId: old.playerId,
        commandId: randomUUID(),
        expectedRevision: 6,
        command: { type: 'pass' },
      }),
      'INVALID_PAYLOAD',
    );
  });
  it('gracefully closes the actual server while clients remain connected', async () => {
    const h = await setup();
    const { members } = await h.started();
    await h.app.close();
    await until(() => members.every((client) => !client.socket.connected));
  });
});
