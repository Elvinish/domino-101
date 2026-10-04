import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RoomService } from '../rooms/service.js';
import { VoiceService } from './service.js';
import type { Room, Connection } from '../rooms/types.js';
import { TEST_AUDIO_SDP } from '../__tests__/voice-harness.js';

const services: RoomService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});
async function setup() {
  let room!: Room;
  const rooms = new RoomService({
    onUpdate: (value) => {
      room = value;
    },
    onJoined: () => {},
  });
  services.push(rooms);
  const connections = Array.from({ length: 2 }, () => {
    const value = {
      id: randomUUID(),
      connected: true,
      isConnected: () => value.connected,
    };
    return value;
  });
  rooms.create(connections[0]!, { displayName: 'Host' });
  await rooms.join(connections[1]!, { roomId: room.id, displayName: 'Guest' });
  const emitted = vi.fn();
  const voice = new VoiceService({
    connection: (id): Connection =>
      connections.find((value) => value.id === id) ?? {
        id,
        isConnected: () => false,
      },
    resolveMember: (connection, roomId) => rooms.chatMember(connection, roomId),
    recipients: (roomId) => rooms.chatRecipients(roomId),
    runRoom: (roomId, operation) => rooms.runRoom(roomId, operation),
    emit: emitted,
  });
  const joined = [];
  for (const connection of connections) {
    const result = await voice.join(connection, {
      roomId: room.id,
      attemptId: randomUUID(),
    });
    if (!result.ok || !result.voiceId) throw new Error('Join failed');
    joined.push(result.voiceId);
    await voice.state(
      connection,
      { roomId: room.id, voiceId: result.voiceId, muted: false },
      true,
    );
  }
  const payload = {
    roomId: room.id,
    voiceId: joined[0]!,
    targetId: room.seats[1]!.playerId,
    targetVoiceId: joined[1]!,
    sdp: TEST_AUDIO_SDP,
  };
  return { room, rooms, connections, voice, emitted, payload };
}
it('rechecks disconnected sender ownership after queued work, before forwarding', async () => {
  const f = await setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = f.room.queue.run(() => gate);
  const pending = expect(
    f.voice.signal(f.connections[0]!, 'voice:offer', f.payload),
  ).rejects.toMatchObject({ code: 'NOT_ROOM_MEMBER' });
  f.connections[0]!.connected = false;
  release();
  await held;
  await pending;
  expect(
    f.emitted.mock.calls.some(([, event]) => event === 'voice:offer'),
  ).toBe(false);
});
it('rejects a disconnected target even before queued room disconnect persistence finishes', async () => {
  const f = await setup();
  f.connections[1]!.connected = false;
  await expect(
    f.voice.signal(f.connections[0]!, 'voice:offer', f.payload),
  ).rejects.toMatchObject({ code: 'NOT_ROOM_MEMBER' });
  expect(
    f.emitted.mock.calls.some(([, event]) => event === 'voice:offer'),
  ).toBe(false);
});
