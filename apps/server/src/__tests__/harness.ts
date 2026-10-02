import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  commandResultSchema,
  socialResultSchema,
} from '@domino/protocol';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  CommandResult,
  RoomJoined,
  ReconnectSession,
  RoomSnapshot,
  GameSnapshot,
  GameAction,
  ChatHistory,
  ChatMessage,
  ReactionReceived,
  SocialResult,
} from '@domino/protocol';
import type { Tile } from '@domino/game-engine';
import { createApp } from '../app.js';
import { parseServerEnv } from '../config/env.js';
import type { RealtimeOptions } from '../realtime/socket.js';

export const TEST_DECK: readonly Tile[] = [
  '3:5',
  '4:4',
  '0:2',
  '0:5',
  '2:5',
  '2:4',
  '3:4',
  '4:5',
  '3:6',
  '6:6',
  '5:5',
  '1:4',
  '2:3',
  '0:3',
  '3:3',
  '5:6',
  '1:1',
  '0:4',
  '1:6',
  '0:0',
  '1:5',
  '4:6',
  '1:2',
  '0:1',
  '2:6',
  '2:2',
  '1:3',
  '0:6',
];
export interface Client {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  joined: RoomJoined | null;
  session: ReconnectSession | null;
  room: RoomSnapshot | null;
  game: GameSnapshot | null;
  history: ChatHistory | null;
  chat: ChatMessage[];
  reactions: ReactionReceived[];
  events: { event: string; payload: unknown }[];
}
export async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 4000;
  while (!condition()) {
    if (Date.now() > deadline)
      throw new Error('Timed out waiting for socket state');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
export async function harness(options: RealtimeOptions = {}) {
  const app = createApp(parseServerEnv({ LOG_LEVEL: 'silent' }), {
    makeDeck: () => TEST_DECK,
    ...options,
  });
  const clients: Client[] = [];
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  async function connect(
    transport: 'websocket' | 'polling' = 'websocket',
  ): Promise<Client> {
    const socket = io(address, {
      transports: [transport],
      reconnection: false,
      forceNew: true,
      autoConnect: false,
    });
    const client: Client = {
      socket,
      joined: null,
      session: null,
      room: null,
      game: null,
      history: null,
      chat: [],
      reactions: [],
      events: [],
    };
    clients.push(client);
    socket.onAny((event: string, payload: unknown) =>
      client.events.push({ event, payload }),
    );
    socket.on(SERVER_EVENTS.session, (value) => {
      client.session = value;
    });
    socket.on(SERVER_EVENTS.joined, (value) => {
      client.joined = value;
    });
    socket.on(SERVER_EVENTS.room, (value) => {
      client.room = value;
    });
    socket.on(SERVER_EVENTS.game, (value) => {
      client.game = value;
    });
    socket.on(SERVER_EVENTS.chatHistory, (value) => {
      client.history = value;
      client.chat = value.messages;
    });
    socket.on(SERVER_EVENTS.chatMessage, (value) => {
      client.chat.push(value);
    });
    socket.on(SERVER_EVENTS.reaction, (value) => {
      client.reactions.push(value);
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      socket.connect();
    });
    return client;
  }
  async function room() {
    const members = await Promise.all([
      connect(),
      connect(),
      connect(),
      connect(),
    ]);
    const created = await send(members[0]!, CLIENT_EVENTS.create, {
      displayName: 'Player 0',
    });
    if (!created.ok) throw new Error(created.error.code);
    for (let index = 1; index < 4; index++) {
      const result = await send(members[index]!, CLIENT_EVENTS.join, {
        roomId: created.roomId,
        displayName: `Player ${index}`,
      });
      if (!result.ok) throw new Error(result.error.code);
    }
    await until(() => members.every((client) => client.room?.revision === 4));
    return { members, roomId: created.roomId };
  }
  async function started() {
    const value = await room();
    const result = await send(value.members[0]!, CLIENT_EVENTS.start, {
      roomId: value.roomId,
    });
    if (!result.ok) throw new Error(result.error.code);
    await until(() =>
      value.members.every(
        (client) => client.game?.revision === result.revision,
      ),
    );
    return value;
  }
  async function close() {
    for (const client of clients) client.socket.disconnect();
    await app.close();
  }
  return { app, address, clients, connect, room, started, close };
}
/** Intentionally accepts unknown to exercise malicious wire payloads, not just TS callers. */
export function send(
  client: Client,
  event: keyof ClientToServerEvents,
  payload: unknown,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Missing acknowledgement for ${event}`)),
      4000,
    );
    const emit = client.socket.emit.bind(client.socket) as (
      event: string,
      payload: unknown,
      ack: (value: unknown) => void,
    ) => void;
    emit(event, payload, (value) => {
      clearTimeout(timeout);
      try {
        resolve(commandResultSchema.parse(value));
      } catch (error) {
        reject(error);
      }
    });
  });
}
export function sendSocial(
  client: Client,
  event: 'chat:send' | 'reaction:send',
  payload: unknown,
): Promise<SocialResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Missing acknowledgement for ${event}`)),
      4000,
    );
    const emit = client.socket.emit.bind(client.socket) as (
      event: string,
      payload: unknown,
      ack: (value: unknown) => void,
    ) => void;
    emit(event, payload, (value) => {
      clearTimeout(timeout);
      try {
        resolve(socialResultSchema.parse(value));
      } catch (error) {
        reject(error);
      }
    });
  });
}
export function command(
  client: Client,
  action: GameAction,
  overrides: Record<string, unknown> = {},
) {
  return send(client, CLIENT_EVENTS.command, {
    roomId: client.joined!.roomId,
    commandId: randomUUID(),
    expectedRevision: client.room!.revision,
    command: action,
    ...overrides,
  });
}
