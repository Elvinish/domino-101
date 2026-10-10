import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  commandResultSchema,
  createRoomSchema,
  joinRoomSchema,
  roomJoinedSchema,
  roomSnapshotSchema,
  gameSnapshotSchema,
  roomSessionSchema,
  roomReplacedSchema,
  chatHistorySchema,
  chatMessageSchema,
  reactionReceivedSchema,
  chatCommandSchema,
  reactionCommandSchema,
  socialResultSchema,
  roomBotsSchema,
} from '@domino/protocol';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  RoomJoined,
  RoomSnapshot,
  GameSnapshot,
  GameAction,
  CommandResult,
  ReconnectSession,
  ChatMessage,
  ReactionReceived,
  SocialResult,
  BotAction,
} from '@domino/protocol';
import { errorMessages } from './errors';
import type { MessageKey } from '../i18n';
import { browserSessions } from './session';
import type { SessionStore } from './session';
import { VoiceClient } from '../voice/client';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export interface ClientState {
  status: 'connecting' | 'connected' | 'disconnected';
  joined: RoomJoined | null;
  room: RoomSnapshot | null;
  game: GameSnapshot | null;
  pending: boolean;
  chatPending: boolean;
  chat: ChatMessage[];
  reactions: ReactionReceived[];
  unreadChat: number;
  restoring: boolean;
  reconnecting: boolean;
  replaced: boolean;
  storageWarning: MessageKey | null;
  error: MessageKey | null;
  chatError: MessageKey | null;
}
const initialState = (): ClientState => ({
  status: 'connecting',
  joined: null,
  room: null,
  game: null,
  pending: false,
  chatPending: false,
  chat: [],
  reactions: [],
  unreadChat: 0,
  restoring: false,
  reconnecting: false,
  replaced: false,
  storageWarning: null,
  error: null,
  chatError: null,
});

