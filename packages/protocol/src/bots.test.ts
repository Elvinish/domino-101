import { expect, it } from 'vitest';
import { roomBotsSchema, roomSnapshotSchema } from './index.js';
const base = { roomId: 'a'.repeat(32), expectedRevision: 1 };
it.each([
  { type: 'add', seat: 1 },
  { type: 'remove', seat: 3 },
  { type: 'fill' },
])('accepts bounded lobby bot intent %j', (action) => {
  expect(roomBotsSchema.safeParse({ ...base, action }).success).toBe(true);
});
it.each([
  { ...base, action: { type: 'add', seat: 4 } },
  { ...base, action: { type: 'add', seat: 1, playerId: 'spoof' } },
  { ...base, action: { type: 'add', seat: 1, team: 'A' } },
  { ...base, action: { type: 'fill', displayName: 'spoof' } },
  { ...base, action: { type: 'fill' }, senderId: 'spoof' },
  { ...base, expectedRevision: -1, action: { type: 'fill' } },
])('rejects invalid/spoofed bot payload %#', (payload) => {
  expect(roomBotsSchema.safeParse(payload).success).toBe(false);
});
it('requires an explicit public player kind without accepting bot internals', () => {
  const player = {
    kind: 'bot',
    playerId: '00000000-0000-4000-8000-000000000001',
    displayName: 'Domino 2',
    seat: 1,
    team: 'B',
    connected: false,
  };
  const room = {
    roomId: base.roomId,
    hostId: player.playerId,
    revision: 2,
    lifecycle: 'lobby',
    isPaused: false,
    seats: [null, player, null, null],
  };
  expect(roomSnapshotSchema.safeParse(room).success).toBe(true);
  expect(
    roomSnapshotSchema.safeParse({
      ...room,
      seats: [null, { ...player, tokenHash: 'secret' }, null, null],
    }).success,
  ).toBe(false);
});
