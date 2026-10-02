import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  chatHistorySchema,
  chatMessageSchema,
  reactionReceivedSchema,
} from '@domino/protocol';
import { harness, sendSocial, until } from './harness.js';

const opened: Awaited<ReturnType<typeof harness>>[] = [];
afterEach(async () =>
  Promise.all(opened.splice(0).map((value) => value.close())),
);
describe('room chat signaling isolation', () => {
  it('broadcasts server-authored text only to current room members', async () => {
    const h = await harness();
    opened.push(h);
    const first = await h.room();
    const second = await h.room();
    const payload = {
      roomId: first.roomId,
      commandId: randomUUID(),
      text: 'hello <b>world</b>',
    };
    expect(
      await sendSocial(first.members[0]!, CLIENT_EVENTS.chat, payload),
    ).toEqual({ ok: true, commandId: payload.commandId });
    await until(() =>
      first.members.every((client) =>
        client.chat.some((message) => message.text.includes('<b>world</b>')),
      ),
    );
    expect(second.members.every((client) => client.chat.length === 0)).toBe(
      true,
    );
    const message = first.members[1]!.chat.at(-1)!;
    expect(chatMessageSchema.parse(message).sender.playerId).toBe(
      first.members[0]!.joined!.playerId,
    );
    expect(JSON.stringify(message)).not.toContain('reconnectToken');
  });
  it('rejects injected identity, invalid reactions, and stale sockets', async () => {
    const h = await harness();
    opened.push(h);
    const { members, roomId } = await h.room();
    const spoof = await sendSocial(members[0]!, CLIENT_EVENTS.chat, {
      roomId,
      commandId: randomUUID(),
      text: 'hi',
      playerId: members[1]!.joined!.playerId,
    });
    expect(spoof).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
    expect(
      await sendSocial(members[0]!, CLIENT_EVENTS.reaction, {
        roomId,
        commandId: randomUUID(),
        reaction: 'script',
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REACTION' } });
    const session = members[0]!.session!;
    const replacement = await h.connect();
    expect(
      await h.app.inject({ method: 'GET', url: '/health' }),
    ).toHaveProperty('statusCode', 200);
    replacement.socket.emit(CLIENT_EVENTS.reconnect, session, () => undefined);
    await until(
      () =>
        members[0]!.events.some(
          (event) => event.event === SERVER_EVENTS.replaced,
        ) && replacement.joined?.roomId === roomId,
    );
    expect(
      await sendSocial(members[0]!, CLIENT_EVENTS.chat, {
        roomId,
        commandId: randomUUID(),
        text: 'stale',
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_ROOM_MEMBER' } });
    expect(replacement.joined?.roomId).toBe(roomId);
  });
  it('sends bounded history on room membership and typed reactions to all members', async () => {
    const h = await harness();
    opened.push(h);
    const { members, roomId } = await h.room();
    expect(members.every((client) => client.history?.roomId === roomId)).toBe(
      true,
    );
    const result = await sendSocial(members[2]!, CLIENT_EVENTS.reaction, {
      roomId,
      commandId: randomUUID(),
      reaction: 'fire',
    });
    expect(result.ok).toBe(true);
    await until(() => members.every((client) => client.reactions.length > 0));
    expect(
      reactionReceivedSchema.safeParse(members[0]!.reactions[0]).success,
    ).toBe(true);
    expect(chatHistorySchema.safeParse(members[0]!.history).success).toBe(true);
  });
});
