import { expect, test } from '@playwright/test';
import { expectChainFits } from './chain-checks';
import { gameSnapshotSchema } from '../packages/protocol/src/index';
import type { GameSnapshot } from '../packages/protocol/src/index';

test('one human fills bot seats and plays a real round while bots respond', async ({
  page,
}, info) => {
  let latest: GameSnapshot | null = null;
  const errors: string[] = [];
  let sessions = 0;
  page.on('pageerror', () => errors.push('Browser runtime error'));
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      const text = payload.toString();
      if (!text.startsWith('42')) return;
      const [event, data] = JSON.parse(text.slice(text.indexOf('['))) as [
        string,
        unknown,
      ];
      if (event === 'room:session') sessions++;
      if (event === 'game:snapshot') latest = gameSnapshotSchema.parse(data);
    }),
  );
  // Read only the snapshots actually sent to this human; all actions use the visible UI.
  const snapshot = (): GameSnapshot => {
    if (!latest) throw new Error('Expected game snapshot');
    return latest;
  };
  const noOverflow = async () =>
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  await page.goto('/');
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await page.getByLabel('Your display name').fill('Solo host');
  await page.getByRole('button', { name: 'Create a private room' }).click();
  await expect(page).toHaveURL(/\/room\/[a-f0-9]{32}$/);
  await page
    .getByRole('button', { name: 'Add bot', exact: true })
    .first()
    .click();
  await expect(page.getByRole('button', { name: 'Remove bot' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Remove bot' }).click();
  await page
    .getByRole('button', { name: 'Fill empty seats with bots' })
    .click();
  await expect(page.getByRole('button', { name: 'Remove bot' })).toHaveCount(3);
  await expect(page.getByText('Ready', { exact: true })).toHaveCount(3);
  await noOverflow();
  await page.screenshot({
    path: `test-results/${info.project.name}-bot-lobby.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.getByRole('region', { name: 'Your hand' })).toBeVisible();
  await expect.poll(() => latest !== null).toBe(true);
  const initialRevision = snapshot().revision;
  let humanMoves = 0;
  for (let step = 0; step < 80; step++) {
    const game = snapshot();
    if (
      game.public.phase === 'round-ended' ||
      game.public.phase === 'match-finished'
    )
      break;
    await expectChainFits(page);
    const available = game.private.legalActions,
      action = available[0];
    if (action) {
      await expect(page.locator('.game')).toHaveAttribute(
        'data-revision',
        String(game.revision),
      );
      if (action.type === 'play') {
        const tile = page.getByRole('button', {
          name: `Play ${action.tile}`,
          exact: true,
        });
        if (info.project.use.hasTouch) await tile.tap();
        else await tile.click();
        if (
          available.filter((a) => a.type === 'play' && a.tile === action.tile)
            .length > 1
        )
          await page
            .getByRole('button', {
              name: action.end === 'left' ? '← Left end' : 'Right end →',
              exact: true,
            })
            .click();
      } else if (action.type === 'pass')
        await page
          .getByRole('button', { name: 'Pass — no playable tiles' })
          .click();
      else throw new Error('Unexpected action during first round');
      humanMoves++;
    }
    await expect.poll(() => snapshot().revision).toBeGreaterThan(game.revision);
  }
  expect(
    ['round-ended', 'match-finished'].includes(snapshot().public.phase),
  ).toBe(true);
  expect(humanMoves).toBeGreaterThan(0);
  expect(snapshot().revision - initialRevision).toBeGreaterThan(humanMoves + 3);
  expect(sessions).toBe(1);
  expect(errors).toEqual([]);
  await noOverflow();
  await expectChainFits(page);
  await page.screenshot({
    path: `test-results/${info.project.name}-bot-round.png`,
    fullPage: true,
  });
  // A completed round is stable while checking responsive reflow in both directions.
  for (const width of [
    320,
    600,
    1100,
    info.project.use.viewport?.width ?? 1440,
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    await expectChainFits(page);
  }
});
