import { sql } from 'drizzle-orm';
import {
  bigint,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  index,
  check,
  foreignKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const roomRecords = pgTable(
  'room_records',
  {
    roomId: varchar('room_id', { length: 32 }).primaryKey(),
    hostId: uuid('host_id').notNull(),
    revision: bigint('revision', { mode: 'number' }).notNull(),
    lifecycle: varchar('lifecycle', { length: 16 }).notNull(),
    matchId: uuid('match_id'),
    matchState: jsonb('match_state').$type<unknown>(),
    persistenceVersion: integer('persistence_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    index('room_expiry_idx').on(table.expiresAt),
    check(
      'room_revision_check',
      sql`${table.revision} >= 1 and ${table.revision} <= 9007199254740991`,
    ),
    check(
      'room_lifecycle_check',
      sql`${table.lifecycle} in ('lobby', 'playing', 'completed')`,
    ),
  ],
);

export const roomPlayers = pgTable(
  'room_players',
  {
    roomId: varchar('room_id', { length: 32 })
      .notNull()
      .references(() => roomRecords.roomId, { onDelete: 'cascade' }),
    playerId: uuid('player_id').notNull(),
    kind: varchar('kind', { length: 5 }).notNull().default('human'),
    displayName: varchar('display_name', { length: 32 }).notNull(),
    seat: integer('seat').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.playerId] }),
    uniqueIndex('room_player_seat_idx').on(table.roomId, table.seat),
    check('player_seat_check', sql`${table.seat} between 0 and 3`),
    check('player_kind_check', sql`${table.kind} in ('human', 'bot')`),
    check(
      'bot_token_check',
      sql`${table.kind} <> 'bot' or ${table.tokenHash} is null`,
    ),
    check(
      'player_token_hash_check',
      sql`${table.tokenHash} is null or ${table.tokenHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

export const roomCommands = pgTable(
  'room_commands',
  {
    roomId: varchar('room_id', { length: 32 }).notNull(),
    playerId: uuid('player_id').notNull(),
    commandId: uuid('command_id').notNull(),
    position: integer('position').notNull(),
    fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
    result: jsonb('result').$type<unknown>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.playerId, table.commandId] }),
    foreignKey({
      columns: [table.roomId, table.playerId],
      foreignColumns: [roomPlayers.roomId, roomPlayers.playerId],
    }).onDelete('cascade'),
    uniqueIndex('room_command_position_idx').on(
      table.roomId,
      table.playerId,
      table.position,
    ),
    check('command_position_check', sql`${table.position} between 0 and 127`),
    check(
      'command_fingerprint_check',
      sql`${table.fingerprint} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

/** Bounded, versioned social aggregate: history, deduplication and rate windows commit together. */
export const roomChat = pgTable('room_chat', {
  roomId: varchar('room_id', { length: 32 })
    .primaryKey()
    .references(() => roomRecords.roomId, { onDelete: 'cascade' }),
  state: jsonb('state').$type<unknown>().notNull(),
});
