import { expect, test, type Page } from '@playwright/test';
import {
  gameSnapshotSchema,
  type GameSnapshot,
} from '../packages/protocol/src/index';
import { expectChainFits } from './chain-checks';

async function expectPhoneFits(page: Page) {
  await expect(page.locator('.phone-game')).toBeVisible();
  await expectChainFits(page);
  await expect(async () => {
    const geometry = await page.locator('.phone-game').evaluate((shell) => {
      const style = getComputedStyle(shell);
      const bounds = {
        left: parseFloat(style.paddingLeft),
        right: innerWidth - parseFloat(style.paddingRight),
        top: parseFloat(style.paddingTop),
        bottom: innerHeight - parseFloat(style.paddingBottom),
      };
      const inside = (element: Element) => {
        const box = element.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.height > 0 &&
          box.left >= bounds.left - 1 &&
          box.right <= bounds.right + 1 &&
          box.top >= bounds.top - 1 &&
          box.bottom <= bounds.bottom + 1
        );
      };
      const targets = Array.from(
        shell.querySelectorAll(
          '.hand-tile, .hand-controls button, .end-choice button, .mobile-tool',
        ),
      );
      return {
        pageFits:
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight &&
          window.scrollY === 0,
        seats: Array.from(shell.querySelectorAll('.seat')).filter(inside)
          .length,
        tilesFit: Array.from(shell.querySelectorAll('.board .domino')).every(
          inside,
        ),
        touch: targets.every((element) => {
          const box = element.getBoundingClientRect();
          return inside(element) && box.width >= 44 && box.height >= 44;
        }),
        tableFits: inside(shell.querySelector('.physical-table')!),
        pipsFit: Array.from(
          shell.querySelectorAll('.hand-tile .pip.filled'),
        ).every((pip) => {
          const dot = pip.getBoundingClientRect();
          const half = pip.closest('.pips')!.getBoundingClientRect();
          const tile = pip.closest('.domino')!.getBoundingClientRect();
          return [half, tile].every(
            (box) =>
              dot.left >= box.left &&
              dot.right <= box.right &&
              dot.top >= box.top &&
              dot.bottom <= box.bottom,
          );
        }),
      };
    });
    expect(geometry).toEqual({
      pageFits: true,
      seats: 4,
      tilesFit: true,
      touch: true,
      tableFits: true,
      pipsFit: true,
    });
  }).toPass({ timeout: 4000 });
}

