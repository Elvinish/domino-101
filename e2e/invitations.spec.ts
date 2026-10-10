import { test, expect } from '@playwright/test';

test('code, direct invite, fresh tab and reload use the same room without sharing the host seat', async ({
  browser,
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await page.getByLabel('Your display name').fill('Invite host');
  await page.getByRole('button', { name: 'Create a private room' }).click();
  await expect(page).toHaveURL(/\/room\/[a-f0-9]{32}$/);
  const url = page.url();
  const code = await page.locator('.room-code code').innerText();
  // Inspect exactly what the copy controls send, without changing the OS clipboard.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          document.body.dataset.copied = value;
        },
      },
    });
  });
  await page.getByRole('button', { name: 'Copy code' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-copied', code);
  await page.getByRole('button', { name: 'Copy invite link' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-copied', url);
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  const tab = await page.context().newPage();
  try {
    const guest = await contexts[0]!.newPage();
    await guest.goto('/');
    await expect(guest.getByText('Connected', { exact: true })).toBeVisible();
    await guest.getByLabel('Your display name').fill('Code guest');
    await guest.getByLabel('Room code').fill(`  ${code.toUpperCase()}  `);
    await guest.getByLabel('Room code').press('Enter');
    await expect(guest).toHaveURL(url);
    await expect(
      guest.locator('.seat strong').filter({ hasText: 'Invite host' }),
    ).toBeVisible();
    await expect(
      page.locator('.seat strong').filter({ hasText: 'Code guest' }),
    ).toBeVisible();

    const invited = await contexts[1]!.newPage();
    const response = await invited.goto(url);
    expect(response!.status()).toBe(200);
    await expect(invited.getByLabel('Your display name')).toBeVisible();
    expect((await invited.reload())!.status()).toBe(200);
    await expect(invited.getByText('Connected', { exact: true })).toBeVisible();
    await invited.getByLabel('Your display name').fill('Link guest');
    await invited.getByRole('button', { name: 'Join room' }).click();
    await expect(invited.locator('.own-seat strong')).toHaveText('Link guest');
    expect((await invited.reload())!.status()).toBe(200);
    await expect(invited.locator('.own-seat strong')).toHaveText('Link guest');
    await expect(invited.locator('.room-code code')).toHaveText(code);

    await tab.goto(url);
    await expect(tab.getByLabel('Your display name')).toBeVisible();
    await expect(tab.getByText('Connected', { exact: true })).toBeVisible();
    await tab.getByLabel('Your display name').fill('New tab guest');
    await tab.getByRole('button', { name: 'Join room' }).click();
    await expect(tab.locator('.own-seat strong')).toHaveText('New tab guest');
    await expect(page.locator('.own-seat strong')).toHaveText('Invite host');
    for (const client of [page, guest, invited, tab]) {
      await expect(client.locator('.seat strong')).toHaveCount(4);
      await expect(
        client.locator('.seat strong').filter({ hasText: 'New tab guest' }),
      ).toBeVisible();
      await expect(client.locator('.room-code code')).toHaveText(code);
    }
    const outsider = await contexts[1]!.newPage();
    await outsider.goto(url);
    await expect(
      outsider.getByText('Connected', { exact: true }),
    ).toBeVisible();
    await outsider.getByLabel('Your display name').fill('Fifth guest');
    await outsider.getByRole('button', { name: 'Join room' }).click();
    await expect(outsider.getByRole('alert')).toContainText('full');
    await expect(outsider.locator('.own-seat')).toHaveCount(0);
  } finally {
    await tab.close();
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('bad codes fail clearly without creating a room, and SPA build preserves static assets', async ({
  page,
  request,
}) => {
  const rules = await request.get('/_redirects');
  expect(rules.status()).toBe(200);
  expect((await rules.text()).trim()).toBe('/* /index.html 200');
  const html = await request.get('/room/' + 'a'.repeat(32));
  expect(html.status()).toBe(200);
  const source = await html.text();
  const asset = /src="([^"\s]+\.js)"/.exec(source)![1]!;
  const js = await request.get(asset);
  expect(js.status()).toBe(200);
  expect(js.headers()['content-type']).toMatch(/javascript/);
  await page.goto('/');
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await page.getByLabel('Your display name').fill('Guest');
  for (const code of ['bad-code', 'f'.repeat(32)]) {
    await page.getByLabel('Room code').fill(code);
    await page.getByRole('button', { name: 'Join room' }).click();
    await expect(page.getByRole('alert')).toContainText(
      code === 'bad-code' ? 'Check your name and room code' : 'does not exist',
    );
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('.own-seat')).toHaveCount(0);
  }
});
