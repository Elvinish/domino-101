import { assertMatchState } from '@domino/game-engine';
import type { MatchState } from '@domino/game-engine';
import {
  chatMessageSchema,
  commandResultSchema,
  playerIdSchema,
  createRoomSchema,
  seatSchema,
  teamSchema,
  roomIdSchema,
  socialResultSchema,
  tileSchema,
} from '@domino/protocol';
import type { CommandResult } from '@domino/protocol';
import { z } from 'zod';
import { PERSISTENCE_VERSION, COMMAND_HISTORY_LIMIT } from './types.js';
import type { PersistedRoom, PersistedChat } from './types.js';
import type { Player, Room } from '../rooms/types.js';

const pip = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);
const seat = seatSchema;
const team = teamSchema;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const hands = z.tuple([
  z.array(tileSchema).max(7),
  z.array(tileSchema).max(7),
  z.array(tileSchema).max(7),
  z.array(tileSchema).max(7),
]);
const board = z
  .array(z.strictObject({ tile: tileSchema, left: pip, right: pip }))
  .max(28);
const scoreValue = z.discriminatedUnion('isScoreOpened', [
  z.strictObject({
    isScoreOpened: z.literal(false),
    officialScore: z.literal(0),
    pendingOpeningPoints: z.number().int().nonnegative(),
  }),
  z.strictObject({
    isScoreOpened: z.literal(true),
    officialScore: z.number().int().nonnegative(),
    pendingOpeningPoints: z.literal(0),
  }),
]);
const score = z.strictObject({
  teams: z.strictObject({ A: scoreValue, B: scoreValue }),
  sekaBank: z.number().int().nonnegative(),
});
const roundResult = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.enum(['normal', 'baglanma']),
    winner: team,
    normalPoints: z.number().int().nonnegative(),
    remainingPoints: z.strictObject({
      A: z.number().int().nonnegative(),
      B: z.number().int().nonnegative(),
    }),
  }),
  z.strictObject({
    kind: z.literal('seka'),
    remainingPoints: z.strictObject({
      A: z.number().int().nonnegative(),
      B: z.number().int().nonnegative(),
    }),
  }),
]);
const round = z.strictObject({
  number: z.number().int().min(1),
  starter: seat,
  opening: z.union([
    z.strictObject({ kind: z.literal('first'), requiredTile: tileSchema }),
    z.strictObject({ kind: z.literal('later') }),
  ]),
  hands,
  board,
});
const matchStateSchema = z.discriminatedUnion('phase', [
  z.strictObject({ phase: z.literal('playing'), score, round, turn: seat }),
  z.strictObject({
    phase: z.literal('round-ended'),
    score,
    round,
    result: roundResult,
    awardedPoints: z.number().int().nonnegative(),
  }),
  z.strictObject({
    phase: z.literal('starter-selection'),
    score,
    roundNumber: z.number().int().min(1),
    hands,
    eligibleTeam: team,
  }),
  z.strictObject({
    phase: z.literal('match-finished'),
    score,
    round,
    result: z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.enum(['normal', 'baglanma']),
        winner: team,
        normalPoints: z.number().int().nonnegative(),
        remainingPoints: z.strictObject({
          A: z.number().int().nonnegative(),
          B: z.number().int().nonnegative(),
        }),
      }),
    ]),
    awardedPoints: z.number().int().nonnegative(),
    winner: team,
  }),
]);
const commandSchema = z.strictObject({
  commandId: z.uuid(),
  fingerprint: digest,
  result: commandResultSchema,
});
const playerSchema = z.strictObject({
  playerId: playerIdSchema,
  displayName: createRoomSchema.shape.displayName,
  seat,
  tokenHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  commands: z.array(commandSchema).max(COMMAND_HISTORY_LIMIT),
});
export const persistedRoomSchema = z.strictObject({
  persistenceVersion: z.literal(PERSISTENCE_VERSION),
  roomId: roomIdSchema,
  hostId: playerIdSchema,
  revision: z.number().int().positive(),
  lifecycle: z.enum(['lobby', 'playing', 'completed']),
  matchId: z.uuid().nullable(),
  matchState: matchStateSchema.nullable(),
  players: z.array(playerSchema).min(1).max(4),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative().nullable(),
});

