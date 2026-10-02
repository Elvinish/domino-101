import { describe, expect, it } from 'vitest';
import {
  reconnectRoomSchema,
  roomSessionSchema,
  roomReplacedSchema,
  leaveRoomSchema,
} from './multiplayer.js';
const session = {
  roomId: 'a'.repeat(32),
  playerId: '00000000-0000-4000-8000-000000000000',
  reconnectToken: 'A_-'.repeat(14) + 'A',
};
describe('strict reconnect contracts', () => {
  it('accepts the minimal private session and matching request', () => {
    expect(roomSessionSchema.parse(session)).toEqual(session);
    expect(reconnectRoomSchema.parse(session)).toEqual(session);
  });
  it.each([
    { ...session, reconnectToken: 'short' },
    { ...session, reconnectToken: 'x'.repeat(44) },
    { ...session, reconnectToken: '*'.repeat(43) },
    { ...session, seat: 0 },
    { roomId: session.roomId, playerId: session.playerId },
  ])('rejects malformed credentials and identity claims', (value) => {
    expect(reconnectRoomSchema.safeParse(value).success).toBe(false);
  });
  it('never adds credentials to leave or replacement notifications', () => {
    expect(leaveRoomSchema.safeParse(session).success).toBe(false);
    expect(roomReplacedSchema.safeParse(session).success).toBe(false);
    expect(roomReplacedSchema.parse({})).toEqual({});
  });
});
