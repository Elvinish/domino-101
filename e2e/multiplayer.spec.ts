import { test, expect } from '@playwright/test';
import { expectChainFits } from './chain-checks';
import type { BrowserContext, Page } from '@playwright/test';
import {
  gameSnapshotSchema,
  voiceServerSchemas,
  roomSnapshotSchema,
  roomJoinedSchema,
  roomSessionSchema,
  roomReplacedSchema,
  commandResultSchema,
  serverErrorSchema,
  chatHistorySchema,
  chatMessageSchema,
  reactionReceivedSchema,
} from '../packages/protocol/src/index';
import type { GameSnapshot } from '../packages/protocol/src/index';

interface Observer {
  page: Page;
  frames: { event: string; data: unknown }[];
  games: Map<number, GameSnapshot>;
  latest: GameSnapshot | null;
}
function observe(page: Page): Observer {
  const observer: Observer = {
    page,
    frames: [],
    games: new Map(),
    latest: null,
  };
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      const text = payload.toString();
      if (!text.startsWith('42')) return;
      const index = text.indexOf('[');
      if (index === -1) return;
      const [event, data] = JSON.parse(text.slice(index)) as [string, unknown];
      observer.frames.push({ event, data });
      if (event === 'game:snapshot') {
        const game = gameSnapshotSchema.parse(data);
        observer.games.set(game.revision, game);
        observer.latest = game;
      }
    }),
  );
  return observer;
}
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object')
    return Object.values(value).flatMap(strings);
  return [];
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
function audit(players: Observer[]) {
  const schemas = {
    ...voiceServerSchemas,
    'room:joined': roomJoinedSchema,
    'room:session': roomSessionSchema,
    'room:replaced': roomReplacedSchema,
    'room:snapshot': roomSnapshotSchema,
    'game:snapshot': gameSnapshotSchema,
    'command:result': commandResultSchema,
    'server:error': serverErrorSchema,
    'chat:history': chatHistorySchema,
    'chat:message': chatMessageSchema,
    'reaction:received': reactionReceivedSchema,
  };
  const tokens = players.map(
    (player) =>
      roomSessionSchema.parse(
        player.frames.find((frame) => frame.event === 'room:session')!.data,
      ).reconnectToken,
  );
  for (const [ownerIndex, player] of players.entries()) {
    for (const frame of player.frames) {
      const encoded = JSON.stringify(frame.data);
      for (const [index, token] of tokens.entries())
        expect(
          encoded.includes(token) &&
            (frame.event !== 'room:session' || index !== ownerIndex),
        ).toBe(false);
      const schema = schemas[frame.event as keyof typeof schemas];
      expect(schema, `Unexpected outbound event ${frame.event}`).toBeDefined();
      expect(schema.safeParse(frame.data).success).toBe(true);
    }
    for (const [revision, game] of player.games) {
      const all = players.map((other) => other.games.get(revision));
      expect(all.every(Boolean)).toBe(true);
      const hidden = all
        .filter((other) => other!.playerId !== game.playerId)
        .flatMap((other) => other!.private.hand);
      const transmitted = strings(game);
      for (const tile of hidden) expect(transmitted).not.toContain(tile);
      expect(
        new Set(
          all
            .flatMap((other) => other!.private.hand)
            .concat(game.public.board.map((tile) => tile.tile)),
        ).size,
      ).toBe(28);
    }
  }
}

