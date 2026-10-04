import { Server } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  commandResultSchema,
  createRoomSchema,
  gameCommandSchema,
  joinRoomSchema,
  roomJoinedSchema,
  roomSessionSchema,
  reconnectRoomSchema,
  leaveRoomSchema,
  chatCommandSchema,
  reactionCommandSchema,
  chatMessageSchema,
  chatHistorySchema,
  reactionReceivedSchema,
  socialResultSchema,
  serverErrorSchema,
  startRoomSchema,
  voiceServerSchemas,
  roomBotsSchema,
} from '@domino/protocol';
import type {
  ClientToServerEvents,
  CommandResult,
  SocialResult,
  ServerToClientEvents,
} from '@domino/protocol';
import type { ServerEnv } from '../config/env.js';
import { errorCode, failure } from '../rooms/errors.js';
import { projectGame, projectRoom } from '../rooms/projections.js';
import { RoomService } from '../rooms/service.js';
import type { RoomServiceOptions } from '../rooms/service.js';
import { ChatService } from '../chat/service.js';
import type { ChatServiceOptions } from '../chat/service.js';
import type { PersistenceStore } from '../persistence/types.js';
import { VoiceService } from '../voice/service.js';
import { attachVoice } from '../voice/socket.js';

export type RealtimeOptions = Pick<
  RoomServiceOptions,
  'makeDeck' | 'maxRooms' | 'idempotencyLimit' | 'offlineRoomTtlMs' | 'botClock'
