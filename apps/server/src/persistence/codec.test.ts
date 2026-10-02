import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createDeck,
  createMatch,
  getLegalMoves,
  passTurn,
  playTile,
  selectStarter,
  startNextRound,
} from '@domino/game-engine';
import { shuffleDeck } from '@domino/bot-player';
import type { LegalMove, MatchState } from '@domino/game-engine';
import {
  parsePersistedChat,
  parsePersistedRoom,
  serializeRoom,
} from './codec.js';
import { emptyChat } from './types.js';
import { RoomService } from '../rooms/service.js';
import type { Room } from '../rooms/types.js';

const services: RoomService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});
async function roomFixture(): Promise<Room> {
  let room!: Room;
  const service = new RoomService({
    makeDeck: createDeck,
    onUpdate: (value) => {
      room = value;
    },
    onJoined: () => {},
  });
  services.push(service);
  const clients = Array.from({ length: 4 }, () => ({
    id: randomUUID(),
    isConnected: () => true,
  }));
  service.create(clients[0]!, { displayName: 'Owner' });
  for (let seat = 1; seat < 4; seat++)
    await service.join(clients[seat]!, {
      roomId: room.id,
      displayName: `Player ${seat}`,
    });
  return room;
}
describe('strict versioned persistence boundaries', () => {
  it('serializes explicit fields, hashes only, and omits queues/socket identities', async () => {
    const room = await roomFixture();
    const value = serializeRoom(room);
    expect(value.persistenceVersion).toBe(1);
    expect(
      value.players.every((player) => /^[a-f0-9]{64}$/.test(player.tokenHash!)),
    ).toBe(true);
    const json = JSON.stringify(value);
    for (const key of ['reconnectToken', 'socketId', 'queue'])
      expect(json).not.toContain(key);
    expect(parsePersistedRoom(value)).toEqual(value);
  });
  it('round-trips every engine phase through complete multi-round play without dropping private state', async () => {
    const room = await roomFixture();
    let seed = 41;
    const deck = () => {
      const result = shuffleDeck(seed);
      seed = result.state;
      return result.deck;
    };
    let state: MatchState = createMatch(deck());
    const seen = new Set<string>();
    for (let index = 0; index < 3000; index++) {
      room.lifecycle =
        state.phase === 'match-finished' ? 'completed' : 'playing';
      room.match = { id: room.match?.id ?? randomUUID(), state };
      const value = serializeRoom(room);
      expect(parsePersistedRoom(JSON.parse(JSON.stringify(value)))).toEqual(
        value,
      );
      seen.add(state.phase);
      if (state.phase === 'match-finished') break;
      if (state.phase === 'round-ended') state = startNextRound(state, deck());
      else if (state.phase === 'starter-selection') {
        const seat = state.eligibleTeam === 'A' ? 0 : 1;
        state = selectStarter(state, seat, seat);
      } else {
        const move: LegalMove | undefined = getLegalMoves(state, state.turn)[0];
        state = move
          ? playTile(state, state.turn, move.tile, move.end)
          : passTurn(state, state.turn);
      }
    }
    expect([...seen].sort()).toEqual([
      'match-finished',
      'playing',
      'round-ended',
      'starter-selection',
    ]);
  });
  it('rejects unsupported versions, incomplete membership, lifecycle mismatch and hidden extra fields', async () => {
    const value = serializeRoom(await roomFixture());
    for (const invalid of [
      { ...value, persistenceVersion: 2 },
      { ...value, revision: 0 },
      { ...value, socketId: 'old socket' },
      { ...value, players: [] },
      { ...value, hostId: randomUUID() },
      { ...value, players: [value.players[0], value.players[0]] },
      { ...value, matchId: randomUUID() },
      { ...value, lifecycle: 'completed' },
      {
        ...value,
        matchId: randomUUID(),
        matchState: createMatch(createDeck()),
      },
      {
        ...value,
        lifecycle: 'playing',
        matchId: randomUUID(),
        matchState: createMatch(createDeck()),
        players: value.players.slice(0, 3),
      },
    ])
      expect(() => parsePersistedRoom(invalid)).toThrow();
  });
  it('rejects structurally plausible engine states that violate tile conservation or score invariants', async () => {
    const value = serializeRoom(await roomFixture());
    const state = createMatch(createDeck());
    if (state.phase !== 'playing') throw new Error('Expected opening');
    const valid = {
      ...value,
      lifecycle: 'playing',
      matchId: randomUUID(),
      matchState: state,
    };
    expect(() => parsePersistedRoom(valid)).not.toThrow();
    expect(() =>
      parsePersistedRoom({
        ...valid,
        matchState: {
          ...state,
          round: {
            ...state.round,
            hands: [
              state.round.hands[0],
              state.round.hands[0],
              state.round.hands[2],
              state.round.hands[3],
            ],
          },
        },
      }),
    ).toThrow();
    expect(() =>
      parsePersistedRoom({
        ...valid,
        matchState: {
          ...state,
          score: {
            ...state.score,
            teams: {
              ...state.score.teams,
              A: {
                isScoreOpened: false,
                officialScore: 10,
                pendingOpeningPoints: 0,
              },
            },
          },
        },
      }),
    ).toThrow();
  });
  it('validates command digest, uniqueness, result scope and bounded history', async () => {
    const value = serializeRoom(await roomFixture());
    const commandId = randomUUID();
    const command = {
      commandId,
      fingerprint: 'a'.repeat(64),
      result: {
        ok: true,
        commandId,
        roomId: value.roomId,
        revision: value.revision,
      },
    };
    const withCommands = (commands: unknown[]) => ({
      ...value,
      players: value.players.map((player, index) =>
        index ? player : { ...player, commands },
      ),
    });
    expect(() => parsePersistedRoom(withCommands([command]))).not.toThrow();
    for (const commands of [
      [command, command],
      [{ ...command, fingerprint: 'raw payload' }],
      [
        {
          ...command,
          result: { ...command.result, revision: value.revision + 1 },
        },
      ],
      [{ ...command, result: { ...command.result, roomId: 'b'.repeat(32) } }],
      [{ ...command, result: { ...command.result, commandId: randomUUID() } }],
      Array.from({ length: 129 }, () => command),
    ])
      expect(() => parsePersistedRoom(withCommands(commands))).toThrow();
  });
  it('validates social version, bounded histories, sender identities and dedupe uniqueness', () => {
    const message = {
      messageId: randomUUID(),
      sender: { playerId: randomUUID(), displayName: 'User', seat: 0 },
      text: 'hello',
      timestamp: 1,
    };
    const commandId = randomUUID();
    const command = {
      kind: 'chat',
      playerId: message.sender.playerId,
      commandId,
      fingerprint: 'b'.repeat(64),
      result: { ok: true, commandId },
    };
    expect(
      parsePersistedChat({
        ...emptyChat(),
        messages: [message],
        commands: [command],
      }).messages,
    ).toEqual([message]);
    for (const invalid of [
      { ...emptyChat(), persistenceVersion: 2 },
      { ...emptyChat(), messages: Array.from({ length: 51 }, () => message) },
      { ...emptyChat(), messages: [message, message] },
      { ...emptyChat(), commands: [command, command] },
      {
        ...emptyChat(),
        rate: [{ playerId: message.sender.playerId, startedAt: 1, count: 6 }],
      },
    ])
      expect(() => parsePersistedChat(invalid)).toThrow();
  });
});
