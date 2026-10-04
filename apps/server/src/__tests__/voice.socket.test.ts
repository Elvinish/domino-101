import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { voiceServerSchemas } from '@domino/protocol';
import { harness, send, sendSocial, until } from './harness.js';
import {
  joinVoice,
  sendVoice,
  TEST_AUDIO_SDP,
  TEST_ICE,
} from './voice-harness.js';

const opened: Awaited<ReturnType<typeof harness>>[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((server) => server.close()));
  vi.restoreAllMocks();
});
async function setup() {
  const server = await harness();
  opened.push(server);
  return server;
}
describe('ephemeral room voice signaling', () => {
  it('forwards offers, answers and ICE only to the intended same-room peer, deriving sender identity', async () => {
    const h = await setup();
    const { members, roomId } = await h.started();
    const other = await h.room();
    const voices = await Promise.all(members.map(joinVoice));
    const revision = members[0]!.room!.revision;
    const target = {
      roomId,
      voiceId: voices[0]!.voiceId,
      targetId: members[1]!.joined!.playerId,
      targetVoiceId: voices[1]!.voiceId,
    };
    expect(
      await sendVoice(members[0]!, 'voice:offer', {
        ...target,
        sdp: TEST_AUDIO_SDP,
      }),
    ).toEqual({ ok: true });
    expect(
      await sendVoice(members[1]!, 'voice:answer', {
        roomId,
        voiceId: voices[1]!.voiceId,
        targetId: members[0]!.joined!.playerId,
        targetVoiceId: voices[0]!.voiceId,
        sdp: TEST_AUDIO_SDP,
      }),
    ).toEqual({ ok: true });
    expect(
      await sendVoice(members[0]!, 'voice:ice', {
        ...target,
        candidate: TEST_ICE,
      }),
    ).toEqual({ ok: true });
    await until(() =>
      members[1]!.events.some((event) => event.event === 'voice:ice'),
    );
    const offered = members[1]!.events.find(
      (event) => event.event === 'voice:offer',
    )!.payload;
    expect(offered).toEqual({
      roomId,
      senderId: members[0]!.joined!.playerId,
      senderVoiceId: voices[0]!.voiceId,
      targetVoiceId: voices[1]!.voiceId,
      sdp: TEST_AUDIO_SDP,
    });
    expect(
      members[0]!.events.filter((event) => event.event === 'voice:answer'),
    ).toHaveLength(1);
    for (const member of [...members.slice(2), ...other.members])
      expect(
        member.events.some((event) =>
          ['voice:offer', 'voice:answer', 'voice:ice'].includes(event.event),
        ),
      ).toBe(false);
    expect(members.every((member) => member.room!.revision === revision)).toBe(
      true,
    );
    for (const member of members)
      for (const event of member.events.filter((event) =>
        event.event.startsWith('voice:'),
      )) {
        expect(
          voiceServerSchemas[
            event.event as keyof typeof voiceServerSchemas
          ].safeParse(event.payload).success,
        ).toBe(true);
        const text = JSON.stringify(event.payload);
        for (const secret of [
          'reconnectToken',
          'tokenHash',
          'hands',
          'socketId',
          ...members.map((entry) => entry.session!.reconnectToken),
        ])
          expect(text).not.toContain(secret);
      }
  });
  it('rejects cross-room/nonexistent/self targets and a voice session that is not ready', async () => {
    const h = await setup();
    const { members, roomId } = await h.room();
    const other = await h.room();
    const from = await joinVoice(members[0]!);
    const foreign = await joinVoice(other.members[0]!);
    for (const targetId of [
      other.members[0]!.joined!.playerId,
      randomUUID(),
      members[0]!.joined!.playerId,
    ]) {
      expect(
        await sendVoice(members[0]!, 'voice:offer', {
          roomId,
          voiceId: from.voiceId,
          targetId,
          targetVoiceId: foreign.voiceId,
          sdp: TEST_AUDIO_SDP,
        }),
      ).toMatchObject({ ok: false, error: { code: 'NOT_ROOM_MEMBER' } });
    }
    expect(
      await sendVoice(other.members[0]!, 'voice:join', {
        roomId,
        attemptId: randomUUID(),
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_ROOM_MEMBER' } });
    const pending = await sendVoice(members[1]!, 'voice:join', {
      roomId,
      attemptId: randomUUID(),
    });
    if (!pending.ok) throw new Error('Join failed');
    expect(
      await sendVoice(members[0]!, 'voice:offer', {
        roomId,
        voiceId: from.voiceId,
        targetId: members[1]!.joined!.playerId,
        targetVoiceId: pending.voiceId,
        sdp: TEST_AUDIO_SDP,
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_PHASE' } });
  });
  it('rejects sender spoofing, malformed descriptions and media data without logging payloads', async () => {
    const h = await setup();
    const logs = [
      vi.spyOn(h.app.log, 'error'),
      vi.spyOn(h.app.log, 'warn'),
      vi.spyOn(h.app.log, 'info'),
    ];
    const { members, roomId } = await h.room();
    const a = await joinVoice(members[0]!),
      b = await joinVoice(members[1]!);
    const valid = {
      roomId,
      voiceId: a.voiceId,
      targetId: members[1]!.joined!.playerId,
      targetVoiceId: b.voiceId,
      sdp: TEST_AUDIO_SDP,
    };
    for (const payload of [
      { ...valid, senderId: members[1]!.joined!.playerId },
      { ...valid, seat: 1 },
      { ...valid, displayName: 'Spoof' },
      { ...valid, reconnectToken: members[0]!.session!.reconnectToken },
      { ...valid, sdp: 'private-invalid-sdp' },
      { ...valid, sdp: TEST_AUDIO_SDP + 'm=video 9 RTP/AVP 0\r\n' },
      { ...valid, audio: [1, 2, 3] },
    ])
      expect(
        await sendVoice(members[0]!, 'voice:offer', payload),
      ).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    expect(
      await sendVoice(members[0]!, 'voice:ice', {
        ...valid,
        candidate: TEST_ICE,
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    const text = JSON.stringify(logs.map((log) => log.mock.calls));
    for (const secret of [
      TEST_AUDIO_SDP,
      TEST_ICE.candidate,
      'private-invalid-sdp',
      members[0]!.session!.reconnectToken,
      '"hands"',
    ])
      expect(text).not.toContain(secret);
    expect(
      members[0]!.events.some(
        (event) =>
          event.event === 'server:error' &&
          JSON.stringify(event.payload).includes('voice:offer'),
      ),
    ).toBe(true);
  });
  it('enforces deterministic offering and one answer per pair', async () => {
    const h = await setup();
    const { members, roomId } = await h.room();
    const a = await joinVoice(members[0]!),
      b = await joinVoice(members[1]!);
    const forward = {
      roomId,
      voiceId: a.voiceId,
      targetId: members[1]!.joined!.playerId,
      targetVoiceId: b.voiceId,
      sdp: TEST_AUDIO_SDP,
    };
    const reverse = {
      roomId,
      voiceId: b.voiceId,
      targetId: members[0]!.joined!.playerId,
      targetVoiceId: a.voiceId,
      sdp: TEST_AUDIO_SDP,
    };
    expect((await sendVoice(members[1]!, 'voice:offer', reverse)).ok).toBe(
      false,
    );
    expect((await sendVoice(members[1]!, 'voice:answer', reverse)).ok).toBe(
      false,
    );
    expect((await sendVoice(members[0]!, 'voice:offer', forward)).ok).toBe(
      true,
    );
    expect((await sendVoice(members[0]!, 'voice:offer', forward)).ok).toBe(
      false,
    );
    expect((await sendVoice(members[1]!, 'voice:answer', reverse)).ok).toBe(
      true,
    );
    expect((await sendVoice(members[1]!, 'voice:answer', reverse)).ok).toBe(
      false,
    );
  });
  it('broadcasts mute/leave states and rejects late packets for a rejoined voice session', async () => {
    const h = await setup();
    const { members, roomId } = await h.room();
    const a = await joinVoice(members[0]!),
      b = await joinVoice(members[1]!);
    await sendVoice(members[0]!, 'voice:state', {
      roomId,
      voiceId: a.voiceId,
      muted: true,
    });
    await until(() =>
      members[1]!.events.some((event) => event.event === 'voice:state'),
    );
    const state = voiceServerSchemas['voice:state'].parse(
      members[1]!.events.find((event) => event.event === 'voice:state')!
        .payload,
    );
    expect(state.participant.muted).toBe(true);
    await sendVoice(members[0]!, 'voice:leave', {
      roomId,
      attemptId: a.attemptId,
    });
    await until(() =>
      members[1]!.events.some((event) => event.event === 'voice:peer-left'),
    );
    const again = await joinVoice(members[0]!);
    expect(again.voiceId).not.toBe(a.voiceId);
    await sendVoice(members[0]!, 'voice:leave', {
      roomId,
      attemptId: a.attemptId,
    });
    expect(
      (
        await sendVoice(members[0]!, 'voice:state', {
          roomId,
          voiceId: again.voiceId,
          muted: true,
        })
      ).ok,
    ).toBe(true);
    expect(
      await sendVoice(members[1]!, 'voice:ice', {
        roomId,
        voiceId: b.voiceId,
        targetId: members[0]!.joined!.playerId,
        targetVoiceId: a.voiceId,
        candidate: TEST_ICE,
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_SESSION' } });
  });
  it('moves ownership to a replacement socket, removes old voice, and ignores its later disconnect', async () => {
    const h = await setup();
    const { members, roomId } = await h.room();
    const old = members[0]!,
      peer = members[1]!;
    const a = await joinVoice(old);
    await joinVoice(peer);
    const replacement = await h.connect();
    await send(replacement, 'room:reconnect', old.session!);
    await until(() =>
      peer.events.some((event) => event.event === 'voice:peer-left'),
    );
    for (const [event, payload] of [
      ['voice:join', { roomId, attemptId: randomUUID() }],
      ['voice:state', { roomId, voiceId: a.voiceId, muted: false }],
      ['voice:leave', { roomId, attemptId: a.attemptId }],
    ] as const)
      expect(await sendVoice(old, event, payload)).toMatchObject({
        ok: false,
        error: { code: 'NOT_ROOM_MEMBER' },
      });
    const fresh = await joinVoice(replacement);
    old.socket.disconnect();
    expect(
      (
        await sendVoice(replacement, 'voice:state', {
          roomId,
          voiceId: fresh.voiceId,
          muted: true,
        })
      ).ok,
    ).toBe(true);
    replacement.socket.disconnect();
    await until(
      () =>
        peer.events.filter((event) => event.event === 'voice:peer-left')
          .length === 2,
    );
  });
  it('room leave also removes voice while chat and gameplay stay independent', async () => {
    const h = await setup();
    const { members, roomId } = await h.room();
    await joinVoice(members[0]!);
    await send(members[0]!, 'room:leave', { roomId });
    await until(() =>
      members[1]!.events.some((event) => event.event === 'voice:peer-left'),
    );
    const social = await sendSocial(members[1]!, 'chat:send', {
      roomId,
      commandId: randomUUID(),
      text: 'chat still works',
    });
    expect(social.ok).toBe(true);
    const stranger = await h.connect();
    expect(
      (
        await send(stranger, 'room:join', {
          roomId,
          displayName: 'New host guest',
        })
      ).ok,
    ).toBe(true);
    expect((await send(members[1]!, 'room:start', { roomId })).ok).toBe(true);
  });
});