> & { persistence?: PersistenceStore };
export function attachRealtime(
  app: FastifyInstance,
  config: ServerEnv,
  options: RealtimeOptions = {},
): void {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(
    app.server,
    {
      serveClient: false,
      maxHttpBufferSize: 8192,
      cors: { origin: config.WEB_ORIGIN },
      // Covers WebSocket as well as polling. Origin-less native QA clients are allowed.
      allowRequest: (request, accept) =>
        accept(
          null,
          request.headers.origin === undefined ||
            request.headers.origin === config.WEB_ORIGIN,
        ),
    },
  );
  const roomOptions: RoomServiceOptions = {
    ...options,
    onPersistenceFailure: (roomId) =>
      app.log.error(
        { roomId, code: 'PERSISTENCE_WRITE_FAILED' },
        'Room locked pending recovery',
      ),
    onRoomRemoved: (roomId) => {
      chat.removeRoom(roomId);
      voice.removeRoom(roomId);
    },
    onSession: (socketId, session) => {
      io.sockets.sockets
        .get(socketId)
        ?.emit(SERVER_EVENTS.session, roomSessionSchema.parse(session));
    },
    onReplaced: (socketId) => {
      voice.removeSocket(socketId);
      io.sockets.sockets.get(socketId)?.emit(SERVER_EVENTS.replaced, {});
    },
    onJoined: (socketId, joined) => {
      io.sockets.sockets
        .get(socketId)
        ?.emit(SERVER_EVENTS.joined, roomJoinedSchema.parse(joined));
      voice.participantsFor(socketId, joined.roomId);
    },
    onUpdate: (room) => {
      const publicRoom = projectRoom(room);
      for (const player of room.seats) {
        if (!player?.socketId) continue;
        const socket = io.sockets.sockets.get(player.socketId);
        if (!socket?.connected) continue;
        socket.emit(SERVER_EVENTS.room, publicRoom);
        if (room.match)
          socket.emit(SERVER_EVENTS.game, projectGame(room, player));
      }
    },
  };
  const rooms = new RoomService(roomOptions);
  const voice = new VoiceService({
    resolveMember: (connection, roomId) => rooms.chatMember(connection, roomId),
    connection: (id) => ({
      id,
      isConnected: () => io.sockets.sockets.get(id)?.connected === true,
    }),
    recipients: (roomId) => rooms.chatRecipients(roomId),
    runRoom: (roomId, operation) => rooms.runRoom(roomId, operation),
    emit: (id, event, payload) => {
      const socket = io.sockets.sockets.get(id);
      if (!socket?.connected) return;
      // Preserve the event/payload pairing already enforced by VoiceServiceOptions.
      const emit = socket.emit.bind(socket) as (
        name: string,
        value: unknown,
      ) => void;
      emit(event, voiceServerSchemas[event].parse(payload));
    },
  });
  const chatOptions: ChatServiceOptions = {
    resolveMember: (connection, roomId) => rooms.chatMember(connection, roomId),
    recipients: (roomId) => rooms.chatRecipients(roomId),
    runRoom: (roomId, operation) => rooms.runRoom(roomId, operation),
    playerIds: (roomId) => rooms.chatPlayerIds(roomId),
    onPersistenceFailure: (roomId) => rooms.blockRoom(roomId),
    ...(options.persistence ? { persistence: options.persistence } : {}),
    onMessage: (socketIds, message) => {
      for (const socketId of socketIds)
        io.sockets.sockets
          .get(socketId)
          ?.emit(SERVER_EVENTS.chatMessage, chatMessageSchema.parse(message));
    },
    onHistory: (socketId, history) => {
      io.sockets.sockets
        .get(socketId)
        ?.emit(SERVER_EVENTS.chatHistory, chatHistorySchema.parse(history));
    },
    onReaction: (socketIds, reaction) => {
      for (const socketId of socketIds)
        io.sockets.sockets
          .get(socketId)
          ?.emit(
            SERVER_EVENTS.reaction,
            reactionReceivedSchema.parse(reaction),
          );
    },
  };
  const chat = new ChatService(chatOptions);
  app.addHook('onReady', async () => {
    if (options.persistence) {
      await options.persistence.initialize();
      await chat.restore(await rooms.restore());
    }
  });
  io.on('connection', (socket) => {
    attachVoice(socket, voice);
    const connection = { id: socket.id, isConnected: () => socket.connected };
    async function handle<T>(
      event: keyof ClientToServerEvents,
      schema: z.ZodType<T>,
      payload: unknown,
      ack: unknown,
      operation: (value: T) => CommandResult | Promise<CommandResult>,
    ): Promise<void> {
      let result: CommandResult;
      const parsed = schema.safeParse(payload);
      if (!parsed.success) result = failure('INVALID_PAYLOAD');
      else {
        try {
          result = await operation(parsed.data);
        } catch (error) {
          result = failure(
            errorCode(error),
            event === CLIENT_EVENTS.command
              ? gameCommandSchema.parse(parsed.data).commandId
              : undefined,
          );
        }
      }
      // Allow-list serialized responses; never log payloads, Zod issues or raw errors.
      result = commandResultSchema.parse(result);
      if (!result.ok) {
        const error = serverErrorSchema.parse({
          event,
          code: result.error.code,
          ...(result.commandId ? { commandId: result.commandId } : {}),
        });
        socket.emit(SERVER_EVENTS.error, error);
        if (error.code === 'INTERNAL_ERROR')
          app.log.error({ event, code: error.code }, 'Room request failed');
      }
      socket.emit(SERVER_EVENTS.result, result);
      if (typeof ack === 'function') ack(result);
    }
    async function handleSocial<T>(
      event: keyof ClientToServerEvents,
      schema: z.ZodType<T>,
      payload: unknown,
      ack: unknown,
      operation: (value: T) => SocialResult | Promise<SocialResult>,
    ): Promise<void> {
      let result: SocialResult;
      const parsed = schema.safeParse(payload);
      if (!parsed.success)
        result = { ok: false, error: { code: 'INVALID_PAYLOAD' } };
      else {
        try {
          result = await operation(parsed.data);
        } catch (error) {
          result = {
            ok: false,
            error: { code: errorCode(error) },
            ...(typeof parsed.data === 'object' &&
            parsed.data !== null &&
            'commandId' in parsed.data &&
            typeof (parsed.data as { commandId?: unknown }).commandId ===
              'string'
              ? {
                  commandId: (parsed.data as { commandId: string }).commandId,
                }
              : {}),
          };
        }
      }
      result = socialResultSchema.parse(result);
      if (!result.ok) {
        const serverError = serverErrorSchema.parse({
          event,
          code: result.error.code,
          ...(result.commandId ? { commandId: result.commandId } : {}),
        });
        socket.emit(SERVER_EVENTS.error, serverError);
        if (serverError.code === 'INTERNAL_ERROR')
          app.log.error(
            { event, code: serverError.code },
            'Room request failed',
          );
      }
      if (typeof ack === 'function') ack(result);
    }
    const sendHistory = (roomId: string) => {
      void chat.historyFor(connection, roomId).catch(() => undefined);
    };
    // All handlers funnel unknown wire data through the matching shared schema.
    const safe = (operation: Promise<void>) => {
      void operation.catch(() => {
        app.log.error({ code: 'INTERNAL_ERROR' }, 'Socket response failed');
      });
    };
    socket.on(CLIENT_EVENTS.create, (payload, ack) =>
      safe(
        handle(
          CLIENT_EVENTS.create,
          createRoomSchema,
          payload,
          ack,
          (value) => {
            return rooms.createAsync(connection, value).then((result) => {
              if (result.ok) sendHistory(result.roomId);
              return result;
            });
          },
        ),
      ),
    );
    socket.on(CLIENT_EVENTS.join, (payload, ack) =>
      safe(
        handle(CLIENT_EVENTS.join, joinRoomSchema, payload, ack, (value) =>
          rooms.join(connection, value).then((result) => {
            if (result.ok) sendHistory(result.roomId);
            return result;
          }),
        ),
      ),
    );
    socket.on(CLIENT_EVENTS.reconnect, (payload, ack) =>
      safe(
        handle(
          CLIENT_EVENTS.reconnect,
          reconnectRoomSchema,
          payload,
          ack,
          (value) =>
            rooms.reconnect(connection, value).then((result) => {
              if (result.ok) sendHistory(result.roomId);
              return result;
            }),
        ),
      ),
    );
    socket.on(CLIENT_EVENTS.leave, (payload, ack) =>
      safe(
        handle(CLIENT_EVENTS.leave, leaveRoomSchema, payload, ack, (value) =>
          rooms.leave(connection, value).then((result) => {
            if (result.ok) voice.removeSocket(socket.id);
            return result;
          }),
        ),
      ),
    );
    socket.on(CLIENT_EVENTS.start, (payload, ack) =>
      safe(
        handle(CLIENT_EVENTS.start, startRoomSchema, payload, ack, (value) =>
          rooms.start(connection, value),
        ),
      ),
    );
    socket.on(CLIENT_EVENTS.bots, (payload, ack) =>
      safe(
        handle(CLIENT_EVENTS.bots, roomBotsSchema, payload, ack, (value) =>
          rooms.manageBots(connection, value),
        ),
      ),
    );
    socket.on(CLIENT_EVENTS.command, (payload, ack) =>
      safe(
        handle(
          CLIENT_EVENTS.command,
          gameCommandSchema,
          payload,
          ack,
          (value) => rooms.game(connection, value),
        ),
      ),
    );
    socket.on(CLIENT_EVENTS.chat, (payload, ack) =>
      safe(
        handleSocial(
          CLIENT_EVENTS.chat,
          chatCommandSchema,
          payload,
          ack,
          (value) => chat.send(connection, value),
        ),
      ),
    );
    socket.on(CLIENT_EVENTS.reaction, (payload, ack) =>
      safe(
        handleSocial(
          CLIENT_EVENTS.reaction,
          reactionCommandSchema,
          payload,
          ack,
          (value) => chat.sendReaction(connection, value),
        ),
      ),
    );
    socket.on('disconnect', () => {
      voice.removeSocket(socket.id);
      void rooms
        .disconnect(socket.id)
        .catch(() =>
          app.log.error({ code: 'INTERNAL_ERROR' }, 'Room disconnect failed'),
        );
    });
  });
  app.addHook('preClose', async () => {
    try {
      await rooms.close();
    } finally {
      io.disconnectSockets(true);
      await io.close();
      await options.persistence?.close();
    }
  });
}
