import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDeck } from '@domino/game-engine';
import { chooseCommand, getBotView, shuffleDeck } from '@domino/bot-player';
import type { GameAction, ReconnectSession } from '@domino/protocol';
import { RoomService } from '../rooms/service.js';
import type { Room } from '../rooms/types.js';
import { projectGame, projectRoom } from '../rooms/projections.js';
import { serializeRoom } from '../persistence/codec.js';
import { MemoryPersistence } from '../__tests__/memory-persistence.js';
import { botClock } from '../__tests__/bot-clock.js';
import { BOT_DELAY_MS, botDecision } from './scheduler.js';
import { PERSONA_NAMES } from '../rooms/personas.js';
import { findBotPersona, gameSnapshotSchema } from '@domino/protocol';

const services: RoomService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.close()));
});
const connection = () => {
  const c = {
    id: randomUUID(),
    connected: true,
    isConnected: () => c.connected,
  };
  return c;
};
async function setup(persistence?: MemoryPersistence, seeded = false) {
  const timing = botClock();
  let room!: Room,
    seed = 3;
  const sessions: ReconnectSession[] = [];
  const updates = vi.fn((value: Room) => {
    room = value;
  });
  const joined = vi.fn();
  const service = new RoomService({
    onUpdate: updates,
    onJoined: joined,
    onSession: (_id, session) => sessions.push(session),
    botClock: timing.clock,
    makeDeck: () => {
      if (!seeded) return createDeck();
      const next = shuffleDeck(seed);
      seed = next.state;
      return next.deck;
    },
    ...(persistence ? { persistence } : {}),
  });
  services.push(service);
  const host = connection();
  const result = await service.createAsync(host, { displayName: 'Human' });
  if (!result.ok) throw new Error('Create failed');
  const manage = (
    action: Parameters<RoomService['manageBots']>[1]['action'],
    revision = room.revision,
  ) =>
    service.manageBots(host, {
      roomId: room.id,
      expectedRevision: revision,
      action,
    });
  const drain = async () => {
    await room.queue.drain();
    await Promise.resolve();
  };
  const tick = async () => {
    timing.fire();
    await drain();
  };
  const act = (command: GameAction) =>
    service.game(host, {
      roomId: room.id,
      commandId: randomUUID(),
      expectedRevision: room.revision,
      command,
    });
  return {
    timing,
    service,
    host,
    sessions,
    updates,
    joined,
    room: () => room,
    manage,
    drain,
    tick,
    act,
  };
}
async function started(persistence?: MemoryPersistence, seeded = false) {
  const f = await setup(persistence, seeded);
  await f.manage({ type: 'fill' });
  await f.service.start(f.host, { roomId: f.room().id });
  return f;
}

