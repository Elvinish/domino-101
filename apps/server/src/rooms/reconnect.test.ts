import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import type { ReconnectSession } from '@domino/protocol';
import { RoomService } from './service.js';
import type { Room } from './types.js';

const services: RoomService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  vi.useRealTimers();
});
const connection = () => ({ id: randomUUID(), isConnected: () => true });
function setup() {
  let room!: Room;
  const sessions: ReconnectSession[] = [];
  const service = new RoomService({
    onUpdate: (value) => {
      room = value;
    },
    onJoined: () => {},
    onSession: (_, value) => {
      sessions.push(value);
    },
    offlineRoomTtlMs: 1000,
  });
  services.push(service);
  const owner = connection();
  service.create(owner, { displayName: 'Owner' });
  return { service, owner, sessions, room: () => room };
}
describe('serialized reconnect lifecycle', () => {
  it('stores SHA-256 only; bot memberships receive no session or token hash', async () => {
    const f = setup();
    const session = f.sessions[0]!;
    expect(f.room().seats[0]!.tokenHash).toBe(
      createHash('sha256').update(session.reconnectToken).digest('hex'),
    );
    expect(JSON.stringify(f.room()).includes(session.reconnectToken)).toBe(
      false,
    );
    await f.service.manageBots(f.owner, {
      roomId: session.roomId,
      expectedRevision: f.room().revision,
      action: { type: 'add', seat: 1 },
    });
    expect(f.sessions).toHaveLength(1);
    expect(f.room().seats[1]!.tokenHash).toBeNull();
    expect(f.room().seats[1]!.socketId).toBeNull();
    expect(f.room().seats[1]!.kind).toBe('bot');
  });
  it('serializes simultaneous replacements and a queued old disconnect', async () => {
    const f = setup();
    const a = connection(),
      b = connection();
    await Promise.all([
      f.service.reconnect(a, f.sessions[0]!),
      f.service.reconnect(b, f.sessions[0]!),
      f.service.disconnect(f.owner.id),
    ]);
    expect(f.room().seats[0]!.socketId).toBe(b.id);
    expect(f.room().revision).toBe(1);
    await expect(
      f.service.start(a, { roomId: f.room().id }),
    ).rejects.toMatchObject({ code: 'NOT_ROOM_MEMBER' });
  });
  it('rejects a stale command queued behind replacement', async () => {
    const f = setup();
    let release!: () => void;
    const blocked = f.room().queue.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();
    const replacement = f.service.reconnect(connection(), f.sessions[0]!);
    const command = f.service.game(f.owner, {
      roomId: f.room().id,
      commandId: randomUUID(),
      expectedRevision: 1,
      command: { type: 'pass' },
    });
    const rejected = expect(command).rejects.toMatchObject({
      code: 'NOT_ROOM_MEMBER',
    });
    release();
    await blocked;
    await replacement;
    await rejected;
  });
  it('expires all-offline rooms but cancels expiry when an owner returns', async () => {
    vi.useFakeTimers();
    const f = setup();
    await f.service.disconnect(f.owner.id);
    await vi.advanceTimersByTimeAsync(999);
    const fresh = connection();
    await f.service.reconnect(fresh, f.sessions[0]!);
    await vi.advanceTimersByTimeAsync(1001);
    expect(f.room().seats[0]!.socketId).toBe(fresh.id);
    await f.service.disconnect(fresh.id);
    await vi.advanceTimersByTimeAsync(1001);
    expect(() => f.service.reconnect(connection(), f.sessions[0]!)).toThrow(
      'INVALID_SESSION',
    );
  });
  it('rejects sessions after the in-memory server closes', async () => {
    const f = setup();
    await f.service.close();
    expect(() => f.service.reconnect(connection(), f.sessions[0]!)).toThrow(
      'INVALID_SESSION',
    );
  });
});
