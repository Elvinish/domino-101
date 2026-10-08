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
  const handRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/images\/lounge\/hands?-.*\.png/.test(request.url()))
      handRequests.push(request.url());
  });
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
  await expect(page.locator('.scene-player.is-active')).toHaveCount(1);
  await expect(page.locator('.scene-hand')).toHaveCount(4);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page
      .locator('.scene-player.is-active .scene-hand img')
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe('none');
  expect(
    await page
      .locator('.scene-smoke path')
      .first()
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const richScene = (info.project.use.viewport?.width ?? 1440) > 640;
  if (richScene) {
    await expect
      .poll(() =>
        page
          .locator('.scene-hand img')
          .evaluateAll((images) =>
            images.every(
              (image) =>
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth > 1,
            ),
          ),
      )
      .toBe(true);
  } else {
    expect(handRequests).toHaveLength(0);
  }
  const initialRevision = snapshot().revision;
  await page.locator('.lounge-scene').screenshot({
    path: `test-results/${info.project.name}-home-opening.png`,
  });
  let humanMoves = 0;
  let capturedPlaying = false;
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
      if (
        !capturedPlaying &&
        game.public.board.length >= 6 &&
        game.private.hand.length >= 2
      ) {
        await page.locator('.lounge-scene').screenshot({
          path: `test-results/${info.project.name}-home-playing.png`,
        });
        capturedPlaying = true;
      }
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
  if (richScene) {
    const decoration = await page
      .locator('.physical-table')
      .evaluate((table) => {
        const board = table.querySelector('.board')!.getBoundingClientRect();
        const hands = Array.from(table.querySelectorAll('.scene-hand'));
        return {
          nonInteractive: Array.from(
            table.querySelectorAll(
              '.scene-decoration, .scene-hand img, .scene-prop',
            ),
          ).every(
            (element) => getComputedStyle(element).pointerEvents === 'none',
          ),
          outsideChain: hands.every((hand) => {
            const box = hand.getBoundingClientRect();
            return (
              box.right <= board.left ||
              box.left >= board.right ||
              box.bottom <= board.top ||
              box.top >= board.bottom
            );
          }),
        };
      });
    expect(decoration.nonInteractive).toBe(true);
    expect(decoration.outsideChain).toBe(true);
  }
  await page
    .locator('.lounge-scene')
    .screenshot({ path: `test-results/${info.project.name}-lounge-scene.png` });
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
