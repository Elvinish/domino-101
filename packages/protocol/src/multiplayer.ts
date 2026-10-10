import { z } from 'zod';
import type { VoiceClientEvents, VoiceServerEvents } from './voice.js';

export const CLIENT_EVENTS = {
  create: 'room:create',
  join: 'room:join',
  start: 'room:start',
  reconnect: 'room:reconnect',
  leave: 'room:leave',
  bots: 'room:bots',
  command: 'game:command',
  chat: 'chat:send',
  reaction: 'reaction:send',
} as const;
export const SERVER_EVENTS = {
  joined: 'room:joined',
  session: 'room:session',
  replaced: 'room:replaced',
  chatMessage: 'chat:message',
  chatHistory: 'chat:history',
  reaction: 'reaction:received',
  room: 'room:snapshot',
  game: 'game:snapshot',
  result: 'command:result',
  error: 'server:error',
} as const;
export const roomIdSchema = z.string().regex(/^[a-f0-9]{32}$/);
/** Human-entered codes normalize once; persisted IDs and outbound DTOs stay canonical. */
export const roomCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(roomIdSchema);
export const playerIdSchema = z.uuid();
export const seatSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export const teamSchema = z.enum(['A', 'B']);
export const tileSchema = z.enum([
  '0:0',
  '0:1',
  '0:2',
  '0:3',
  '0:4',
  '0:5',
  '0:6',
  '1:1',
  '1:2',
  '1:3',
  '1:4',
  '1:5',
  '1:6',
  '2:2',
  '2:3',
  '2:4',
  '2:5',
  '2:6',
  '3:3',
  '3:4',
  '3:5',
  '3:6',
  '4:4',
  '4:5',
  '4:6',
  '5:5',
  '5:6',
  '6:6',
]);
export const endSchema = z.enum(['start', 'left', 'right']);
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const revisionSchema = counter;
const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[^\p{Cc}\p{Cf}]+$/u);
export const createRoomSchema = z.strictObject({
  displayName: displayNameSchema,
});
export const joinRoomSchema = z.strictObject({
  roomId: roomCodeSchema,
  displayName: displayNameSchema,
});
export const reconnectSessionSchema = z.strictObject({
  roomId: roomIdSchema,
  playerId: playerIdSchema,
  reconnectToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const reconnectRoomSchema = reconnectSessionSchema;
export const roomSessionSchema = reconnectSessionSchema;
export const roomReplacedSchema = z.strictObject({});
export const leaveRoomSchema = z.strictObject({ roomId: roomIdSchema });
export const chatCommandSchema = z.strictObject({
  roomId: roomIdSchema,
  commandId: z.uuid(),
  // Shape validation happens here; trimmed/empty/length policy returns stable chat codes server-side.
  text: z.string(),
});
export const reactionSchema = z.enum([
  'thumbs-up',
  'clap',
  'laugh',
  'wow',
  'sad',
  'fire',
]);
export const reactionCommandSchema = z.strictObject({
  roomId: roomIdSchema,
  commandId: z.uuid(),
  reaction: z.string(),
});
const chatAuthorSchema = z.strictObject({
  playerId: playerIdSchema,
  displayName: displayNameSchema,
  seat: seatSchema,
});
export const chatMessageSchema = z.strictObject({
  messageId: z.uuid(),
  sender: chatAuthorSchema,
  text: z.string().min(1).max(500),
  timestamp: z.number().int().nonnegative(),
});
export const chatHistorySchema = z.strictObject({
  roomId: roomIdSchema,
  messages: z.array(chatMessageSchema).max(50),
});
export const reactionReceivedSchema = z.strictObject({
  reactionId: z.uuid(),
  sender: chatAuthorSchema,
  reaction: reactionSchema,
  timestamp: z.number().int().nonnegative(),
});
export const startRoomSchema = z.strictObject({ roomId: roomIdSchema });
export const botActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('add'), seat: seatSchema }),
  z.strictObject({ type: z.literal('remove'), seat: seatSchema }),
  z.strictObject({ type: z.literal('fill') }),
]);
export const roomBotsSchema = z.strictObject({
  roomId: roomIdSchema,
  expectedRevision: revisionSchema,
  action: botActionSchema,
});
export const playerKindSchema = z.enum(['human', 'bot']);
export const gameActionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('play'),
    tile: tileSchema,
    end: endSchema.optional(),
  }),
  z.strictObject({ type: z.literal('pass') }),
  z.strictObject({
    type: z.literal('select-starter'),
    selected: seatSchema.optional(),
  }),
  z.strictObject({ type: z.literal('next-round') }),
]);
export const gameCommandSchema = z.strictObject({
  roomId: roomIdSchema,
  commandId: z.uuid(),
  expectedRevision: revisionSchema,
  command: gameActionSchema,
});
export const errorCodeSchema = z.enum([
  'INVALID_PAYLOAD',
  'INVALID_SESSION',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ROOM_NOT_READY',
  'ROOM_ALREADY_STARTED',
  'ALREADY_ROOM_MEMBER',
  'NOT_ROOM_MEMBER',
  'NOT_HOST',
  'STALE_REVISION',
  'DUPLICATE_COMMAND_CONFLICT',
  'INVALID_GAME_COMMAND',
  'INVALID_PHASE',
  'NOT_YOUR_TURN',
  'TILE_NOT_IN_HAND',
  'ILLEGAL_TILE',
  'INVALID_END',
  'END_REQUIRED',
  'PASS_NOT_ALLOWED',
  'STARTER_NOT_ELIGIBLE',
  'SERVER_BUSY',
  'INTERNAL_ERROR',
  'CHAT_MESSAGE_EMPTY',
  'CHAT_MESSAGE_TOO_LONG',
  'CHAT_RATE_LIMITED',
  'INVALID_REACTION',
]);
export const commandResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    roomId: roomIdSchema,
    revision: revisionSchema,
    commandId: z.uuid().optional(),
  }),
  z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({ code: errorCodeSchema }),
    commandId: z.uuid().optional(),
  }),
]);
export const socialResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), commandId: z.uuid() }),
  z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({ code: errorCodeSchema }),
    commandId: z.uuid().optional(),
  }),
]);
export const serverErrorSchema = z.strictObject({
  event: z.enum([
    'room:create',
    'room:join',
    'room:start',
    'room:reconnect',
    'room:leave',
    'room:bots',
    'game:command',
    'chat:send',
    'reaction:send',
    'voice:join',
    'voice:ready',
    'voice:offer',
    'voice:answer',
    'voice:ice',
    'voice:leave',
    'voice:state',
  ]),
  code: errorCodeSchema,
  commandId: z.uuid().optional(),
});
export const roomJoinedSchema = z.strictObject({
  roomId: roomIdSchema,
  playerId: playerIdSchema,
  seat: seatSchema,
});
const playerSchema = z.strictObject({
  kind: playerKindSchema,
  playerId: playerIdSchema,
  displayName: displayNameSchema,
  seat: seatSchema,
  team: teamSchema,
  connected: z.boolean(),
});
export const roomSnapshotSchema = z.strictObject({
  roomId: roomIdSchema,
  hostId: playerIdSchema,
  revision: revisionSchema,
  lifecycle: z.enum(['lobby', 'playing', 'completed']),
  isPaused: z.boolean(),
  seats: z.tuple([
    playerSchema.nullable(),
    playerSchema.nullable(),
    playerSchema.nullable(),
    playerSchema.nullable(),
  ]),
});
const scoreSchema = z.strictObject({
  isScoreOpened: z.boolean(),
  officialScore: counter,
  pendingOpeningPoints: counter,
});
const scoresSchema = z.strictObject({
  teams: z.strictObject({ A: scoreSchema, B: scoreSchema }),
  sekaBank: counter,
});
const pip = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);
const boardSchema = z
  .array(z.strictObject({ tile: tileSchema, left: pip, right: pip }))
  .max(28);
