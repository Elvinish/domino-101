import {
  createHash,
  timingSafeEqual,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import {
  createMatch,
  passTurn,
  playTile,
  selectStarter,
  startNextRound,
} from '@domino/game-engine';
import type { MatchState, Seat, Tile } from '@domino/game-engine';
import type {
  CommandResult,
  ReconnectSession,
  LeaveRoom,
  CreateRoom,
  GameCommand,
  JoinRoom,
  RoomJoined,
  StartRoom,
  RoomBots,
} from '@domino/protocol';
import { errorCode, failure, requireRoom, RoomError } from './errors.js';
import { SerialQueue } from './queue.js';
import { BotScheduler, botDecision } from '../bots/scheduler.js';
import type { BotClock, BotTurn } from '../bots/scheduler.js';
import { secureDeck } from './shuffle.js';
import { roomReady } from './types.js';
import type { Connection, Player, Room, RoomMember } from './types.js';
import {
  parsePersistedRoom,
  playerFromPersisted,
  serializeRoom,
} from '../persistence/codec.js';
import { fingerprint } from '../persistence/fingerprint.js';
import { COMMAND_HISTORY_LIMIT } from '../persistence/types.js';
import type { PersistenceStore } from '../persistence/types.js';

export interface RoomServiceOptions {
  readonly onSession?: (socketId: string, session: ReconnectSession) => void;
  readonly onReplaced?: (socketId: string) => void;
  readonly offlineRoomTtlMs?: number;
  readonly onUpdate: (room: Room) => void;
  readonly onRoomRemoved?: (roomId: string) => void;
  readonly onJoined: (socketId: string, joined: RoomJoined) => void;
  /** Safe diagnostics only; never pass an exception, token, state or payload. */
  readonly onPersistenceFailure?: (roomId: string) => void;
  readonly makeDeck?: () => readonly Tile[];
  readonly idempotencyLimit?: number;
  readonly maxRooms?: number;
  readonly persistence?: PersistenceStore;
  readonly botClock?: BotClock;
}

export class RoomService {
  private readonly rooms = new Map<string, Room>();
  private readonly memberships = new Map<
    string,
    { roomId: string; playerId: string }
  >();
  // Reserve across async writes so one socket cannot join different rooms concurrently.
  private readonly claims = new Set<string>();
  private readonly blocked = new Set<string>();
  private readonly expiry = new Map<string, ReturnType<typeof setTimeout>>();
  private closed = false;
  private readonly bots: BotScheduler;
  private readonly offlineRoomTtlMs: number;
  private readonly makeDeck: () => readonly Tile[];
  private readonly historyLimit: number;
  private readonly maxRooms: number;
  constructor(private readonly options: RoomServiceOptions) {
    this.bots = new BotScheduler(
      (turn) => this.runBotTurn(turn),
      options.botClock,
    );
    this.makeDeck = options.makeDeck ?? secureDeck;
    this.historyLimit = options.idempotencyLimit ?? COMMAND_HISTORY_LIMIT;
    this.maxRooms = options.maxRooms ?? 1000;
    this.offlineRoomTtlMs = options.offlineRoomTtlMs ?? 30 * 60_000;
    if (
      ![this.historyLimit, this.maxRooms, this.offlineRoomTtlMs].every(
        (value) => Number.isSafeInteger(value) && value > 0,
      ) ||
      this.historyLimit > COMMAND_HISTORY_LIMIT ||
      this.offlineRoomTtlMs > 2_147_483_647
    )
      throw new Error('Invalid room service limits');
  }
  private live(connection: Connection): void {
    requireRoom(!this.closed, 'SERVER_BUSY');
    requireRoom(connection.isConnected(), 'NOT_ROOM_MEMBER');
  }
  private available(connection: Connection): void {
    this.live(connection);
    requireRoom(
      !this.memberships.has(connection.id) && !this.claims.has(connection.id),
      'ALREADY_ROOM_MEMBER',
    );
  }
  private usable(room: Room): void {
    requireRoom(!this.closed && !this.blocked.has(room.id), 'SERVER_BUSY');
    requireRoom(this.rooms.get(room.id) === room, 'ROOM_NOT_FOUND');
    requireRoom(
      room.expiresAt === null || room.expiresAt > Date.now(),
      'ROOM_NOT_FOUND',
    );
  }
  private member(connection: Connection, room: Room): Player {
    this.live(connection);
    this.usable(room);
    const membership = this.memberships.get(connection.id);
    requireRoom(membership?.roomId === room.id, 'NOT_ROOM_MEMBER');
    const player = room.seats.find(
      (entry) => entry?.playerId === membership.playerId,
    );
    requireRoom(player && player.socketId === connection.id, 'NOT_ROOM_MEMBER');
    return player;
  }
  private getRoom(roomId: string): Room {
    const room = this.rooms.get(roomId);
    requireRoom(room, 'ROOM_NOT_FOUND');
    return room;
  }
  public chatMember(connection: Connection, roomId: string): RoomMember | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    try {
      const player = this.member(connection, room);
      return {
        roomId,
        playerId: player.playerId,
        displayName: player.displayName,
        seat: player.seat,
      };
    } catch {
      return null;
    }
  }
  public chatPlayerIds(roomId: string): readonly string[] {
    return this.getRoom(roomId).seats.flatMap((player) =>
      player ? [player.playerId] : [],
    );
  }
  public chatRecipients(roomId: string): readonly string[] {
    return (
      this.rooms
        .get(roomId)
        ?.seats.flatMap((player) =>
          player?.socketId ? [player.socketId] : [],
        ) ?? []
    );
  }
  public runRoom<T>(
    roomId: string,
    operation: () => T | Promise<T>,
  ): Promise<T> {
    const room = this.getRoom(roomId);
    return room.queue.run(() => {
      this.usable(room);
      return operation();
    });
  }
  public blockRoom(roomId: string): void {
    this.blocked.add(roomId);
    this.bots.cancel(roomId);
    this.clearExpiry(roomId);
    this.options.onPersistenceFailure?.(roomId);
  }
  private draft(room: Room): Room {
    return {
      ...room,
      seats: room.seats.map((player) =>
        player ? { ...player, commands: new Map(player.commands) } : null,
      ) as Room['seats'],
    };
  }
  private bump(room: Room): void {
    requireRoom(room.revision < Number.MAX_SAFE_INTEGER, 'INTERNAL_ERROR');
    room.revision++;
    room.updatedAt = Date.now();
  }
  private prepareExpiry(room: Room): void {
    room.expiresAt = room.seats.some((player) => player?.socketId)
      ? null
      : (room.expiresAt ?? Date.now() + this.offlineRoomTtlMs);
  }
  private async write(room: Room, remove = false): Promise<void> {
    if (!this.options.persistence) return;
    try {
      if (remove) await this.options.persistence.deleteRoom(room.id);
      else await this.options.persistence.saveRoom(serializeRoom(room));
    } catch {
      this.blockRoom(room.id);
      throw new RoomError('INTERNAL_ERROR');
    }
  }
  /** Never change a committed object, binding, timer or callback until the write succeeds. */
  private async commit(room: Room, next: Room, remove = false): Promise<void> {
    this.prepareExpiry(next);
    await this.write(next, remove);
    for (const player of room.seats) {
      if (
        player?.socketId &&
        this.memberships.get(player.socketId)?.roomId === room.id
      )
        this.memberships.delete(player.socketId);
    }
    this.clearExpiry(room.id);
    if (remove) {
      this.bots.cancel(room.id);
      this.rooms.delete(room.id);
      this.options.onRoomRemoved?.(room.id);
      return;
    }
    Object.assign(room, next);
    for (const player of room.seats)
      if (player?.socketId)
        this.memberships.set(player.socketId, {
          roomId: room.id,
          playerId: player.playerId,
        });
    this.scheduleExpiry(room);
    if (!this.closed && !this.blocked.has(room.id)) this.bots.sync(room);
  }
  private success(room: Room, commandId?: string): CommandResult {
    return {
      ok: true,
      roomId: room.id,
      revision: room.revision,
      ...(commandId ? { commandId } : {}),
    };
  }
  private addPlayer(
    room: Room,
    connection: Connection,
    displayName: string,
    seat: Seat,
  ) {
    const token = randomBytes(32).toString('base64url');
    const player: Player = {
      kind: 'human',
      playerId: randomUUID(),
      displayName,
      seat,
      socketId: connection.id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      commands: new Map(),
    };
    room.seats[seat] = player;
    return { player, token };
  }
  private joined(
    room: Room,
    connection: Connection,
    player: Player,
    token?: string,
  ): void {
    if (this.closed) return;
    if (!connection.isConnected()) {
      void this.disconnect(connection.id).catch(() => undefined);
      return;
    }
    this.options.onJoined(connection.id, {
      roomId: room.id,
      playerId: player.playerId,
      seat: player.seat,
    });
    if (token)
      this.options.onSession?.(connection.id, {
        roomId: room.id,
        playerId: player.playerId,
        reconnectToken: token,
      });
    this.options.onUpdate(room);
  }
  private newRoom(): Room {
    requireRoom(this.rooms.size < this.maxRooms, 'SERVER_BUSY');
    let id = randomBytes(16).toString('hex');
    while (this.rooms.has(id)) id = randomBytes(16).toString('hex');
    const now = Date.now();
    return {
      id,
      hostId: '',
      revision: 1,
      lifecycle: 'lobby',
      seats: [null, null, null, null],
      match: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
      queue: new SerialQueue(),
    };
  }
  /** Synchronous convenience for existing in-memory tests. Transport uses createAsync. */
  create(connection: Connection, payload: CreateRoom): CommandResult {
    requireRoom(!this.options.persistence, 'SERVER_BUSY');
    this.available(connection);
    const room = this.newRoom();
    const added = this.addPlayer(room, connection, payload.displayName, 0);
    room.hostId = added.player.playerId;
    this.rooms.set(room.id, room);
    this.memberships.set(connection.id, {
      roomId: room.id,
      playerId: added.player.playerId,
    });
    this.joined(room, connection, added.player, added.token);
    return this.success(room);
  }
  async createAsync(
    connection: Connection,
    payload: CreateRoom,
  ): Promise<CommandResult> {
    if (!this.options.persistence) return this.create(connection, payload);
    this.available(connection);
    const room = this.newRoom();
    this.rooms.set(room.id, room);
    this.claims.add(connection.id);
    return room.queue.run(async () => {
      try {
        this.live(connection);
        const next = this.draft(room);
        const added = this.addPlayer(next, connection, payload.displayName, 0);
        next.hostId = added.player.playerId;
        await this.commit(room, next);
        this.joined(room, connection, added.player, added.token);
        return this.success(room);
      } catch (error) {
        this.rooms.delete(room.id);
        throw error;
      } finally {
        this.claims.delete(connection.id);
      }
    });
  }
  join(connection: Connection, payload: JoinRoom): Promise<CommandResult> {
    const room = this.getRoom(payload.roomId);
    return room.queue.run(async () => {
      this.usable(room);
      this.available(connection);
      requireRoom(room.lifecycle === 'lobby', 'ROOM_ALREADY_STARTED');
      const seat = room.seats.findIndex((player) => player === null);
      requireRoom(seat >= 0, 'ROOM_FULL');
      this.claims.add(connection.id);
      try {
        const next = this.draft(room);
        const added = this.addPlayer(
          next,
          connection,
          payload.displayName,
          seat as Seat,
        );
        this.bump(next);
        await this.commit(room, next);
        this.joined(room, connection, added.player, added.token);
        return this.success(room);
      } finally {
        this.claims.delete(connection.id);
      }
    });
  }
  manageBots(
    connection: Connection,
    payload: RoomBots,
  ): Promise<CommandResult> {
    const room = this.getRoom(payload.roomId);
    return room.queue.run(async () => {
      const host = this.member(connection, room);
      requireRoom(host.playerId === room.hostId, 'NOT_HOST');
      requireRoom(room.lifecycle === 'lobby', 'ROOM_ALREADY_STARTED');
      requireRoom(room.revision === payload.expectedRevision, 'STALE_REVISION');
      const next = this.draft(room);
      const action = payload.action;
      if (action.type === 'remove') {
        requireRoom(next.seats[action.seat]?.kind === 'bot', 'INVALID_PAYLOAD');
        next.seats[action.seat] = null;
      } else {
        const seats =
          action.type === 'add'
            ? [action.seat]
            : next.seats.flatMap((entry, seat) =>
                entry === null ? [seat as Seat] : [],
              );
        requireRoom(seats.length > 0, 'ROOM_FULL');
        for (const seat of seats) {
          requireRoom(next.seats[seat] === null, 'INVALID_PAYLOAD');
          next.seats[seat] = {
            kind: 'bot',
            playerId: randomUUID(),
            displayName: `Domino ${seat + 1}`,
            seat,
            socketId: null,
            tokenHash: null,
            commands: new Map(),
          };
        }
      }
      this.bump(next);
      await this.commit(room, next);
      this.options.onUpdate(room);
      return this.success(room);
    });
  }
  start(connection: Connection, payload: StartRoom): Promise<CommandResult> {
    const room = this.getRoom(payload.roomId);
    return room.queue.run(async () => {
      const player = this.member(connection, room);
      requireRoom(player.playerId === room.hostId, 'NOT_HOST');
      requireRoom(room.lifecycle === 'lobby', 'ROOM_ALREADY_STARTED');
      requireRoom(roomReady(room), 'ROOM_NOT_READY');
      const next = this.draft(room);
      next.match = { id: randomUUID(), state: createMatch(this.makeDeck()) };
      next.lifecycle = 'playing';
      this.bump(next);
      await this.commit(room, next);
      this.options.onUpdate(room);
      return this.success(room);
    });
  }
  game(connection: Connection, payload: GameCommand): Promise<CommandResult> {
    const room = this.getRoom(payload.roomId);
    return room.queue.run(() =>
      this.applyGame(room, this.member(connection, room), payload),
    );
  }
  /** Both human requests and scheduled bots enter here while holding the same room queue. */
  private async applyGame(
    room: Room,
    player: Player,
    payload: GameCommand,
  ): Promise<CommandResult> {
    const digest = fingerprint(payload);
    const previous = player.commands.get(payload.commandId);
    if (previous)
      return previous.fingerprint === digest
        ? previous.result
        : failure('DUPLICATE_COMMAND_CONFLICT', payload.commandId);
    const next = this.draft(room);
    let result: CommandResult;
    try {
      requireRoom(payload.expectedRevision === room.revision, 'STALE_REVISION');
      requireRoom(room.lifecycle === 'playing' && room.match, 'INVALID_PHASE');
      requireRoom(roomReady(room), 'ROOM_NOT_READY');
      let state: MatchState;
      const command = payload.command;
      switch (command.type) {
        case 'play':
          state = playTile(
            room.match.state,
            player.seat,
            command.tile,
            command.end,
          );
          break;
        case 'pass':
          state = passTurn(room.match.state, player.seat);
          break;
        case 'select-starter':
          state = selectStarter(
            room.match.state,
            player.seat,
            command.selected,
          );
          break;
        case 'next-round':
          requireRoom(player.playerId === room.hostId, 'NOT_HOST');
          state = startNextRound(room.match.state, this.makeDeck());
          break;
      }
      this.bump(next);
      next.match = { id: room.match.id, state };
      if (state.phase === 'match-finished') next.lifecycle = 'completed';
      result = this.success(next, payload.commandId);
    } catch (error) {
      result = failure(errorCode(error), payload.commandId);
    }
    const commands = next.seats[player.seat]!.commands;
    commands.set(payload.commandId, { fingerprint: digest, result });
    if (commands.size > this.historyLimit)
      commands.delete(commands.keys().next().value!);
    await this.commit(room, next);
    if (result.ok) this.options.onUpdate(room);
    return result;
  }
  private async runBotTurn(turn: BotTurn): Promise<void> {
    const room = this.rooms.get(turn.roomId);
    if (!room) return;
    await room.queue.run(async () => {
      if (!this.bots.owns(turn)) return;
      this.usable(room);
      if (room.revision !== turn.revision || room.match?.id !== turn.matchId)
        return;
      const decision = botDecision(room);
      if (!decision || decision.playerId !== turn.playerId) return;
      const player = room.seats.find(
        (entry) => entry?.playerId === turn.playerId,
      );
      if (player?.kind !== 'bot') return;
      await this.applyGame(room, player, {
        roomId: room.id,
        commandId: randomUUID(),
        expectedRevision: turn.revision,
        command: decision.command,
      });
    }, true);
  }
  reconnect(
    connection: Connection,
    session: ReconnectSession,
  ): Promise<CommandResult> {
    const room = this.rooms.get(session.roomId);
    requireRoom(room, 'INVALID_SESSION');
    return room.queue.run(async () => {
      this.live(connection);
      requireRoom(
        this.rooms.get(room.id) === room &&
          (room.expiresAt === null || room.expiresAt > Date.now()),
        'INVALID_SESSION',
      );
      this.usable(room);
      const player = room.seats.find(
        (entry) => entry?.playerId === session.playerId,
      );
      const digest = createHash('sha256')
        .update(session.reconnectToken)
        .digest();
      const expected = Buffer.from(player?.tokenHash ?? '0'.repeat(64), 'hex');
      requireRoom(
        timingSafeEqual(digest, expected) && player?.tokenHash,
        'INVALID_SESSION',
      );
      const membership = this.memberships.get(connection.id);
      requireRoom(
        !this.claims.has(connection.id) &&
          (!membership ||
            (membership.roomId === room.id &&
              membership.playerId === player.playerId)),
        'INVALID_SESSION',
      );
      this.claims.add(connection.id);
      try {
        const next = this.draft(room);
        const oldSocket = player.socketId;
        next.seats[player.seat]!.socketId = connection.id;
        if (!oldSocket) this.bump(next);
        await this.commit(room, next);
        if (oldSocket && oldSocket !== connection.id)
          this.options.onReplaced?.(oldSocket);
        this.joined(room, connection, next.seats[player.seat]!);
        return this.success(room);
      } finally {
        this.claims.delete(connection.id);
      }
    });
  }
  leave(connection: Connection, payload: LeaveRoom): Promise<CommandResult> {
    const room = this.getRoom(payload.roomId);
    return room.queue.run(async () => {
      const player = this.member(connection, room);
      const next = this.draft(room);
      next.seats[player.seat]!.socketId = null;
      next.seats[player.seat]!.tokenHash = null;
      if (next.lifecycle === 'lobby') {
        next.seats[player.seat] = null;
        if (player.playerId === next.hostId)
          next.hostId =
            next.seats.find((entry) => entry?.kind === 'human')?.playerId ?? '';
      }
      this.bump(next);
      const result = this.success(next);
      const remove = !next.seats.some((entry) => entry?.kind === 'human');
      await this.commit(room, next, remove);
      if (!remove) this.options.onUpdate(room);
      return result;
    });
  }
  disconnect(socketId: string): Promise<void> {
    const membership = this.memberships.get(socketId);
    if (!membership) return Promise.resolve();
    const room = this.rooms.get(membership.roomId);
    if (!room) return Promise.resolve();
    this.bots.cancel(room.id);
    return room.queue.run(async () => {
      if (this.closed || this.blocked.has(room.id)) return;
      const player = room.seats.find(
        (entry) =>
          entry?.playerId === membership.playerId &&
          entry.socketId === socketId,
      );
      if (!player) return;
      const next = this.draft(room);
      next.seats[player.seat]!.socketId = null;
      this.bump(next);
      await this.commit(room, next);
      this.options.onUpdate(room);
    }, true);
  }
  private clearExpiry(roomId: string): void {
    clearTimeout(this.expiry.get(roomId));
    this.expiry.delete(roomId);
  }
  private scheduleExpiry(room: Room): void {
    if (this.closed || room.expiresAt === null || this.expiry.has(room.id))
      return;
    const timer = setTimeout(
      () => {
        void room.queue
          .run(async () => {
            if (
              this.closed ||
              this.blocked.has(room.id) ||
              this.expiry.get(room.id) !== timer
            )
              return;
            if (room.expiresAt !== null && room.expiresAt > Date.now()) {
              this.clearExpiry(room.id);
              this.scheduleExpiry(room);
            } else if (!room.seats.some((player) => player?.socketId))
              await this.commit(room, room, true);
          }, true)
          .catch(() => {
            /* write() already recorded the safe failure. */
          });
      },
      Math.min(2_147_483_647, Math.max(0, room.expiresAt - Date.now())),
    );
    timer.unref();
    this.expiry.set(room.id, timer);
  }
  async restore(): Promise<readonly string[]> {
    if (!this.options.persistence) return [];
    const records = await this.options.persistence.loadRooms();
    requireRoom(records.length <= this.maxRooms, 'SERVER_BUSY');
    for (const value of records) {
      const record = parsePersistedRoom(value);
      if (record.expiresAt !== null && record.expiresAt <= Date.now()) {
        await this.options.persistence.deleteRoom(record.roomId);
        continue;
      }
      const seats: Room['seats'] = [null, null, null, null];
      for (const player of record.players)
        seats[player.seat] = playerFromPersisted(player);
      const room: Room = {
        id: record.roomId,
        hostId: record.hostId,
        revision: record.revision,
        lifecycle: record.lifecycle,
        seats,
        queue: new SerialQueue(),
        match:
          record.matchId && record.matchState
            ? { id: record.matchId, state: record.matchState }
            : null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        expiresAt: record.expiresAt,
      };
      this.prepareExpiry(room);
      // Persist the recovery deadline once, so repeated restarts do not extend it.
      await this.write(room);
      this.rooms.set(room.id, room);
      this.scheduleExpiry(room);
      this.bots.sync(room);
    }
    return [...this.rooms.keys()];
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.bots.close();
    for (const roomId of this.expiry.keys()) this.clearExpiry(roomId);
    await Promise.all(
      [...this.rooms.values()].map((room) => room.queue.drain()),
    );
    try {
      for (const room of this.rooms.values()) {
        if (
          this.options.persistence &&
          !this.blocked.has(room.id) &&
          room.expiresAt === null
        ) {
          const next = this.draft(room);
          for (const player of next.seats) if (player) player.socketId = null;
          this.prepareExpiry(next);
          await this.write(next);
        }
        this.options.onRoomRemoved?.(room.id);
      }
    } finally {
      this.rooms.clear();
      this.memberships.clear();
      this.claims.clear();
    }
  }
}
