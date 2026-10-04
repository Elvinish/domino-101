import { vi } from 'vitest';
import type { GameSnapshot, RoomSnapshot, RoomJoined } from '@domino/protocol';
import { MultiplayerClient } from '../multiplayer/client';
import type { SessionStore } from '../multiplayer/session';
import type { GameSocket } from '../multiplayer/client';

export const roomId = 'a'.repeat(32);
const ids = [0, 1, 2, 3].map(
  (seat) => `00000000-0000-4000-8000-00000000000${seat}`,
);
export const own: RoomJoined = { roomId, playerId: ids[0]!, seat: 0 };
export function roomFixture(): RoomSnapshot {
  return {
    roomId,
    hostId: ids[0]!,
    revision: 5,
    lifecycle: 'playing',
    isPaused: false,
    seats: [0, 1, 2, 3].map((seat) => ({
      playerId: ids[seat]!,
      kind: 'human',
      displayName: ['Ayla', 'Murad', 'Leyla', 'Rauf'][seat]!,
      seat,
      team: seat % 2 === 0 ? 'A' : 'B',
      connected: true,
    })) as RoomSnapshot['seats'],
  };
}
export function gameFixture(): GameSnapshot {
  return {
    roomId,
    matchId: '10000000-0000-4000-8000-000000000000',
    playerId: own.playerId,
    seat: 0,
    revision: 5,
    public: {
      phase: 'playing',
      roundNumber: 1,
      board: [],
      openEnds: null,
      turn: 0,
      starter: 0,
      eligibleTeam: null,
      handCounts: [7, 7, 7, 7],
      score: {
        teams: {
          A: {
            officialScore: 0,
            isScoreOpened: false,
            pendingOpeningPoints: 0,
          },
          B: {
            officialScore: 0,
            isScoreOpened: false,
            pendingOpeningPoints: 0,
          },
        },
        sekaBank: 0,
      },
      result: null,
      awardedPoints: null,
      winner: null,
    },
    private: {
      hand: ['1:1', '1:2', '0:0', '2:3', '3:3', '4:5', '5:6'],
      legalActions: [{ type: 'play', tile: '1:1', end: 'start' }],
    },
  };
}
export function fakeClient(sessions?: SessionStore) {
  const listeners = new Map<string, (value?: unknown) => void>();
  const managerListeners = new Map<string, () => void>();
  const socket = {
    io: {
      on: vi.fn((event: string, callback: () => void) =>
        managerListeners.set(event, callback),
      ),
      off: vi.fn((event: string) => managerListeners.delete(event)),
    },
    connected: false,
    on: vi.fn((event: string, callback: (value?: unknown) => void) => {
      listeners.set(event, callback);
    }),
    emit: vi.fn(),
    off: vi.fn((event: string) => listeners.delete(event)),
    connect: vi.fn(() => {
      socket.connected = true;
      listeners.get('connect')?.();
    }),
    disconnect: vi.fn(() => {
      socket.connected = false;
      listeners.get('disconnect')?.();
    }),
    removeAllListeners: vi.fn(() => listeners.clear()),
  };
  const client = new MultiplayerClient(
    () => socket as unknown as GameSocket,
    sessions,
  );
  return {
    client,
    socket,
    receive: (event: string, value?: unknown) => listeners.get(event)?.(value),
    managerReceive: (event: string) => managerListeners.get(event)?.(),
    ack: (value: unknown) => {
      const call = socket.emit.mock.calls.at(-1);
      (call?.[2] as (value: unknown) => void)(value);
    },
  };
}
