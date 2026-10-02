import { describe, expect, it } from 'vitest';
import {
  createRoomSchema,
  gameCommandSchema,
  gameSnapshotSchema,
  joinRoomSchema,
  roomJoinedSchema,
  roomSnapshotSchema,
  serverErrorSchema,
} from './index.js';
const id = '00000000-0000-4000-8000-000000000001';
const roomId = 'a'.repeat(32);
describe('strict multiplayer trust-boundary schemas', () => {
  it('normalizes names and accepts a valid join/share code', () => {
    expect(createRoomSchema.parse({ displayName: '  Əli  ' })).toEqual({
      displayName: 'Əli',
    });
    expect(
      joinRoomSchema.safeParse({ roomId, displayName: 'Guest' }).success,
    ).toBe(true);
  });
  it.each([
    { type: 'pass' },
    { type: 'play', tile: '1:1' },
    { type: 'play', tile: '1:2', end: 'left' },
    { type: 'select-starter', selected: 2 },
    { type: 'next-round' },
  ])('accepts only the gameplay intent %j', (command) => {
    expect(
      gameCommandSchema.safeParse({
        roomId,
        commandId: id,
        expectedRevision: 5,
        command,
      }).success,
    ).toBe(true);
  });
  it.each([
    { type: 'pass', seat: 1 },
    { type: 'play', tile: '6:1' },
    { type: 'play', tile: '1:2', end: 'middle' },
    { type: 'select-starter', selected: 4 },
    { type: 'score', score: 101 },
    { type: 'next-round', deck: [] },
  ])('rejects injected identity/state and unknown commands %j', (command) => {
    expect(
      gameCommandSchema.safeParse({
        roomId,
        commandId: id,
        expectedRevision: 5,
        command,
      }).success,
    ).toBe(false);
  });
  it.each([-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid revision %s',
    (expectedRevision) => {
      expect(
        gameCommandSchema.safeParse({
          roomId,
          commandId: id,
          expectedRevision,
          command: { type: 'pass' },
        }).success,
      ).toBe(false);
    },
  );
  it('requires bounded canonical IDs and rejects extra envelope fields', () => {
    expect(
      gameCommandSchema.safeParse({
        roomId,
        commandId: 'x'.repeat(2000),
        expectedRevision: 1,
        command: { type: 'pass' },
      }).success,
    ).toBe(false);
    expect(
      gameCommandSchema.safeParse({
        roomId,
        commandId: id,
        expectedRevision: 1,
        command: { type: 'pass' },
        playerId: id,
      }).success,
    ).toBe(false);
    expect(
      joinRoomSchema.safeParse({ roomId: 'guess', displayName: 'Guest' })
        .success,
    ).toBe(false);
  });
  it('refuses hidden/internal fields on all non-game outbound shapes', () => {
    expect(
      roomJoinedSchema.safeParse({
        roomId,
        playerId: id,
        seat: 0,
        hand: ['1:1'],
      }).success,
    ).toBe(false);
    expect(
      serverErrorSchema.safeParse({
        event: 'game:command',
        code: 'INVALID_PHASE',
        state: { hands: [] },
      }).success,
    ).toBe(false);
    expect(
      roomSnapshotSchema.safeParse({
        roomId,
        hostId: id,
        revision: 1,
        lifecycle: 'lobby',
        isPaused: false,
        seats: [null, null, null, null],
        match: { hands: [] },
      }).success,
    ).toBe(false);
    expect(
      gameSnapshotSchema.safeParse({
        roomId,
        matchId: id,
        revision: 1,
        playerId: id,
        seat: 0,
        hands: [['1:1']],
      }).success,
    ).toBe(false);
  });
});