const countsSchema = z.tuple([
  counter.max(7),
  counter.max(7),
  counter.max(7),
  counter.max(7),
]);
const totalsSchema = z.strictObject({ A: counter, B: counter });
const resultSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('normal'),
    winner: teamSchema,
    normalPoints: counter,
    remainingPoints: totalsSchema,
  }),
  z.strictObject({
    kind: z.literal('baglanma'),
    winner: teamSchema,
    normalPoints: counter,
    remainingPoints: totalsSchema,
  }),
  z.strictObject({ kind: z.literal('seka'), remainingPoints: totalsSchema }),
]);
export const publicGameSchema = z
  .strictObject({
    phase: z.enum([
      'playing',
      'round-ended',
      'starter-selection',
      'match-finished',
    ]),
    roundNumber: counter.min(1),
    board: boardSchema,
    openEnds: z.strictObject({ left: pip, right: pip }).nullable(),
    turn: seatSchema.nullable(),
    starter: seatSchema.nullable(),
    eligibleTeam: teamSchema.nullable(),
    handCounts: countsSchema,
    // Absent until the server commits an ended round. Indexed by absolute seat.
    revealedHands: z
      .tuple([
        z.array(tileSchema).max(7),
        z.array(tileSchema).max(7),
        z.array(tileSchema).max(7),
        z.array(tileSchema).max(7),
      ])
      .optional(),
    score: scoresSchema,
    result: resultSchema.nullable(),
    awardedPoints: counter.nullable(),
    winner: teamSchema.nullable(),
  })
  .superRefine((game, context) => {
    const ended =
      game.phase === 'round-ended' || game.phase === 'match-finished';
    if (
      game.revealedHands &&
      (!ended ||
        game.revealedHands.some(
          (hand, seat) => hand.length !== game.handCounts[seat],
        ))
    )
      context.addIssue({
        code: 'custom',
        message: 'Reveal requires an ended round and matching seat counts',
        path: ['revealedHands'],
      });
  });
