import { expect, test, type Page } from '@playwright/test';

async function expectClearLobby(page: Page) {
  const center = page.locator('.lobby-center');
  await expect(center).toBeVisible();
  await expect
    .poll(() =>
      center.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const overlaps = (other: DOMRect) =>
          box.left < other.right &&
          box.right > other.left &&
          box.top < other.bottom &&
          box.bottom > other.top;
        const table = element.closest('.lobby-table')!;
        const neighbors = Array.from(
          table.querySelectorAll('.seat, .scene-hand'),
        );
        return neighbors.every(
          (neighbor) =>
            neighbor.getClientRects().length === 0 ||
            !overlaps(neighbor.getBoundingClientRect()),
        );
      }),
    )
    .toBe(true);
  const button = page.getByRole('button', { name: 'Start match', exact: true });
  const bounds = await button.boundingBox();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.width).toBeLessThanOrEqual(240);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test('waiting and full lobbies leave the center clear of seats and hands', async ({
  page,
}, info) => {
  await page.goto('/');
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await page.getByLabel('Your display name').fill('Home player');
  await page.getByRole('button', { name: 'Create a private room' }).click();
  await expect(page).toHaveURL(/\/room\/[a-f0-9]{32}$/);
  await expect(
    page.getByRole('button', { name: 'Start match', exact: true }),
  ).toBeDisabled();
  await expectClearLobby(page);
  await page.locator('.lounge-scene').screenshot({
    path: `test-results/${info.project.name}-lobby-spacious-waiting.png`,
  });
  await page.getByRole('button', { name: 'Fill empty seats' }).click();
  await expect(page.getByRole('button', { name: 'Remove player' })).toHaveCount(
    3,
  );
  await expectClearLobby(page);
  await page.locator('.lounge-scene').screenshot({
    path: `test-results/${info.project.name}-lobby-spacious-ready.png`,
  });
  // Check both sides of the decorative and tablet breakpoints, including narrow phones.
  for (const width of [
    320,
    640,
    641,
    1100,
    1101,
    info.project.use.viewport?.width ?? 1440,
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    await expectClearLobby(page);
  }
  await page.getByRole('button', { name: 'Start match', exact: true }).click();
  await expect(page.locator('.lobby-table')).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Your hand', exact: true }),
  ).toBeVisible();
});
