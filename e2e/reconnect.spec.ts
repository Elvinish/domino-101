import { test, expect } from '@playwright/test';
import { openMenu } from './panels';
import type { BrowserContext, Page } from '@playwright/test';
import {
  roomSessionSchema,
  gameSnapshotSchema,
  roomJoinedSchema,
} from '../packages/protocol/src/index';
import type {
  GameSnapshot,
  ReconnectSession,
  RoomJoined,
} from '../packages/protocol/src/index';

function observe(page: Page) {
  const received: {
    game: GameSnapshot | null;
    joined: RoomJoined | null;
    session: ReconnectSession | null;
    count: number;
    frames: { event: string; data: unknown }[];
  } = { game: null, joined: null, session: null, count: 0, frames: [] };
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      const text = payload.toString();
      if (!text.startsWith('42')) return;
      const [event, data] = JSON.parse(text.slice(text.indexOf('['))) as [
        string,
        unknown,
      ];
      received.frames.push({ event, data });
      if (event === 'room:session')
        received.session = roomSessionSchema.parse(data);
      if (event === 'room:joined')
        received.joined = roomJoinedSchema.parse(data);
      if (event === 'game:snapshot') {
        received.game = gameSnapshotSchema.parse(data);
        received.count++;
      }
    }),
  );
  return { page, received };
}

