import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  CLIENT_EVENTS,
  gameSnapshotSchema,
  roomSnapshotSchema,
} from '@domino/protocol';
import type { GameCommand, ReconnectSession } from '@domino/protocol';
import { PostgresPersistenceStore } from '../persistence/postgres.js';
import { RoomService } from '../rooms/service.js';
import { ChatService } from '../chat/service.js';
import { createApp } from '../app.js';
import { parseServerEnv } from '../config/env.js';
import { harness, send, sendSocial, until } from './harness.js';
import type { Client } from './harness.js';
import type { Room } from '../rooms/types.js';
import { createDeck } from '@domino/game-engine';
import { shuffleDeck } from '@domino/bot-player';
import { botClock } from './bot-clock.js';
import type { RealtimeOptions } from '../realtime/socket.js';
import {
  joinVoice,
  sendVoice,
  TEST_AUDIO_SDP,
  TEST_ICE,
} from './voice-harness.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const required = process.env.DOMINO_REQUIRE_POSTGRES === '1';
const opened: Awaited<ReturnType<typeof harness>>[] = [];
const stores: PostgresPersistenceStore[] = [];
const services: RoomService[] = [];
const connection = () => ({ id: randomUUID(), isConnected: () => true });

describe.skipIf(!databaseUrl && !required)(
  'real PostgreSQL transactions and server instance recovery',
  () => {
    let pool: Pool;
    let observer: PostgresPersistenceStore;
    beforeAll(async () => {
      // Never touch a developer/production database accidentally. Dedicated tests must fail, not skip.
      if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test'))
        throw new Error(
          'TEST_DATABASE_URL must identify a dedicated database ending in _test',
        );
      pool = new Pool({ connectionString: databaseUrl });
      observer = new PostgresPersistenceStore(databaseUrl);
      await observer.initialize();
    });
    afterEach(async () => {
      await Promise.all(opened.splice(0).map((server) => server.close()));
      await Promise.all(services.splice(0).map((service) => service.close()));
      await Promise.all(stores.splice(0).map((store) => store.close()));
      await pool?.query('DELETE FROM room_records');
    });
    afterAll(async () => {
      await observer?.close();
      await pool?.end();
    });
    async function server(options: RealtimeOptions = {}) {
      const value = await harness({
        ...options,
        persistence: new PostgresPersistenceStore(databaseUrl!),
      });
      opened.push(value);
      return value;
    }
    async function stop(value: Awaited<ReturnType<typeof harness>>) {
      // Stop the actual Fastify/Socket.IO instance before its clients: no artificial disconnect revisions.
      await value.app.close();
      for (const client of value.clients) client.socket.disconnect();
      opened.splice(opened.indexOf(value), 1);
    }
    async function row(roomId: string) {
      const value = (await observer.loadRooms()).find(
        (room) => room.roomId === roomId,
      );
      if (!value) throw new Error('Expected persisted room');
      return value;
    }
    function action(members: Client[]): {
      actor: number;
      payload: GameCommand;
    } {
      const actor = members.findIndex(
        (client) => client.game!.private.legalActions.length > 0,
      );
      if (actor < 0) throw new Error('Expected legal action');
      const game = members[actor]!.game!;
      return {
        actor,
        payload: {
          roomId: game.roomId,
          expectedRevision: game.revision,
          commandId: randomUUID(),
          command: game.private.legalActions[0]!,
        },
      };
    }
    async function step(members: Client[]) {
      const chosen = action(members);
      const result = await send(
        members[chosen.actor]!,
        CLIENT_EVENTS.command,
        chosen.payload,
      );
      if (!result.ok) throw new Error(result.error.code);
      await until(() =>
        members.every((client) => client.game?.revision === result.revision),
      );
      return { ...chosen, result };
    }
    async function fixture(ttl = 30 * 60_000) {
      const store = new PostgresPersistenceStore(databaseUrl!);
      stores.push(store);
      const sessions: ReconnectSession[] = [];
      let room!: Room;
      const service = new RoomService({
        persistence: store,
        makeDeck: createDeck,
        offlineRoomTtlMs: ttl,
        onUpdate: (value) => {
          room = value;
        },
        onJoined: () => {},
        onSession: (_id, session) => sessions.push(session),
      });
      services.push(service);
      const owner = connection();
      const result = await service.createAsync(owner, { displayName: 'Owner' });
      if (!result.ok) throw new Error(result.error.code);
      return {
        store,
        service,
        owner,
        room: () => room,
        roomId: result.roomId,
        sessions,
      };
    }
    it('restores bot lobby memberships and active bot turns across actual server restarts without bot credentials', async () => {
      const timing = botClock();
      const a = await server({ botClock: timing.clock, makeDeck: createDeck });
      const host = await a.connect();
      const created = await send(host, CLIENT_EVENTS.create, {
        displayName: 'Host',
      });
      if (!created.ok) throw new Error('Expected created room');
      const roomId = created.roomId,
        session = host.session!;
      expect(
        (
          await send(host, CLIENT_EVENTS.bots, {
            roomId,
            expectedRevision: host.room!.revision,
            action: { type: 'fill' },
          })
        ).ok,
      ).toBe(true);
      const bots = (await row(roomId)).players.slice(1);
      expect(bots.every((p) => p.kind === 'bot' && p.tokenHash === null)).toBe(
        true,
      );
      await stop(a);
      const b = await server({ botClock: timing.clock, makeDeck: createDeck });
      const restored = await b.connect();
      await send(restored, CLIENT_EVENTS.reconnect, session);
      expect((await row(roomId)).players.slice(1)).toEqual(bots);
      expect((await send(restored, CLIENT_EVENTS.start, { roomId })).ok).toBe(
        true,
      );
      const before = await row(roomId),
        stale = timing.next()!;
      await stop(b);
      stale.callback();
      const c = await server({ botClock: timing.clock });
      expect(timing.next()).toBeUndefined();
      expect((await row(roomId)).matchState).toEqual(before.matchState);
      const recovered = await c.connect();
      await send(recovered, CLIENT_EVENTS.reconnect, session);
      expect(recovered.room!.isPaused).toBe(false);
      const revision = recovered.room!.revision;
      timing.fire();
      await until(() => recovered.game?.revision === revision + 1);
      const progressed = await row(roomId);
      expect(
        progressed.players
          .slice(1)
          .map((p) => [p.playerId, p.displayName, p.kind, p.tokenHash]),
      ).toEqual(
        bots.map((p) => [p.playerId, p.displayName, p.kind, p.tokenHash]),
      );
      expect(progressed.players[3]!.commands).toHaveLength(1);
      expect(recovered.game!.public.board).toHaveLength(1);
      expect(
        recovered.events.filter((e) => e.event === 'room:session'),
      ).toHaveLength(0);
    });
    it('enforces bot credential and kind constraints while defaulting legacy human inserts', async () => {
      const f = await fixture();
      await f.service.manageBots(f.owner, {
        roomId: f.roomId,
        expectedRevision: f.room().revision,
        action: { type: 'add', seat: 1 },
      });
      await expect(
        pool.query(
          "UPDATE room_players SET token_hash=$2 WHERE room_id=$1 AND kind='bot'",
          [f.roomId, 'a'.repeat(64)],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        pool.query("UPDATE room_players SET kind='fake' WHERE room_id=$1", [
          f.roomId,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
      await pool.query(
        'INSERT INTO room_players(room_id,player_id,display_name,seat,token_hash) VALUES($1,$2,$3,2,NULL)',
        [f.roomId, randomUUID(), 'Legacy'],
      );
      expect((await row(f.roomId)).players[2]!.kind).toBe('human');
    });
    it('keeps signaling ephemeral without changing persisted game, commands or chat, including across restart', async () => {
      const a = await server();
      const { members, roomId } = await a.started();
      const persisted = () =>
        pool
          .query(
            `SELECT row_to_json(r) AS room,
        (SELECT json_agg(p ORDER BY p.seat) FROM room_players p WHERE p.room_id=r.room_id) AS players,
        (SELECT json_agg(c) FROM room_commands c WHERE c.room_id=r.room_id) AS commands,
        (SELECT json_agg(c) FROM room_chat c WHERE c.room_id=r.room_id) AS chat
        FROM room_records r WHERE r.room_id=$1`,
            [roomId],
          )
          .then((result) => result.rows);
      const before = await persisted();
      const sessions = await Promise.all(members.slice(0, 2).map(joinVoice));
      const fields = {
        roomId,
        voiceId: sessions[0]!.voiceId,
        targetId: members[1]!.joined!.playerId,
        targetVoiceId: sessions[1]!.voiceId,
      };
      expect(
        await sendVoice(members[0]!, 'voice:offer', {
          ...fields,
          sdp: TEST_AUDIO_SDP,
        }),
      ).toEqual({ ok: true });
      expect(
        await sendVoice(members[0]!, 'voice:ice', {
          ...fields,
          candidate: TEST_ICE,
        }),
      ).toEqual({ ok: true });
      expect(
        await sendVoice(members[0]!, 'voice:state', {
          roomId,
          voiceId: sessions[0]!.voiceId,
          muted: true,
        }),
      ).toEqual({ ok: true });
      expect(await persisted()).toEqual(before);
      expect(JSON.stringify(before)).not.toContain('private-signaling-fixture');
      for (const session of sessions)
        expect(JSON.stringify(before)).not.toContain(session.voiceId);
      const reconnect = members[0]!.session!;
      await stop(a);
      const b = await server();
      const member = await b.connect();
      const snapshots: unknown[] = [];
      member.socket.on('voice:participants', (value) => snapshots.push(value));
      expect((await send(member, CLIENT_EVENTS.reconnect, reconnect)).ok).toBe(
        true,
      );
      await until(() => snapshots.length > 0);
      expect(snapshots.at(-1)).toEqual({ roomId, participants: [] });
    });
    it('applies checked-in Drizzle migrations to the test database and safely repeats them', async () => {
      await observer.initialize();
      const tables = await pool.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname='public'",
      );
      expect(tables.rows.map((entry) => entry.tablename).sort()).toEqual([
        'room_chat',
        'room_commands',
        'room_players',
        'room_records',
      ]);
      const migrations = await pool.query(
        'SELECT * FROM drizzle.__drizzle_migrations',
      );
      expect(migrations.rows).toHaveLength(2);
    });
    it('restarts actual server instances, reconnects four identities, retains private state and retries, then continues playing', async () => {
      const a = await server();
      const { members, roomId } = await a.started();
      const first = await step(members);
      for (let index = 0; index < 4; index++) await step(members);
      const sessions = members.map((member) => member.session!);
      const chatPayload = {
        roomId,
        commandId: randomUUID(),
        text: 'hello after restart',
      };
      const social = await sendSocial(
        members[0]!,
        CLIENT_EVENTS.chat,
        chatPayload,
      );
      expect(social.ok).toBe(true);
      const before = await row(roomId);
      const games = structuredClone(members.map((member) => member.game!));
      const identities = members.map((member) => member.joined!);
      const raw = JSON.stringify(
        (
          await pool.query(
            `SELECT row_to_json(r) AS room,
      (SELECT json_agg(p) FROM room_players p WHERE p.room_id=r.room_id) AS players,
      (SELECT json_agg(c) FROM room_commands c WHERE c.room_id=r.room_id) AS commands,
      (SELECT json_agg(c) FROM room_chat c WHERE c.room_id=r.room_id) AS chat
      FROM room_records r WHERE r.room_id=$1`,
            [roomId],
          )
        ).rows,
      );
      for (const [seat, session] of sessions.entries()) {
        expect(raw).not.toContain(session.reconnectToken);
        expect(raw).not.toContain(members[seat]!.socket.id);
        expect(before.players[seat]!.tokenHash).toBe(
          createHash('sha256').update(session.reconnectToken).digest('hex'),
        );
      }
      expect(raw).not.toContain('reconnectToken');
      await stop(a);
      const b = await server();
      const restored = await row(roomId);
      expect(restored.matchState).toEqual(before.matchState);
      expect(restored.revision).toBe(before.revision);
      expect(restored.matchId).toBe(before.matchId);
      const recovered: Client[] = [];
      for (const [seat, session] of sessions.entries()) {
        const member = await b.connect();
        recovered.push(member);
        expect(
          await send(member, CLIENT_EVENTS.reconnect, session),
        ).toMatchObject({ ok: true, revision: before.revision + seat + 1 });
        await until(() => member.game !== null && member.history !== null);
        expect(member.joined).toEqual(identities[seat]);
        expect(member.game!.private.hand).toEqual(games[seat]!.private.hand);
        expect(member.game!.public).toEqual(games[seat]!.public);
        expect(member.room!.seats[seat]?.team).toBe(seat % 2 === 0 ? 'A' : 'B');
        if (seat === 0) {
          expect(member.room!.isPaused).toBe(true);
          expect(
            member
              .room!.seats.slice(1)
              .every((player) => player?.connected === false),
          ).toBe(true);
          expect(member.game!.private.legalActions).toEqual([]);
        }
      }
      const revision = before.revision + 4;
      await until(() =>
        recovered.every((member) => member.game?.revision === revision),
      );
      expect(recovered[0]!.room!.isPaused).toBe(false);
      for (const [seat, member] of recovered.entries()) {
        gameSnapshotSchema.parse(member.game);
        roomSnapshotSchema.parse(member.room);
        expect(member.game!.private).toEqual(games[seat]!.private);
        expect(member.chat.map((message) => message.text)).toEqual([
          'hello after restart',
        ]);
        const text = JSON.stringify(member.events);
        for (const key of [
          '"hands"',
          'tokenHash',
          'matchState',
          'fingerprint',
          'socketId',
          'persistenceVersion',
        ])
          expect(text).not.toContain(key);
        for (const session of sessions)
          expect(text).not.toContain(session.reconnectToken);
        for (const [other, snapshot] of games.entries())
          if (other !== seat)
            for (const tile of snapshot.private.hand)
              expect(text).not.toContain(`"${tile}"`);
      }
      const committed = await row(roomId);
      expect(
        await send(
          recovered[first.actor]!,
          CLIENT_EVENTS.command,
          first.payload,
        ),
      ).toEqual(first.result);
      expect(await row(roomId)).toEqual(committed);
      expect(
        await send(recovered[first.actor]!, CLIENT_EVENTS.command, {
          ...first.payload,
          expectedRevision: revision,
        }),
      ).toMatchObject({
        ok: false,
        error: { code: 'DUPLICATE_COMMAND_CONFLICT' },
      });
      expect(await row(roomId)).toEqual(committed);
      expect(
        await sendSocial(recovered[0]!, CLIENT_EVENTS.chat, chatPayload),
      ).toEqual(social);
      expect((await observer.loadChat(roomId)).messages).toHaveLength(1);
      const next = await step(recovered);
      expect(next.result.revision).toBe(revision + 1);
      const fresh = await b.connect();
      await send(fresh, CLIENT_EVENTS.reconnect, sessions[first.actor]!);
      expect(
        await send(
          recovered[first.actor]!,
          CLIENT_EVENTS.command,
          first.payload,
        ),
      ).toMatchObject({ ok: false, error: { code: 'NOT_ROOM_MEMBER' } });
      const outsider = await b.connect();
      const other = await send(outsider, CLIENT_EVENTS.create, {
        displayName: 'Other room',
      });
      expect(other.ok).toBe(true);
      expect(
        await send(outsider, CLIENT_EVENTS.command, first.payload),
      ).toMatchObject({ ok: false, error: { code: 'NOT_ROOM_MEMBER' } });
      expect(
        await sendSocial(outsider, CLIENT_EVENTS.chat, chatPayload),
      ).toMatchObject({ ok: false, error: { code: 'NOT_ROOM_MEMBER' } });
    }, 20000);
    it.each(['round-ended', 'starter-selection', 'match-finished'] as const)(
      'restores nonzero scoring and %s across server instances',
      async (phase) => {
        let seed = 41;
        const a = await server({
          makeDeck: () => {
            const result = shuffleDeck(seed);
            seed = result.state;
            return result.deck;
          },
        });
        const { members, roomId } = await a.started();
        for (
          let index = 0;
          index < 3000 && members[0]!.game!.public.phase !== phase;
          index++
        )
          await step(members);
        const snapshot = members[0]!.game!;
        expect(snapshot.public.phase).toBe(phase);
        if (phase === 'starter-selection')
          expect(snapshot.public).not.toHaveProperty('revealedHands');
        else
          expect(snapshot.public.revealedHands).toEqual(
            members.map((member) => member.game!.private.hand),
          );
        const score = snapshot.public.score;
        expect(
          score.sekaBank +
            score.teams.A.officialScore +
            score.teams.A.pendingOpeningPoints +
            score.teams.B.officialScore +
            score.teams.B.pendingOpeningPoints,
        ).toBeGreaterThan(0);
        const before = await row(roomId);
        const session = members[0]!.session!;
        await stop(a);
        const b = await server();
        expect((await row(roomId)).matchState).toEqual(before.matchState);
        const recovered = await b.connect();
        expect(
          (await send(recovered, CLIENT_EVENTS.reconnect, session)).ok,
        ).toBe(true);
        await until(() => recovered.game !== null);
        expect(recovered.game!.public).toEqual(snapshot.public);
        expect(recovered.game!.private.hand).toEqual(snapshot.private.hand);
        expect(recovered.room!.lifecycle).toBe(
          phase === 'match-finished' ? 'completed' : 'playing',
        );
      },
      20000,
    );
    it('keeps authoritative state unchanged for invalid/stale moves and persists bounded failure results', async () => {
      const h = await server();
      const { members, roomId } = await h.started();
      const before = await row(roomId);
      const chosen = action(members);
      for (const payload of [
        { ...chosen.payload, command: { type: 'pass' } },
        { ...chosen.payload, commandId: randomUUID(), expectedRevision: 0 },
      ]) {
        expect(
          (await send(members[chosen.actor]!, CLIENT_EVENTS.command, payload))
            .ok,
        ).toBe(false);
        const after = await row(roomId);
        expect(after.matchState).toEqual(before.matchState);
        expect(after.revision).toBe(before.revision);
        expect(after.updatedAt).toBe(before.updatedAt);
        const stateBeforeRetry = await row(roomId);
        await send(members[chosen.actor]!, CLIENT_EVENTS.command, payload);
        expect(await row(roomId)).toEqual(stateBeforeRetry);
      }
      expect((await row(roomId)).players[chosen.actor]!.commands).toHaveLength(
        2,
      );
    });
    it('rolls back state, revision, membership and dedupe together on an actual PostgreSQL transaction failure', async () => {
      const h = await server();
      const { members, roomId } = await h.started();
      const before = await row(roomId),
        chosen = action(members);
      await pool.query(`CREATE FUNCTION phase8_reject_command() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected private error'; END $$`);
      await pool.query(
        'CREATE TRIGGER phase8_reject BEFORE INSERT ON room_commands FOR EACH ROW EXECUTE FUNCTION phase8_reject_command()',
      );
      try {
        expect(
          await send(
            members[chosen.actor]!,
            CLIENT_EVENTS.command,
            chosen.payload,
          ),
        ).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
        expect(await row(roomId)).toEqual(before);
        expect(
          members.every((member) => member.game!.revision === before.revision),
        ).toBe(true);
        expect(
          await send(
            members[chosen.actor]!,
            CLIENT_EVENTS.command,
            chosen.payload,
          ),
        ).toMatchObject({ ok: false, error: { code: 'SERVER_BUSY' } });
        expect(
          JSON.stringify(members.flatMap((member) => member.events)),
        ).not.toContain('injected private error');
      } finally {
        await pool.query('DROP TRIGGER phase8_reject ON room_commands');
        await pool.query('DROP FUNCTION phase8_reject_command()');
      }
      await stop(h);
      expect(await row(roomId)).toEqual(before);
    });
    it('persists only the latest 50 chat messages, bounded hashed command history and rate windows across restart', async () => {
      const f = await fixture();
      let now = Date.now();
      const chat = new ChatService({
        persistence: f.store,
        now: () => now,
        resolveMember: (conn, id) => f.service.chatMember(conn, id),
        recipients: () => [],
        runRoom: (id, operation) => f.service.runRoom(id, operation),
        playerIds: (id) => f.service.chatPlayerIds(id),
        onMessage: () => {},
        onHistory: () => {},
        onReaction: () => {},
      });
      for (let index = 0; index < 140; index++) {
        if (index % 5 === 0) now += 10_000;
        expect(
          (
            await chat.send(f.owner, {
              roomId: f.roomId,
              commandId: randomUUID(),
              text: `message-${index}`,
            })
          ).ok,
        ).toBe(true);
      }
      const state = await observer.loadChat(f.roomId);
      expect(state.messages).toHaveLength(50);
      expect(state.messages[0]!.text).toBe('message-90');
      expect(state.commands).toHaveLength(128);
      expect(JSON.stringify(state)).not.toContain('"message-0"');
      expect(
        state.commands.every((entry) =>
          /^[a-f0-9]{64}$/.test(entry.fingerprint),
        ),
      ).toBe(true);
      const restored = new ChatService({
        persistence: f.store,
        now: () => now,
        resolveMember: (conn, id) => f.service.chatMember(conn, id),
        recipients: () => [],
        runRoom: (id, operation) => f.service.runRoom(id, operation),
        onMessage: () => {},
        onHistory: () => {},
        onReaction: () => {},
      });
      await restored.restore([f.roomId]);
      expect(
        await restored.send(f.owner, {
          roomId: f.roomId,
          commandId: randomUUID(),
          text: 'rate-limited',
        }),
      ).toMatchObject({ ok: false, error: { code: 'CHAT_RATE_LIMITED' } });
    }, 15000);
    it('evicts old game idempotency rows at the same 128-command boundary as RAM', async () => {
      const f = await fixture();
      const payload = {
        roomId: f.roomId,
        commandId: randomUUID(),
        expectedRevision: 1,
        command: { type: 'pass' as const },
      };
      for (let index = 0; index < 130; index++)
        await f.service.game(f.owner, {
          ...payload,
          commandId: index === 0 ? payload.commandId : randomUUID(),
        });
      const record = await row(f.roomId);
      expect(record.players[0]!.commands).toHaveLength(128);
      expect(
        record.players[0]!.commands.some(
          (entry) => entry.commandId === payload.commandId,
        ),
      ).toBe(false);
      expect(
        record.players[0]!.commands.map((entry) => entry.commandId),
      ).toEqual([...f.room().seats[0]!.commands.keys()]);
    }, 15000);
    it('deletes expired rooms and dependent membership, command and chat records', async () => {
      const f = await fixture(100);
      await f.service.game(f.owner, {
        roomId: f.roomId,
        commandId: randomUUID(),
        expectedRevision: 1,
        command: { type: 'pass' },
      });
      await f.store.saveChat(f.roomId, {
        persistenceVersion: 1,
        messages: [],
        commands: [],
        rate: [],
      });
      await f.service.disconnect(f.owner.id);
      await expect
        .poll(async () => (await observer.loadRooms()).length)
        .toBe(0);
      for (const table of ['room_players', 'room_commands', 'room_chat'])
        expect((await pool.query(`SELECT * FROM ${table}`)).rows).toEqual([]);
    });
    it('cleans expired rows at startup and does not extend offline expiry on repeated recovery', async () => {
      const f = await fixture();
      await f.service.close();
      const deadline = (await row(f.roomId)).expiresAt;
      for (let index = 0; index < 2; index++) {
        const recovered = new RoomService({
          persistence: f.store,
          onUpdate: () => {},
          onJoined: () => {},
        });
        services.push(recovered);
        await recovered.restore();
        expect((await row(f.roomId)).expiresAt).toBe(deadline);
        await recovered.close();
      }
      await pool.query(
        "UPDATE room_records SET expires_at = now() - interval '1 second' WHERE room_id=$1",
        [f.roomId],
      );
      await observer.initialize();
      expect(await observer.loadRooms()).toEqual([]);
    });
    it.each(['version', 'engine', 'chat'] as const)(
      'refuses startup with corrupt persisted %s rather than exposing unvalidated state',
      async (kind) => {
        const f = await fixture();
        await f.service.close();
        if (kind === 'version')
          await pool.query(
            'UPDATE room_records SET persistence_version=999 WHERE room_id=$1',
            [f.roomId],
          );
        else if (kind === 'engine')
          await pool.query(
            "UPDATE room_records SET match_id=$2, match_state=$3, lifecycle='playing' WHERE room_id=$1",
            [f.roomId, randomUUID(), { phase: 'playing' }],
          );
        else
          await pool.query(
            'INSERT INTO room_chat(room_id,state) VALUES ($1,$2)',
            [f.roomId, { persistenceVersion: 999 }],
          );
        const app = createApp(parseServerEnv({ LOG_LEVEL: 'silent' }), {
          persistence: new PostgresPersistenceStore(databaseUrl!),
        });
        try {
          await expect(app.ready()).rejects.toThrow();
        } finally {
          await app.close();
        }
      },
    );
    it('fails startup when PostgreSQL is unavailable', async () => {
      const app = createApp(parseServerEnv({ LOG_LEVEL: 'silent' }), {
        persistence: new PostgresPersistenceStore(
          'postgresql://127.0.0.1:1/unavailable_test',
        ),
      });
      try {
        await expect(app.ready()).rejects.toThrow();
      } finally {
        await app.close();
      }
    }, 10000);
  },
);