export const gameSnapshotSchema = z.strictObject({
  roomId: roomIdSchema,
  matchId: z.uuid(),
  revision: revisionSchema,
  playerId: playerIdSchema,
  seat: seatSchema,
  public: publicGameSchema,
  private: z.strictObject({
    hand: z.array(tileSchema).max(7),
    legalActions: z.array(gameActionSchema).max(28),
  }),
});
export type ReconnectSession = z.infer<typeof reconnectSessionSchema>;
export type LeaveRoom = z.infer<typeof leaveRoomSchema>;
export type ChatCommand = z.infer<typeof chatCommandSchema>;
export type ReactionCommand = z.infer<typeof reactionCommandSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatHistory = z.infer<typeof chatHistorySchema>;
export type ReactionReceived = z.infer<typeof reactionReceivedSchema>;
export type CreateRoom = z.infer<typeof createRoomSchema>;
export type JoinRoom = z.infer<typeof joinRoomSchema>;
export type StartRoom = z.infer<typeof startRoomSchema>;
export type RoomBots = z.infer<typeof roomBotsSchema>;
export type BotAction = z.infer<typeof botActionSchema>;
export type PlayerKind = z.infer<typeof playerKindSchema>;
export type GameAction = z.infer<typeof gameActionSchema>;
export type GameCommand = z.infer<typeof gameCommandSchema>;
export type CommandResult = z.infer<typeof commandResultSchema>;
export type SocialResult = z.infer<typeof socialResultSchema>;
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type RoomJoined = z.infer<typeof roomJoinedSchema>;
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;
export type GameSnapshot = z.infer<typeof gameSnapshotSchema>;
export type PublicGame = z.infer<typeof publicGameSchema>;
export type ServerError = z.infer<typeof serverErrorSchema>;
export type Ack = (result: CommandResult) => void;
export type SocialAck = (result: SocialResult) => void;
export interface ClientToServerEvents extends VoiceClientEvents {
  'room:bots': (payload: RoomBots, ack?: Ack) => void;
  'room:reconnect': (payload: ReconnectSession, ack?: Ack) => void;
  'room:leave': (payload: LeaveRoom, ack?: Ack) => void;
  'room:create': (payload: CreateRoom, ack?: Ack) => void;
  'room:join': (payload: JoinRoom, ack?: Ack) => void;
  'room:start': (payload: StartRoom, ack?: Ack) => void;
  'game:command': (payload: GameCommand, ack?: Ack) => void;
  'chat:send': (payload: ChatCommand, ack?: SocialAck) => void;
  'reaction:send': (payload: ReactionCommand, ack?: SocialAck) => void;
}
export interface ServerToClientEvents extends VoiceServerEvents {
  'room:session': (payload: ReconnectSession) => void;
  'room:replaced': (payload: z.infer<typeof roomReplacedSchema>) => void;
  'chat:message': (payload: ChatMessage) => void;
  'chat:history': (payload: ChatHistory) => void;
  'reaction:received': (payload: ReactionReceived) => void;
  'room:joined': (payload: RoomJoined) => void;
  'room:snapshot': (payload: RoomSnapshot) => void;
  'game:snapshot': (payload: GameSnapshot) => void;
  'command:result': (payload: CommandResult) => void;
  'server:error': (payload: ServerError) => void;
}
