import { afterEach, expect, it } from 'vitest';
import { chooseCommand, shuffleDeck } from '@domino/bot-player';
import type { BotCommand, BotView } from '@domino/bot-player';
import type { GameAction, GameSnapshot } from '@domino/protocol';
import {
  CLIENT_EVENTS,
  voiceServerSchemas,
  SERVER_EVENTS,
  gameSnapshotSchema,
  roomSnapshotSchema,
  commandResultSchema,
  roomJoinedSchema,
  roomSessionSchema,
  roomReplacedSchema,
  serverErrorSchema,
  chatHistorySchema,
  chatMessageSchema,
  reactionReceivedSchema,
} from '@domino/protocol';
import { command, harness, send, until } from './harness.js';

const opened: Awaited<ReturnType<typeof harness>>[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((h) => h.close()));
});
function view(game: GameSnapshot): BotView {
  const legalActions: BotCommand[] = [];
  for (const action of game.private.legalActions) {
    if (action.type === 'play') {
      if (!action.end) throw new Error('Missing projected end');
      legalActions.push({
        type: 'play',
        seat: game.seat,
        tile: action.tile,
        end: action.end,
      });
    } else if (action.type === 'pass')
      legalActions.push({ type: 'pass', seat: game.seat });
    else if (action.type === 'select-starter') {
      if (action.selected === undefined)
        throw new Error('Missing projected starter');
      legalActions.push({
        type: 'select-starter',
        seat: game.seat,
        selected: action.selected,
      });
    }
  }
  const score = (team: 'A' | 'B') => {
    const value = game.public.score.teams[team];
    return value.isScoreOpened
      ? {
          isScoreOpened: true as const,
          officialScore: value.officialScore,
          pendingOpeningPoints: 0 as const,
        }
      : {
          isScoreOpened: false as const,
          officialScore: 0 as const,
          pendingOpeningPoints: value.pendingOpeningPoints,
        };
  };
  return {
    phase: game.public.phase,
    seat: game.seat,
    roundNumber: game.public.roundNumber,
    hand: game.private.hand,
    handCounts: game.public.handCounts,
    board: game.public.board,
    score: {
      teams: { A: score('A'), B: score('B') },
      sekaBank: game.public.score.sekaBank,
    },
    turn: game.public.turn,
    eligibleTeam: game.public.eligibleTeam,
    legalActions,
  };
}
function action(chosen: BotCommand): GameAction {
  switch (chosen.type) {
    case 'play':
      return { type: 'play', tile: chosen.tile, end: chosen.end };
    case 'pass':
      return { type: 'pass' };
    case 'select-starter':
      return { type: 'select-starter', selected: chosen.selected };
  }
}
it('four real clients finish a bot-assisted match using only private wire projections, auditing every event', async () => {
  let seed = 41;
  const h = await harness({
    makeDeck: () => {
      const next = shuffleDeck(seed);
      seed = next.state;
      return next.deck;
    },
  });
  opened.push(h);
  const { members, roomId } = await h.started();
  let commandCount = 0;
  let selections = 0;
  let rounds = 0;
  let revision = 5;
  const rng = [11, 22, 33, 44];
  const schemas = {
    ...voiceServerSchemas,
    [SERVER_EVENTS.joined]: roomJoinedSchema,
    [SERVER_EVENTS.session]: roomSessionSchema,
    [SERVER_EVENTS.replaced]: roomReplacedSchema,
    [SERVER_EVENTS.room]: roomSnapshotSchema,
    [SERVER_EVENTS.game]: gameSnapshotSchema,
    [SERVER_EVENTS.result]: commandResultSchema,
    [SERVER_EVENTS.error]: serverErrorSchema,
    [SERVER_EVENTS.chatHistory]: chatHistorySchema,
    [SERVER_EVENTS.chatMessage]: chatMessageSchema,
    [SERVER_EVENTS.reaction]: reactionReceivedSchema,
  };
  function audit() {
    const hands = members.map((client) => client.game!.private.hand);
    const tiles = [
      ...hands.flat(),
      ...members[0]!.game!.public.board.map((piece) => piece.tile),
    ];
    expect(tiles).toHaveLength(28);
    expect(new Set(tiles).size).toBe(28);
    for (const [index, client] of members.entries()) {
      expect(client.game!.playerId).toBe(client.joined!.playerId);
      expect(client.game!.seat).toBe(index);
      expect(client.game!.public).toEqual(members[0]!.game!.public);
      for (const event of client.events.splice(0)) {
        expect(
          schemas[event.event as keyof typeof schemas].safeParse(event.payload)
            .success,
        ).toBe(true);
        const text = JSON.stringify(event.payload);
        expect(text).not.toContain('"hands"');
        expect(text).not.toContain('"socketId"');
        expect(text).not.toContain('"state"');
        const reveal =
          event.event === SERVER_EVENTS.game
            ? gameSnapshotSchema.parse(event.payload).public.revealedHands
            : undefined;
        if (reveal) expect(reveal).toEqual(hands);
        else
          for (const [other, hand] of hands.entries())
            if (other !== index)
              for (const tile of hand) expect(text).not.toContain(`"${tile}"`);
      }
    }
  }
  audit();
  while (
    members[0]!.game!.public.phase !== 'match-finished' &&
    commandCount < 3000
  ) {
    const publicState = members[0]!.game!.public;
    let actor = 0;
    let payload: GameAction;
    if (publicState.phase === 'round-ended') {
      if (rounds === 0)
        expect(
          await command(members[1]!, { type: 'next-round' }),
        ).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
      payload = { type: 'next-round' };
      rounds++;
    } else {
      actor =
        publicState.phase === 'playing'
          ? publicState.turn!
          : members.findIndex(
              (client) => client.game!.private.legalActions.length > 0,
            );
      const decision = chooseCommand(
        view(members[actor]!.game!),
        'seeded-random',
        rng[actor]!,
      );
      rng[actor] = decision.rngState;
      expect(decision.command).not.toBeNull();
      payload = action(decision.command!);
      if (payload.type === 'select-starter') selections++;
    }
    const result = await command(members[actor]!, payload);
    expect(result).toEqual(
      expect.objectContaining({ ok: true, roomId, revision: revision + 1 }),
    );
    revision++;
    commandCount++;
    await until(() =>
      members.every((client) => client.game?.revision === revision),
    );
    audit();
  }
  const final = members[0]!.game!.public;
  expect(final.phase).toBe('match-finished');
  expect(final.score.teams[final.winner!].officialScore).toBeGreaterThanOrEqual(
    101,
  );
  expect(commandCount).toBeGreaterThan(28);
  expect(selections).toBeGreaterThan(0);
  expect(rounds).toBeGreaterThan(0);
  expect(members[0]!.room!.lifecycle).toBe('completed');
  expect(await command(members[0]!, { type: 'next-round' })).toMatchObject({
    ok: false,
    error: { code: 'INVALID_PHASE' },
  });
  expect(
    await send(members[0]!, CLIENT_EVENTS.start, { roomId }),
  ).toMatchObject({ ok: false, error: { code: 'ROOM_ALREADY_STARTED' } });
}, 20000);