export function serializeRoom(room: Room): PersistedRoom {
  return parsePersistedRoom({
    persistenceVersion: PERSISTENCE_VERSION,
    roomId: room.id,
    hostId: room.hostId,
    revision: room.revision,
    lifecycle: room.lifecycle,
    matchId: room.match?.id ?? null,
    matchState: room.match?.state ?? null,
    players: room.seats.flatMap((player) =>
      player
        ? [
            {
              playerId: player.playerId,
              displayName: player.displayName,
              seat: player.seat,
              tokenHash: player.tokenHash,
              commands: [...player.commands].map(([commandId, value]) => ({
                commandId,
                fingerprint: value.fingerprint,
                result: value.result,
              })),
            },
          ]
        : [],
    ),
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    expiresAt: room.expiresAt,
  });
}

export function validateMatchState(value: unknown): MatchState {
  const parsed = matchStateSchema.parse(value);
  assertMatchState(parsed);
  return parsed;
}

export function parsePersistedRoom(value: unknown): PersistedRoom {
  const parsed = persistedRoomSchema.parse(value);
  if ((parsed.matchId === null) !== (parsed.matchState === null))
    throw new Error('Persisted room match identity is incomplete');
  if (parsed.lifecycle === 'lobby' && parsed.matchState !== null)
    throw new Error('Lobby room contains match state');
  if (
    parsed.lifecycle !== 'lobby' &&
    (!parsed.matchState || parsed.players.length !== 4)
  )
    throw new Error('Incomplete persisted match');
  if (
    (parsed.lifecycle === 'completed') !==
    (parsed.matchState?.phase === 'match-finished')
  )
    throw new Error('Inconsistent persisted lifecycle');
  if (
    new Set(parsed.players.map((player) => player.seat)).size !==
      parsed.players.length ||
    new Set(parsed.players.map((player) => player.playerId)).size !==
      parsed.players.length ||
    !parsed.players.some((player) => player.playerId === parsed.hostId)
  )
    throw new Error('Invalid persisted memberships');
  for (const player of parsed.players) {
    if (
      new Set(player.commands.map((entry) => entry.commandId)).size !==
      player.commands.length
    )
      throw new Error('Duplicate persisted command');
    for (const entry of player.commands)
      if (
        entry.result.commandId !== entry.commandId ||
        (entry.result.ok &&
          (entry.result.roomId !== parsed.roomId ||
            entry.result.revision > parsed.revision))
      )
        throw new Error('Invalid persisted command result');
  }
  if (parsed.updatedAt < parsed.createdAt)
    throw new Error('Invalid persisted timestamps');
  return {
    ...parsed,
    matchState: parsed.matchState
      ? validateMatchState(parsed.matchState)
      : null,
  };
}

const chatCommandSchema = z.strictObject({
  kind: z.enum(['chat', 'reaction']),
  playerId: playerIdSchema,
  commandId: z.uuid(),
  fingerprint: digest,
  result: socialResultSchema,
});
export function parsePersistedChat(value: unknown): PersistedChat {
  const parsed = z
    .strictObject({
      persistenceVersion: z.literal(PERSISTENCE_VERSION),
      messages: z.array(chatMessageSchema).max(50),
      commands: z.array(chatCommandSchema).max(COMMAND_HISTORY_LIMIT * 8),
      rate: z
        .array(
          z.strictObject({
            playerId: playerIdSchema,
            startedAt: z.number().int().nonnegative(),
            count: z.number().int().min(1).max(5),
          }),
        )
        .max(4),
    })
    .parse(value);
  const counts = new Map<string, number>();
  const ids = new Set<string>();
  for (const entry of parsed.commands) {
    const key = entry.kind + ':' + entry.playerId;
    const id = key + ':' + entry.commandId;
    const count = (counts.get(key) ?? 0) + 1;
    if (
      count > COMMAND_HISTORY_LIMIT ||
      ids.has(id) ||
      entry.result.commandId !== entry.commandId
    )
      throw new Error('Invalid persisted social command');
    ids.add(id);
    counts.set(key, count);
  }
  if (
    new Set(parsed.messages.map((message) => message.messageId)).size !==
      parsed.messages.length ||
    new Set(parsed.rate.map((rate) => rate.playerId)).size !==
      parsed.rate.length
  )
    throw new Error('Duplicate persisted chat data');
  return parsed;
}

export function playerFromPersisted(
  value: PersistedRoom['players'][number],
): Player {
  const commands = new Map<
    string,
    { fingerprint: string; result: CommandResult }
  >();
  for (const command of value.commands)
    commands.set(command.commandId, {
      fingerprint: command.fingerprint,
      result: command.result,
    });
  return {
    playerId: value.playerId,
    displayName: value.displayName,
    seat: value.seat,
    socketId: null,
    tokenHash: value.tokenHash,
    commands,
  };
}
