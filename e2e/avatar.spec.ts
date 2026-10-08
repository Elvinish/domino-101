import { expect, test } from '@playwright/test';

test('avatar upload stays local, survives reload and can be removed', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await page.getByLabel('Your display name').fill('Home player');
  await page.getByRole('button', { name: 'Create a private room' }).click();
  await expect(page).toHaveURL(/\/room\/[a-f0-9]{32}$/);
  await page.getByLabel('Change your avatar').click();
  await page.getByLabel(/Choose photo/).setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.locator('.own-seat .player-avatar img')).toHaveAttribute(
    'src',
    /^data:image\/jpeg;base64,/,
  );
  expect(
    await page
      .locator('.own-seat .player-avatar img')
      .evaluate((img) => (img as HTMLImageElement).naturalWidth),
  ).toBe(128);
  await expect(
    page.locator('.seat:not(.own-seat) .player-avatar img'),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.own-seat .player-avatar img')).toHaveCount(1);
  await page.getByLabel('Change your avatar').click();
  await page.getByRole('button', { name: 'Remove photo' }).click();
  await expect(page.locator('.own-seat .player-avatar img')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Change your avatar')).toHaveText('H');
});