describe('host-managed lobby bots', () => {
  it('adds/removes/fills exactly the empty seats with server identities, no socket or token, and one revision per operation', async () => {
    const f = await setup();
    await f.manage({ type: 'add', seat: 2 });
    const bot = f.room().seats[2]!;
    expect(bot).toMatchObject({
      kind: 'bot',
      seat: 2,
      socketId: null,
      tokenHash: null,
    });
    expect(bot.playerId).toMatch(/^[a-f0-9-]{36}$/);
    expect(f.sessions).toHaveLength(1);
    expect(f.joined).toHaveBeenCalledTimes(1);
    await expect(f.manage({ type: 'add', seat: 2 })).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD',
    });
    await expect(f.manage({ type: 'remove', seat: 0 })).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD',
    });
    await f.manage({ type: 'remove', seat: 2 });
    expect(f.room().seats[2]).toBeNull();
    await f.manage({ type: 'fill' });
    expect(f.room().seats.filter(Boolean)).toHaveLength(4);
    const names = f.room().seats.map((player) => player!.displayName);
    expect(new Set(names).size).toBe(4);
    for (const name of names.slice(1)) expect(PERSONA_NAMES).toContain(name);
    expect(f.room().revision).toBe(4);
    await expect(f.manage({ type: 'fill' })).rejects.toMatchObject({
      code: 'ROOM_FULL',
    });
    expect(f.service.chatRecipients(f.room().id)).toEqual([f.host.id]);
    expect(f.timing.next()).toBeUndefined();
  });
  it('authorizes the current host inside the room queue and rejects stale revisions', async () => {
    const f = await setup();
    const other = connection();
    await f.service.join(other, { roomId: f.room().id, displayName: 'Guest' });
    const payload = {
      roomId: f.room().id,
      expectedRevision: f.room().revision,
      action: { type: 'fill' as const },
    };
    await expect(f.service.manageBots(other, payload)).rejects.toMatchObject({
      code: 'NOT_HOST',
    });
    await expect(
      f.service.manageBots(connection(), payload),
    ).rejects.toMatchObject({ code: 'NOT_ROOM_MEMBER' });
    await expect(f.manage({ type: 'fill' }, 1)).rejects.toMatchObject({
      code: 'STALE_REVISION',
    });
    const replacement = connection();
    await f.service.reconnect(replacement, f.sessions[0]!);
    await expect(f.service.manageBots(f.host, payload)).rejects.toMatchObject({
      code: 'NOT_ROOM_MEMBER',
    });
    expect((await f.service.manageBots(replacement, payload)).ok).toBe(true);
  });
  it('rejects bot changes after start and cannot reconnect a bot with a human credential', async () => {
    const f = await started();
    await expect(f.manage({ type: 'remove', seat: 3 })).rejects.toMatchObject({
      code: 'ROOM_ALREADY_STARTED',
    });
    await expect(
      f.service.reconnect(connection(), {
        ...f.sessions[0]!,
        playerId: f.room().seats[3]!.playerId,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SESSION' });
  });
  it('transfers lobby host to a human, never a bot, and deletes a lobby left with only bots', async () => {
    const f = await setup();
    await f.manage({ type: 'add', seat: 1 });
    const guest = connection();
    await f.service.join(guest, { roomId: f.room().id, displayName: 'Guest' });
    const guestId = f.room().seats[2]!.playerId;
    await f.service.leave(f.host, { roomId: f.room().id });
    expect(f.room().hostId).toBe(guestId);
    await f.service.leave(guest, { roomId: f.room().id });
    expect(() => f.service.runRoom(f.room().id, () => {})).toThrow();
  });
});

describe('scheduled authoritative bot turns', () => {
  it('starts with one human, delays the bot opening and applies each scheduled action once through command history', async () => {
    const f = await started();
    const before = f.room().revision;
    expect(projectRoom(f.room()).isPaused).toBe(false);
    expect(f.room().match!.state.phase).toBe('playing');
    const task = f.timing.next()!;
    expect(task.delay).toBe(BOT_DELAY_MS);
    task.callback();
    task.callback();
    await f.drain();
    expect(f.room().revision).toBe(before + 1);
    const game = projectGame(f.room(), f.room().seats[0]!);
    expect(game.public.board.map((piece) => piece.tile)).toEqual(['1:1']);
    expect(f.room().seats[3]!.commands.size).toBe(1);
    expect(game.playerId).toBe(f.sessions[0]!.playerId);
    const state = f.room().match!.state;
    const hidden =
      state.phase === 'playing' ? state.round.hands.slice(1).flat() : [];
    for (const tile of hidden) expect(game.private.hand).not.toContain(tile);
    task.callback();
    await f.drain();
    expect(f.room().revision).toBe(before + 1);
  });
  it('discards a bot job queued behind a human disconnect and resumes once the human reconnects', async () => {
    const f = await started();
    const old = f.timing.next()!;
    let release!: () => void;
    const held = f.room().queue.run(
      () =>
        new Promise<void>((done) => {
          release = done;
        }),
    );
    await Promise.resolve();
    f.host.connected = false;
    const disconnect = f.service.disconnect(f.host.id);
    old.callback();
    release();
    await held;
    await disconnect;
    await f.drain();
    expect(projectRoom(f.room()).isPaused).toBe(true);
    expect(f.room().seats[3]!.commands.size).toBe(0);
    expect(f.timing.next()).toBeUndefined();
    await f.service.reconnect(connection(), f.sessions[0]!);
    old.callback();
    await f.drain();
    expect(f.room().seats[3]!.commands.size).toBe(0);
    await f.tick();
    expect(f.room().seats[3]!.commands.size).toBe(1);
  });
  it('deduplicates scheduling when a human invalid command commits without changing the revision', async () => {
    const f = await started();
    const before = f.timing.tasks.length;
    expect(await f.act({ type: 'pass' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_YOUR_TURN' },
    });
    expect(f.timing.tasks).toHaveLength(before);
    await f.tick();
    const old = f.room().revision;
    expect(
      (
        await f.act(
          projectGame(f.room(), f.room().seats[0]!).private.legalActions[0]!,
        )
      ).ok,
    ).toBe(true);
    expect(f.room().revision).toBe(old + 1);
    expect(f.timing.next()).toBeDefined();
  });
  it('cancels scheduled work on close and on persistence failure without leaking state or auto-retrying', async () => {
    const store = new MemoryPersistence();
    const f = await started(store);
    store.fail = true;
    const revision = f.room().revision;
    await f.tick();
    expect(f.room().revision).toBe(revision);
    expect(f.timing.next()).toBeUndefined();
    await expect(f.act({ type: 'pass' })).rejects.toMatchObject({
      code: 'SERVER_BUSY',
    });
    store.fail = false;
    const g = await started();
    const old = g.timing.next()!;
    await g.service.close();
    old.callback();
    await g.drain();
    expect(g.room().seats[3]!.commands.size).toBe(0);
  });
  it('serializes a human starter choice ahead of a scheduled bot and discards the superseded turn', async () => {
    const f = await started(undefined, true);
    for (let step = 0; step < 4000; step++) {
      const state = f.room().match!.state;
      if (state.phase === 'starter-selection' && state.eligibleTeam === 'A')
        break;
      if (state.phase === 'match-finished')
        throw new Error(
          'Expected eligible starter selection before completion',
        );
      if (botDecision(f.room())) await f.tick();
      else {
        const command = projectGame(f.room(), f.room().seats[0]!).private
          .legalActions[0];
        if (!command) throw new Error('Expected human action');
        expect((await f.act(command)).ok).toBe(true);
      }
    }
    expect(f.room().match!.state.phase).toBe('starter-selection');
    const stale = f.timing.next()!,
      revision = f.room().revision;
    const before = f.room().seats[2]!.commands.size;
    const human = f.act({ type: 'select-starter', selected: 0 });
    stale.callback();
    expect((await human).ok).toBe(true);
    await f.drain();
    expect(f.room().revision).toBe(revision + 1);
    expect(f.room().match!.state).toMatchObject({ phase: 'playing', turn: 0 });
    expect(f.room().seats[2]!.commands.size).toBe(before);
    expect(f.timing.next()).toBeUndefined();
  });
  it('completes a real multi-round match with passes, ambiguous placements, starter selection and SEKA through scheduled bots', async () => {
    const f = await started(undefined, true);
    const coverage = {
      pass: 0,
      ambiguous: 0,
      selection: 0,
      seka: 0,
      rounds: 0,
      moves: 0,
    };
    for (
      let step = 0;
      step < 4000 && f.room().lifecycle !== 'completed';
      step++
    ) {
      const state = f.room().match!.state;
      const decision = botDecision(f.room());
      for (const player of f.room().seats) {
        const snapshot = projectGame(f.room(), player!);
        if (state.phase === 'round-ended' || state.phase === 'match-finished') {
          expect(snapshot.public.revealedHands).toEqual(state.round.hands);
        } else {
          expect(snapshot.public).not.toHaveProperty('revealedHands');
          const hands =
            state.phase === 'playing' ? state.round.hands : state.hands;
          for (const [seat, hand] of hands.entries())
            if (seat !== player!.seat)
              for (const tile of hand)
                expect(JSON.stringify(snapshot)).not.toContain(`"${tile}"`);
          expect(
            gameSnapshotSchema.safeParse({
              ...snapshot,
              public: { ...snapshot.public, revealedHands: hands },
            }).success,
          ).toBe(false);
        }
      }
      if (decision) {
        const player = f
          .room()
          .seats.find((p) => p?.playerId === decision.playerId)!;
        const view = getBotView(state, player.seat);
        const cmd = decision.command;
        if (cmd.type === 'pass') coverage.pass++;
        if (cmd.type === 'select-starter') coverage.selection++;
        if (
          cmd.type === 'play' &&
          view.legalActions.filter(
            (a) => a.type === 'play' && a.tile === cmd.tile,
          ).length > 1
        )
          coverage.ambiguous++;
        await f.tick();
      } else {
        if (state.phase === 'round-ended') {
          coverage.rounds++;
          if (state.result.kind === 'seka') coverage.seka++;
        }
        const own = projectGame(f.room(), f.room().seats[0]!);
        const action =
          state.phase === 'round-ended'
            ? { type: 'next-round' as const }
            : chooseCommand(getBotView(state, 0), 'deterministic-first', 0)
                .command;
        if (!action) throw new Error('Expected human action');
        const command: GameAction =
          action.type === 'play'
            ? { type: 'play', tile: action.tile, end: action.end }
            : action.type === 'select-starter'
              ? { type: 'select-starter', selected: action.selected }
              : { type: action.type };
        expect(own.private.legalActions).toContainEqual(command);
        expect((await f.act(command)).ok).toBe(true);
      }
      coverage.moves++;
    }
    expect(f.room().lifecycle).toBe('completed');
    const ended = f.room().match!.state;
    if (ended.phase !== 'match-finished') throw new Error('Expected match end');
    expect(
      projectGame(f.room(), f.room().seats[0]!).public.revealedHands,
    ).toEqual(ended.round.hands);
    expect(f.timing.next()).toBeUndefined();
    expect(coverage.pass).toBeGreaterThan(0);
    expect(coverage.ambiguous).toBeGreaterThan(0);
    expect(coverage.selection).toBeGreaterThan(0);
    expect(coverage.rounds).toBeGreaterThan(0);
    expect(coverage.moves).toBeGreaterThan(28);
    expect(coverage.seka).toBeGreaterThan(0);
  });
});

describe('durable bot memberships', () => {
  it('restores an ended-round reveal and removes it when the next round is committed', async () => {
    const store = new MemoryPersistence(),
      f = await started(store);
    for (
      let step = 0;
      step < 100 && f.room().match!.state.phase === 'playing';
      step++
    ) {
      if (botDecision(f.room())) await f.tick();
      else
        await f.act(
          projectGame(f.room(), f.room().seats[0]!).private.legalActions[0]!,
        );
    }
    expect(f.room().match!.state.phase).toBe('round-ended');
    const before = projectGame(f.room(), f.room().seats[0]!).public;
    expect(before.revealedHands).toBeDefined();
    await f.service.close();
    let recovered!: Room;
    const service = new RoomService({
      persistence: store,
      botClock: botClock().clock,
      onUpdate: (room) => {
        recovered = room;
      },
      onJoined: () => {},
    });
    services.push(service);
    await service.restore();
    const host = connection();
    await service.reconnect(host, f.sessions[0]!);
    expect(projectGame(recovered, recovered.seats[0]!).public).toEqual(before);
    expect(
      (
        await service.game(host, {
          roomId: recovered.id,
          commandId: randomUUID(),
          expectedRevision: recovered.revision,
          command: { type: 'next-round' },
        })
      ).ok,
    ).toBe(true);
    expect(
      projectGame(recovered, recovered.seats[0]!).public,
    ).not.toHaveProperty('revealedHands');
  });
  it('upgrades legacy placeholders once and persists the assigned names across two restores', async () => {
    const store = new MemoryPersistence(),
      f = await setup(store);
    await f.manage({ type: 'fill' });
    await f.service.close();
    const original = store.rooms.get(f.room().id)!;
    store.rooms.set(original.roomId, {
      ...original,
      players: original.players.map((p) =>
        p.kind === 'bot' ? { ...p, displayName: `Domino ${p.seat + 1}` } : p,
      ),
    });
    let first: string[] | undefined;
    for (let restart = 0; restart < 2; restart++) {
      const service = new RoomService({
        persistence: store,
        onUpdate: () => {},
        onJoined: () => {},
      });
      services.push(service);
      await service.restore();
      const players = store.rooms.get(original.roomId)!.players;
      const names = players.map((p) => p.displayName);
      expect(players.map((p) => p.playerId)).toEqual(
        original.players.map((p) => p.playerId),
      );
      expect(new Set(names).size).toBe(4);
      for (const name of names.slice(1)) expect(PERSONA_NAMES).toContain(name);
      if (first) expect(names).toEqual(first);
      first = names;
      await service.close();
    }
  });
  it('persists identity and kind, restores bots offline without credentials, and resumes after the human returns', async () => {
    const store = new MemoryPersistence(),
      f = await started(store);
    const bots = serializeRoom(f.room()).players.slice(1);
    const personas = bots.map((p) => findBotPersona(p.displayName));
    expect(personas.every((p) => p?.gender && p.playerType === 'bot')).toBe(
      true,
    );
    await f.service.close();
    const timing = botClock();
    let recovered!: Room;
    const service = new RoomService({
      persistence: store,
      botClock: timing.clock,
      onUpdate: (r) => {
        recovered = r;
      },
      onJoined: () => {},
    });
    services.push(service);
    await service.restore();
    expect(timing.next()).toBeUndefined();
    expect(store.rooms.get(f.room().id)!.players.slice(1)).toEqual(bots);
    await service.reconnect(connection(), f.sessions[0]!);
    expect(projectRoom(recovered).isPaused).toBe(false);
    expect(
      recovered.seats
        .slice(1)
        .map((p) => [p!.playerId, p!.displayName, p!.kind]),
    ).toEqual(bots.map((p) => [p.playerId, p.displayName, p.kind]));
    expect(
      recovered.seats.slice(1).map((p) => findBotPersona(p!.displayName)),
    ).toEqual(personas);
    expect(
      projectGame(recovered, recovered.seats[0]!).public,
    ).not.toHaveProperty('revealedHands');
    timing.fire();
    await recovered.queue.drain();
    expect(recovered.seats[3]!.commands.size).toBe(1);
    expect(
      recovered.seats
        .slice(1)
        .every(
          (p) =>
            p?.socketId === null && p.tokenHash === null && p.kind === 'bot',
        ),
    ).toBe(true);
  });
  it('does not publish bot edits until commit and leaves the room unchanged on a failed write', async () => {
    const store = new MemoryPersistence(),
      f = await setup(store);
    const before = serializeRoom(f.room());
    store.fail = true;
    await expect(f.manage({ type: 'fill' })).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(serializeRoom(f.room())).toEqual(before);
    expect(f.updates).toHaveBeenCalledTimes(1);
  });
});