/** Owns transport and authoritative snapshots; React only subscribes and sends intent. */
export class MultiplayerClient {
  private state = initialState();
  private listeners = new Set<() => void>();
  private socket: GameSocket | null = null;
  private cancelRequest: (() => void) | null = null;
  private cancelSocial: (() => void) | null = null;
  private removeManagerListeners: (() => void) | null = null;
  private desiredRoom: string | null = null;
  private session: ReconnectSession | null = null;
  constructor(
    private readonly makeSocket: () => GameSocket,
    private readonly sessions: SessionStore = browserSessions(),
    readonly voice: VoiceClient = new VoiceClient(),
  ) {}
  setRoom = (roomId: string | null) => {
    this.desiredRoom = roomId;
    if (
      this.state.status === 'connected' &&
      !this.state.joined &&
      !this.state.pending
    )
      void this.restore();
  };
  private async restore() {
    const roomId = this.state.joined?.roomId ?? this.desiredRoom;
    if (!roomId || this.state.replaced) return;
    const session =
      this.session?.roomId === roomId
        ? this.session
        : this.sessions.read(roomId);
    if (!session) return;
    this.session = session;
    this.update({ restoring: true });
    await this.request(
      (socket, ack) => socket.emit(CLIENT_EVENTS.reconnect, session, ack),
      true,
    );
    this.update({ restoring: false });
  }
  retry = () => {
    this.dispose();
    this.connect();
  };
  getSnapshot = (): ClientState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<ClientState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  connect = () => {
    if (this.socket) return;
    const socket = this.makeSocket();
    this.socket = socket;
    this.voice.bind(socket);
    this.update({ status: 'connecting', error: null });
    const attempting = () => {
      if (this.socket === socket && !this.state.replaced)
        this.update({ reconnecting: true });
    };
    const exhausted = () => {
      if (this.socket === socket && !this.state.replaced) {
        this.update({ reconnecting: false });
        this.lost('errors.reconnectFailed');
      }
    };
    socket.io.on('reconnect_attempt', attempting);
    socket.io.on('reconnect_failed', exhausted);
    this.removeManagerListeners = () => {
      socket.io.off('reconnect_attempt', attempting);
      socket.io.off('reconnect_failed', exhausted);
    };
    socket.on('connect', () => {
      this.update({ status: 'connected', reconnecting: false, error: null });
      void this.restore();
    });
    socket.on('connect_error', () => this.lost('errors.unreachable'));
    socket.on('disconnect', () =>
      this.lost(
        this.state.replaced ? 'errors.replaced' : 'errors.disconnected',
      ),
    );
    socket.on(SERVER_EVENTS.session, (payload) => {
      if (this.state.status !== 'connected' || this.socket !== socket) return;
      const parsed = roomSessionSchema.safeParse(payload);
      if (!parsed.success) return this.invalid();
      const session = parsed.data;
      if (
        session.roomId !== this.state.joined?.roomId ||
        session.playerId !== this.state.joined.playerId
      )
        return;
      this.session = session;
      this.update({
        storageWarning: this.sessions.write(session) ? null : 'errors.storage',
      });
    });
    socket.on(SERVER_EVENTS.replaced, (payload) => {
      if (!roomReplacedSchema.safeParse(payload).success) return this.invalid();
      this.update({ replaced: true });
      this.lost('errors.replaced');
      socket.disconnect(); // Never automatically take the seat back from the newer tab.
    });
    socket.on(SERVER_EVENTS.joined, (payload) => {
      if (this.state.status !== 'connected' || this.socket !== socket) return;
      const parsed = roomJoinedSchema.safeParse(payload);
      if (!parsed.success) return this.invalid();
      this.update({ joined: parsed.data });
      this.voice.setMembership(parsed.data);
    });
    socket.on(SERVER_EVENTS.chatHistory, (payload) => {
      if (this.state.status !== 'connected' || this.socket !== socket) return;
      const parsed = chatHistorySchema.safeParse(payload);
      if (!parsed.success) return this.invalid();
      if (parsed.data.roomId !== this.state.joined?.roomId) return;
      this.update({ chat: parsed.data.messages, unreadChat: 0 });
    });
    socket.on(SERVER_EVENTS.chatMessage, (payload) => {
      if (this.state.status !== 'connected' || this.socket !== socket) return;
      const parsed = chatMessageSchema.safeParse(payload);
      if (!parsed.success) return this.invalid();
      if (parsed.data.sender.seat < 0 || parsed.data.sender.seat > 3)
        return this.invalid();
      if (parsed.data.sender.playerId === this.state.joined?.playerId) {
        const messages = [...this.state.chat, parsed.data].slice(-50);
        this.update({ chat: messages });
      } else {
        const messages = [...this.state.chat, parsed.data].slice(-50);
        this.update({ chat: messages, unreadChat: this.state.unreadChat + 1 });
      }
    });
    socket.on(SERVER_EVENTS.reaction, (payload) => {
      if (this.state.status !== 'connected' || this.socket !== socket) return;
      const parsed = reactionReceivedSchema.safeParse(payload);
      if (!parsed.success) return this.invalid();
      this.update({
        reactions: [...this.state.reactions, parsed.data].slice(-20),
      });
    });
    socket.on(SERVER_EVENTS.room, (payload) => {
      if (this.state.status !== 'connected' || this.socket !== socket) return;
      const parsed = roomSnapshotSchema.safeParse(payload);
      if (!parsed.success) return this.invalid();
      const next = parsed.data;
      if (next.roomId !== this.state.joined?.roomId) return;
      if (this.state.room && next.revision <= this.state.room.revision) return;
      this.update({ room: next });
    });
    socket.on(SERVER_EVENTS.game, (payload) => {
      if (this.state.status !== 'connected' || this.socket !== socket) return;
      const parsed = gameSnapshotSchema.safeParse(payload);
      if (!parsed.success) return this.invalid();
      const next = parsed.data,
        own = this.state.joined;
      if (
        !own ||
        next.roomId !== own.roomId ||
        next.playerId !== own.playerId ||
        next.seat !== own.seat
      )
        return;
      if (
        next.revision < (this.state.room?.revision ?? 0) ||
        next.revision <= (this.state.game?.revision ?? -1)
      )
        return;
      this.update({ game: next });
    });
    socket.connect();
  };
  private invalid() {
    this.lost('errors.unreadable');
    this.socket?.disconnect();
  }
  private lost(message: MessageKey) {
    this.voice.reset();
    this.cancelRequest?.();
    this.cancelSocial?.();
    this.update({
      status: 'disconnected',
      pending: false,
      chatPending: false,
      game: null,
      chat: [],
      chatError: null,
      reactions: [],
      unreadChat: 0,
      restoring: false,
      error: message,
    });
  }
  dispose = () => {
    this.voice.unbind();
    this.removeManagerListeners?.();
    this.removeManagerListeners = null;
    this.cancelRequest?.();
    this.cancelSocial?.();
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.update(initialState());
  };
  leave = async () => {
    this.voice.leave();
    const roomId = this.state.joined?.roomId ?? this.desiredRoom;
    // A replaced tab must not erase another tab's session credential.
    if (roomId && !this.state.replaced) this.sessions.clear(roomId);
    this.session = null;
    if (
      this.state.joined &&
      !this.state.replaced &&
      this.socket?.connected &&
      !this.state.pending
    )
      await this.request((socket, ack) =>
        socket.emit(
          CLIENT_EVENTS.leave,
          { roomId: this.state.joined!.roomId },
          ack,
        ),
      );
    this.desiredRoom = null;
    this.dispose();
    this.connect();
  };
  clearError = () => this.update({ error: null });
  markChatRead = () => {
    if (this.state.unreadChat) this.update({ unreadChat: 0 });
  };
  private request(
    send: (socket: GameSocket, ack: (data: CommandResult) => void) => void,
    reconnect = false,
  ): Promise<boolean> {
    const socket = this.socket;
    if (
      !socket?.connected ||
      this.state.status !== 'connected' ||
      this.state.pending
    )
      return Promise.resolve(false);
    this.update({ pending: true, error: null });
    return new Promise((resolve) => {
      let finished = false;
      const finish = (ok: boolean) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.cancelRequest = null;
        this.update({ pending: false });
        resolve(ok);
      };
      const timer = setTimeout(() => {
        finish(false);
        // Outcome is unknown: never retry automatically or let buffered moves escape.
        this.lost('errors.timeout');
        socket.disconnect();
      }, 10_000);
      this.cancelRequest = () => finish(false);
      send(socket, (raw) => {
        if (finished || this.socket !== socket) return;
        const parsed = commandResultSchema.safeParse(raw);
        if (!parsed.success) {
          finish(false);
          this.invalid();
          return;
        }
        const result = parsed.data;
        if (!result.ok) {
          if (
            reconnect &&
            (result.error.code === 'INVALID_SESSION' ||
              result.error.code === 'ROOM_NOT_FOUND' ||
              result.error.code === 'INVALID_PAYLOAD')
          ) {
            if (this.session) this.sessions.clear(this.session.roomId);
            this.session = null;
            this.update({ joined: null, room: null, game: null });
          }
          this.update({ error: errorMessages[result.error.code] });
        }
        // Acknowledgements never replace snapshots or roll revisions backward.
        finish(result.ok);
      });
    });
  }
  private requestSocial(
    send: (socket: GameSocket, ack: (data: SocialResult) => void) => void,
  ): Promise<boolean> {
    const socket = this.socket;
    if (
      !socket?.connected ||
      this.state.status !== 'connected' ||
      this.state.chatPending
    )
      return Promise.resolve(false);
    this.update({ chatPending: true, chatError: null });
    return new Promise((resolve) => {
      let finished = false;
      const finish = (ok: boolean) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.cancelSocial = null;
        this.update({ chatPending: false });
        resolve(ok);
      };
      const timer = setTimeout(() => {
        this.update({ chatError: 'errors.chatTimeout' });
        finish(false);
      }, 10_000);
      this.cancelSocial = () => finish(false);
      send(socket, (raw) => {
        if (finished || this.socket !== socket) return;
        const parsed = socialResultSchema.safeParse(raw);
        if (!parsed.success) {
          finish(false);
          this.invalid();
          return;
        }
        if (!parsed.data.ok)
          this.update({ chatError: errorMessages[parsed.data.error.code] });
        finish(parsed.data.ok);
      });
    });
  }
  sendChat = (text: string) => {
    const roomId = this.state.joined?.roomId;
    const parsed = chatCommandSchema.safeParse({
      roomId,
      commandId: crypto.randomUUID(),
      text,
    });
    if (!parsed.success) {
      this.update({ error: errorMessages.INVALID_PAYLOAD });
      return Promise.resolve(false);
    }
    return this.requestSocial((socket, ack) =>
      socket.emit(CLIENT_EVENTS.chat, parsed.data, ack),
    );
  };
  sendReaction = (reaction: string) => {
    const roomId = this.state.joined?.roomId;
    const parsed = reactionCommandSchema.safeParse({
      roomId,
      commandId: crypto.randomUUID(),
      reaction,
    });
    if (!parsed.success) {
      this.update({ error: errorMessages.INVALID_REACTION });
      return Promise.resolve(false);
    }
    return this.requestSocial((socket, ack) =>
      socket.emit(CLIENT_EVENTS.reaction, parsed.data, ack),
    );
  };
  create = (displayName: string) => {
    const parsed = createRoomSchema.safeParse({ displayName });
    if (!parsed.success) {
      this.update({ error: errorMessages.INVALID_PAYLOAD });
      return Promise.resolve(false);
    }
    return this.request((socket, ack) =>
      socket.emit(CLIENT_EVENTS.create, parsed.data, ack),
    );
  };
  join = (roomId: string, displayName: string) => {
    const parsed = joinRoomSchema.safeParse({ roomId, displayName });
    if (!parsed.success) {
      this.update({ error: errorMessages.INVALID_PAYLOAD });
      return Promise.resolve(false);
    }
    return this.request((socket, ack) =>
      socket.emit(CLIENT_EVENTS.join, parsed.data, ack),
    );
  };
  start = () => {
    const roomId = this.state.joined?.roomId;
    return roomId
      ? this.request((socket, ack) =>
          socket.emit(CLIENT_EVENTS.start, { roomId }, ack),
        )
      : Promise.resolve(false);
  };
  manageBots = (action: BotAction) => {
    const { room, joined } = this.state;
    if (
      !room ||
      !joined ||
      room.hostId !== joined.playerId ||
      room.lifecycle !== 'lobby' ||
      this.state.replaced
    )
      return Promise.resolve(false);
    const payload = roomBotsSchema.safeParse({
      roomId: room.roomId,
      expectedRevision: room.revision,
      action,
    });
    if (!payload.success) return Promise.resolve(false);
    return this.request((socket, ack) =>
      socket.emit(CLIENT_EVENTS.bots, payload.data, ack),
    );
  };
  act = (command: GameAction) => {
    const { room, game, joined } = this.state;
    if (
      !room ||
      !game ||
      !joined ||
      room.isPaused ||
      room.revision !== game.revision
    )
      return Promise.resolve(false);
    const payload = {
      roomId: room.roomId,
      commandId: crypto.randomUUID(),
      expectedRevision: game.revision,
      command,
    };
    return this.request((socket, ack) =>
      socket.emit(CLIENT_EVENTS.command, payload, ack),
    );
  };
}
export function createMultiplayerClient(
  url: string,
  iceServers?: RTCIceServer[],
) {
  return new MultiplayerClient(
    () =>
      io(url, {
        autoConnect: false,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 500,
        reconnectionDelayMax: 3000,
        forceNew: true,
        transports: ['websocket', 'polling'],
        tryAllTransports: true,
      }),
    undefined,
    new VoiceClient(iceServers),
  );
}