test('hard refresh restores the exact seat and hand; replacement tab revokes old ownership', async ({
  browser,
}, info) => {
  const contexts: BrowserContext[] = [];
  const players: ReturnType<typeof observe>[] = [];
  try {
    for (let index = 0; index < 4; index++) {
      const context = await browser.newContext({
        baseURL: 'http://127.0.0.1:4173',
        viewport: info.project.use.viewport ?? { width: 1440, height: 1000 },
        isMobile: info.project.use.isMobile ?? false,
        hasTouch: info.project.use.hasTouch ?? false,
      });
      contexts.push(context);
      players.push(observe(await context.newPage()));
    }
    const host = players[0]!.page;
    await host.goto('/');
    await host.getByLabel('Your display name').fill('Ayla');
    await host.getByRole('button', { name: 'Create a private room' }).click();
    await expect(host).toHaveURL(/\/room\/[a-f0-9]{32}$/);
    const url = host.url();
    for (let index = 1; index < 4; index++) {
      const page = players[index]!.page;
      await page.goto(url);
      await page
        .getByLabel('Your display name')
        .fill(['Ayla', 'Murad', 'Leyla', 'Rauf'][index]!);
      await page
        .getByRole('button', { name: 'Join room', exact: true })
        .click();
      await expect(page.getByText('Room code', { exact: true })).toBeVisible();
    }
    await host.getByRole('button', { name: 'Start match' }).click();
    for (const player of players)
      await expect(
        player.page.getByRole('region', { name: 'Your hand' }),
      ).toBeVisible();
    const actorIndex = players.findIndex(
      (player) => player.received.game!.private.legalActions.length > 0,
    );
    const actor = players[actorIndex]!,
      before = structuredClone(actor.received.game!),
      assigned = structuredClone(actor.received.joined!);
    const count = actor.received.count;
    // Real page reload destroys the old client and restores from browser storage.
    await actor.page.reload();
    await expect.poll(() => actor.received.count).toBeGreaterThan(count);
    await expect(
      actor.page.getByRole('region', { name: 'Your hand' }),
    ).toBeVisible();
    expect(actor.received.joined).toEqual(assigned);
    expect(actor.received.game!.private.hand).toEqual(before.private.hand);
    expect(actor.received.game!.public).toEqual(before.public);
    expect(actor.received.game!.matchId).toBe(before.matchId);
    expect(actor.received.game!.revision).toBeGreaterThanOrEqual(
      before.revision,
    );
    await expect(actor.page.getByLabel('Your display name')).toHaveCount(0);
    const action = actor.received.game!.private.legalActions[0]!;
    expect(action.type).toBe('play');
    if (action.type !== 'play') throw new Error('Expected opening move');
    const revision = actor.received.game!.revision;
    const tile = actor.page.getByRole('button', {
      name: `Play ${action.tile}`,
      exact: true,
    });
    if (info.project.use.hasTouch) await tile.tap();
    else await tile.click();
    await expect.poll(() => actor.received.game!.revision).toBe(revision + 1);
    expect(actor.received.game!.private.hand).toHaveLength(6);
    for (const player of players)
      await expect
        .poll(() => player.received.game!.revision)
        .toBe(revision + 1);

    // A fresh tab must not inherit a seat. Explicit credential transfer below
    // exercises the server's stale-socket protection, not normal invitation flow.
    const replacement = observe(await contexts[actorIndex]!.newPage());
    await replacement.page.goto(url);
    await expect(
      replacement.page.getByLabel('Your display name'),
    ).toBeVisible();
    await replacement.page.evaluate((session) => {
      sessionStorage.setItem(
        `domino101.session.${session.roomId}`,
        JSON.stringify(session),
      );
    }, actor.received.session!);
    await replacement.page.reload();
    await expect(
      replacement.page.getByRole('region', { name: 'Your hand' }),
    ).toBeVisible();
    expect(replacement.received.joined).toEqual(assigned);
    expect(replacement.received.game!.private.hand).toEqual(
      actor.received.game!.private.hand,
    );
    await expect(actor.page.getByRole('alert')).toHaveText(/another tab/);
    await expect(
      actor.page.getByRole('region', { name: 'Your hand' }),
    ).toHaveCount(0);
    await expect(
      actor.page.getByRole('button', { name: 'Retry connection' }),
    ).toHaveCount(0);
    expect(replacement.received.game!.revision).toBe(revision + 1);

    await actor.page.getByRole('button', { name: 'Dismiss old table' }).click();
    await expect(
      actor.page.getByRole('heading', { name: 'Take a seat' }),
    ).toBeVisible();
    const recoveredCount = replacement.received.count;
    await replacement.page.reload();
    await expect
      .poll(() => replacement.received.count)
      .toBeGreaterThan(recoveredCount);
    await expect(
      replacement.page.getByRole('region', { name: 'Your hand' }),
    ).toBeVisible();
    expect(replacement.received.joined).toEqual(assigned);

    const tokens = players.map(
      (player) => player.received.session!.reconnectToken,
    );
    for (const [index, player] of players.entries()) {
      for (const frame of player.received.frames) {
        const text = JSON.stringify(frame.data);
        for (const [owner, token] of tokens.entries())
          expect(
            text.includes(token) &&
              (frame.event !== 'room:session' || owner !== index),
          ).toBe(false);
        if (frame.event === 'room:session')
          expect(roomSessionSchema.parse(frame.data).playerId).toBe(
            player.received.joined!.playerId,
          );
      }
      expect(tokens.some((token) => player.page.url().includes(token))).toBe(
        false,
      );
      const visible = await player.page.locator('body').innerText();
      expect(tokens.some((token) => visible.includes(token))).toBe(false);
    }
    expect(
      replacement.received.frames.some((frame) =>
        JSON.stringify(frame.data).includes(tokens[actorIndex]!),
      ),
    ).toBe(false);
    const hidden = players
      .filter((_, index) => index !== actorIndex)
      .flatMap((player) => player.received.game!.private.hand);
    const projection = JSON.stringify(replacement.received.game);
    for (const tile of hidden)
      expect(projection.includes(`"${tile}"`)).toBe(false);
    expect(
      await replacement.page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await replacement.page.screenshot({
      path: `test-results/${info.project.name}-reconnected.png`,
      fullPage: true,
    });
    await openMenu(replacement.page);
    await replacement.page.getByRole('button', { name: 'Leave table' }).click();
    await expect(
      replacement.page.getByRole('heading', { name: 'Take a seat' }),
    ).toBeVisible();
    expect(
      await replacement.page.evaluate(
        (roomId) =>
          sessionStorage.getItem(`domino101.session.${roomId}`) === null,
        assigned.roomId,
      ),
    ).toBe(true);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