test('four friends create, join, play and keep private hands isolated', async ({
  browser,
}, info) => {
  const contexts: BrowserContext[] = [];
  const players: Observer[] = [];
  const errors: string[] = [];
  try {
    for (let i = 0; i < 4; i++) {
      const context = await browser.newContext({
        baseURL: 'http://127.0.0.1:4173',
        viewport: info.project.use.viewport ?? { width: 1440, height: 1000 },
        isMobile: info.project.use.isMobile ?? false,
        hasTouch: info.project.use.hasTouch ?? false,
      });
      contexts.push(context);
      const page = await context.newPage();
      page.on('pageerror', () => errors.push('Browser runtime error'));
      players.push(observe(page));
    }
    const host = players[0]!.page;
    await host.goto('/');
    await expect(host.getByText('Connected', { exact: true })).toBeVisible();
    await host.getByLabel('Your display name').fill('Ayla');
    await host.getByRole('button', { name: 'Create a private room' }).click();
    await expect(host).toHaveURL(/\/room\/[a-f0-9]{32}$/);
    const url = host.url();
    await expect(
      host.getByRole('button', { name: 'Start match' }),
    ).toBeDisabled();
    for (let i = 1; i < 4; i++) {
      const page = players[i]!.page;
      await page.goto(url);
      await page
        .getByLabel('Your display name')
        .fill(['Ayla', 'Murad', 'Leyla', 'Rauf'][i]!);
      await page
        .getByRole('button', { name: 'Join room', exact: true })
        .click();
      await expect(page.getByText('Room code', { exact: true })).toBeVisible();
    }
    await expect(
      host.getByRole('button', { name: 'Start match' }),
    ).toBeEnabled();
    await host.screenshot({
      path: `test-results/${info.project.name}-lobby.png`,
      fullPage: true,
    });
    await host.getByRole('button', { name: 'Start match' }).click();
    for (const player of players) {
      await expect(
        player.page.getByRole('region', { name: 'Your hand' }),
      ).toBeVisible();
      await expect(
        player.page
          .getByRole('region', { name: 'Your hand' })
          .getByRole('button'),
      ).toHaveCount(7);
      await noOverflow(player.page);
    }
    await host.screenshot({
      path: `test-results/${info.project.name}-table.png`,
      fullPage: true,
    });
    let moves = 0;
    const completeMatch = info.project.name === 'desktop';
    const max = completeMatch ? 1500 : 16;
    while (moves < max) {
      const game = players[0]!.latest!;
      if (game.public.phase === 'match-finished') break;
      await Promise.all(
        players.map(async (player) => {
          await expect.poll(() => player.latest?.revision).toBe(game.revision);
          await expect(player.page.locator('.game')).toHaveAttribute(
            'data-revision',
            String(game.revision),
          );
        }),
      );
      await expectChainFits(host);
      const actor = players.find(
        (player) => player.latest!.private.legalActions.length > 0,
      )!;
      expect(actor).toBeDefined();
      const available = actor.latest!.private.legalActions;
      const action = available[0]!;
      if (action.type === 'play') {
        const tileButton = actor.page.getByRole('button', {
          name: `Play ${action.tile}`,
          exact: true,
        });
        await expect(tileButton).toBeEnabled();
        const box = await tileButton.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        if (info.project.use.hasTouch) await tileButton.tap();
        else await tileButton.click();
        if (
          available.filter(
            (item) => item.type === 'play' && item.tile === action.tile,
          ).length > 1
        ) {
          await actor.page
            .getByRole('button', {
              name: action.end === 'left' ? '← Left end' : 'Right end →',
              exact: true,
            })
            .click();
        }
      } else if (action.type === 'pass')
        await actor.page
          .getByRole('button', { name: 'Pass', exact: true })
          .click();
      else if (action.type === 'next-round')
        await actor.page
          .getByRole('button', { name: 'Start next round' })
          .click();
      else
        await actor.page
          .getByRole('button', { name: /^Let .* start$/ })
          .first()
          .click();
      await Promise.all(
        players.map(async (player) => {
          await expect
            .poll(() => player.latest?.revision)
            .toBe(game.revision + 1);
          await expect(player.page.locator('.game')).toHaveAttribute(
            'data-revision',
            String(game.revision + 1),
          );
        }),
      );
      for (const player of players)
        expect(player.latest!.public).toEqual(players[0]!.latest!.public);
      moves++;
    }
    expect(moves).toBeGreaterThan(5);
    if (completeMatch) {
      expect(players[0]!.latest!.public.phase).toBe('match-finished');
      await expect(
        host.getByRole('heading', { name: /^Team [AB] wins!$/ }),
      ).toBeVisible();
    }
    for (const player of players) {
      const hidden = players
        .filter((other) => other !== player)
        .flatMap((other) => other.latest!.private.hand);
      const ownTiles = await player.page
        .getByRole('region', { name: 'Your hand' })
        .getByRole('button', { name: /^Play / })
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute('aria-label')),
        );
      expect(ownTiles).toEqual(
        player.latest!.private.hand.map((tile) => `Play ${tile}`),
      );
      for (const tile of hidden)
        expect(await player.page.locator('body').innerText()).not.toContain(
          tile,
        );
      await noOverflow(player.page);
    }
    audit(players);
    expect(errors).toEqual([]);
    await host.screenshot({
      path: `test-results/${info.project.name}-played.png`,
      fullPage: true,
    });
    // Abrupt browser closure exercises actual server disconnect propagation.
    if (!completeMatch) {
      await contexts[3]!.close();
      await expect(host.getByRole('alert')).toHaveText(/table is paused/);
      await expect(
        host
          .getByRole('region', { name: 'Your hand' })
          .getByRole('button')
          .first(),
      ).toBeDisabled();
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