test('phone table fits portrait, landscape and safe areas through a real round', async ({
  page,
}, info) => {
  test.skip(
    !info.project.name.startsWith('phone'),
    'Phone-specific viewport matrix; desktop/tablet have their own round checks.',
  );
  let latest: GameSnapshot | null = null;
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      const frame = payload.toString();
      if (!frame.startsWith('42')) return;
      const [event, data] = JSON.parse(frame.slice(frame.indexOf('['))) as [
        string,
        unknown,
      ];
      if (event === 'game:snapshot') latest = gameSnapshotSchema.parse(data);
    }),
  );
  const snapshot = () => {
    if (!latest) throw new Error('Missing own game snapshot');
    return latest;
  };
  await page.goto('/');
  await page.getByLabel('Your display name').fill('Mobile player');
  await page.getByRole('button', { name: 'Create a private room' }).click();
  await page.getByRole('button', { name: 'Fill empty seats' }).click();
  await expect(page.getByRole('button', { name: 'Start match' })).toBeEnabled();
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect.poll(() => latest !== null).toBe(true);
  const sizes = [
    {
      name: 'iphone-max-portrait',
      width: 428,
      height: 926,
      safe: [47, 0, 34, 0],
    },
    {
      name: 'iphone-max-landscape',
      width: 926,
      height: 428,
      safe: [0, 47, 21, 47],
    },
    { name: 'iphone-se-portrait', width: 375, height: 667, safe: [0, 0, 0, 0] },
    {
      name: 'iphone-se-landscape',
      width: 667,
      height: 375,
      safe: [0, 0, 0, 0],
    },
    { name: 'small-portrait', width: 320, height: 568, safe: [0, 0, 0, 0] },
    { name: 'android-portrait', width: 393, height: 851, safe: [0, 0, 24, 0] },
    { name: 'android-landscape', width: 851, height: 393, safe: [0, 0, 24, 0] },
  ];
  async function checkSizes(capture: boolean) {
    for (const size of sizes) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.locator('.phone-game').evaluate((shell, safe) => {
        ['top', 'right', 'bottom', 'left'].forEach((edge, index) =>
          (shell as HTMLElement).style.setProperty(
            `--safe-${edge}`,
            `${safe[index]}px`,
          ),
        );
      }, size.safe);
      await expectPhoneFits(page);
      if (capture)
        await page.screenshot({
          path: `test-results/${info.project.name}-${size.name}.png`,
        });
    }
  }
  await checkSizes(false);
  await page.getByLabel('Change your avatar').tap();
  await expect(page.locator('.avatar-popover')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(page.locator('.avatar-settings')).not.toHaveAttribute('open');
  await page.getByRole('button', { name: 'Table menu', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Table menu' })).toBeVisible();
  await expect(page.getByRole('combobox')).toBeVisible();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await expect(
    page.getByRole('button', { name: 'Table menu', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Table menu', exact: true }).click();
  await page.touchscreen.tap(1, 1);
  await expect(
    page.getByRole('dialog', { name: 'Table menu' }),
  ).not.toBeVisible();
  await page.getByRole('button', { name: 'Voice chat', exact: true }).click();
  await expect(
    page.getByText('Microphone off', { exact: true }).first(),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('dialog', { name: 'Voice chat' }),
  ).not.toBeVisible();
  await page.getByRole('button', { name: 'Room chat', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Chat message' })
    .fill('Mobile draft');
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.getByRole('button', { name: 'Room chat', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Chat message' })).toHaveValue(
    'Mobile draft',
  );
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.chat-message p').last()).toHaveText(
    'Mobile draft',
  );
  await page.getByRole('button', { name: 'Close panel' }).click();
  let captured = false;
  for (let step = 0; step < 90; step++) {
    const game = snapshot();
    await expectPhoneFits(page);
    if (!captured && game.public.board.length >= 10) {
      await checkSizes(true);
      captured = true;
    }
    if (
      game.public.phase === 'round-ended' ||
      game.public.phase === 'match-finished'
    )
      break;
    const action = game.private.legalActions[0];
    if (action?.type === 'play') {
      await page
        .getByRole('button', { name: `Play ${action.tile}`, exact: true })
        .tap();
      if (
        game.private.legalActions.filter(
          (a) => a.type === 'play' && a.tile === action.tile,
        ).length > 1
      ) {
        await expectPhoneFits(page);
        await page
          .getByRole('button', {
            name: action.end === 'left' ? '← Left end' : 'Right end →',
            exact: true,
          })
          .tap();
      }
    } else if (action?.type === 'pass')
      await page.getByRole('button', { name: 'Pass', exact: true }).tap();
    else if (action?.type === 'select-starter')
      await page
        .getByRole('button', { name: /^Let .* start$/ })
        .first()
        .tap();
    await expect.poll(() => snapshot().revision).toBeGreaterThan(game.revision);
  }
  expect(captured).toBe(true);
  expect(['round-ended', 'match-finished']).toContain(snapshot().public.phase);
  await checkSizes(false);
  await page.getByRole('button', { name: 'Table menu', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Remaining tiles' })
      .locator('.revealed-tile'),
  ).toHaveCount(
    snapshot().public.handCounts.reduce((sum, count) => sum + count, 0),
  );
  await page.getByRole('button', { name: 'Close panel' }).click();
});
