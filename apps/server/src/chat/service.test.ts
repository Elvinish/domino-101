import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Connection, RoomMember } from '../rooms/types.js';
import type { ChatHistory, ChatMessage } from '@domino/protocol';
import { ChatService } from './service.js';

const roomId = 'a'.repeat(32);
function makeConnection(
  id = randomUUID(),
): Connection & { connected: boolean } {
  const connection = {
    id,
    connected: true,
    isConnected: () => connection.connected,
  };
  return connection;
}
function setup() {
  const connection = makeConnection();
  const member: RoomMember = {
    roomId,
    playerId: randomUUID(),
    displayName: 'Guest',
    seat: 1,
  };
  const messages: ChatMessage[] = [];
  const histories: ChatHistory[] = [];
  let now = 1_000;
  const service = new ChatService({
    resolveMember: (candidate, target) =>
      candidate === connection && target === roomId && connection.connected
        ? member
        : null,
    recipients: () => [connection.id],
    runRoom: async (_room, operation) => operation(),
    onMessage: (_ids, message) => messages.push(message),
    onHistory: (_id, history) => histories.push(history),
    onReaction: () => {},
    now: () => now,
  });
  return {
    service,
    connection,
    member,
    messages,
    histories,
    advance: (value: number) => (now += value),
  };
}
const command = (text: string) => ({ roomId, commandId: randomUUID(), text });
describe('chat service authority and limits', () => {
  it('trims messages, preserves plain text, and caps history at 50', async () => {
    const { service, connection, messages, histories, advance } = setup();
    const first = command('  <b>hello</b>  ');
    expect(await service.send(connection, first)).toMatchObject({
      ok: true,
      commandId: first.commandId,
    });
    expect(messages[0]!.text).toBe('<b>hello</b>');
    advance(10_000);
    for (let index = 0; index < 55; index++) {
      expect((await service.send(connection, command(`m${index}`))).ok).toBe(
        true,
      );
      if (index % 5 === 4) advance(10_000);
    }
    await service.historyFor(connection, roomId);
    expect(histories[0]!.messages).toHaveLength(50);
    expect(histories[0]!.messages[0]!.text).toBe('m5');
  });
  it('rejects empty/oversize text and enforces five messages per ten seconds', async () => {
    const fixture = setup();
    expect(
      await fixture.service.send(fixture.connection, command('   ')),
    ).toMatchObject({ ok: false, error: { code: 'CHAT_MESSAGE_EMPTY' } });
    expect(
      await fixture.service.send(fixture.connection, command('x'.repeat(501))),
    ).toMatchObject({ ok: false, error: { code: 'CHAT_MESSAGE_TOO_LONG' } });
    for (let index = 0; index < 5; index++)
      expect(
        (await fixture.service.send(fixture.connection, command(`${index}`)))
          .ok,
      ).toBe(true);
    expect(
      await fixture.service.send(fixture.connection, command('six')),
    ).toMatchObject({ ok: false, error: { code: 'CHAT_RATE_LIMITED' } });
    fixture.advance(10_000);
    expect(
      (await fixture.service.send(fixture.connection, command('after'))).ok,
    ).toBe(true);
  });
  it('replays idempotent commands and rejects stale sockets', async () => {
    const fixture = setup();
    const payload = command('once');
    const first = await fixture.service.send(fixture.connection, payload);
    expect(await fixture.service.send(fixture.connection, payload)).toEqual(
      first,
    );
    fixture.connection.connected = false;
    expect(
      await fixture.service.send(fixture.connection, command('late')),
    ).toMatchObject({ ok: false, error: { code: 'NOT_ROOM_MEMBER' } });
  });
});
