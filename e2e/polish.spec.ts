import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import {
  gameSnapshotSchema,
  roomSessionSchema,
} from '../packages/protocol/src/index';
import type { GameSnapshot } from '../packages/protocol/src/index';

function observe(page: Page) {
  const state: {
    game: GameSnapshot | null;
    token: string | null;
    chat: number;
  } = { game: null, token: null, chat: 0 };
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      const frame = payload.toString();
      if (!frame.startsWith('42')) return;
      const [event, value] = JSON.parse(frame.slice(frame.indexOf('['))) as [
        string,
        unknown,
      ];
      if (event === 'game:snapshot')
        state.game = gameSnapshotSchema.parse(value);
      if (event === 'room:session')
        state.token = roomSessionSchema.parse(value).reconnectToken;
      if (event === 'chat:message') state.chat++;
    }),
  );
  return { page, state };
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test('localized controls, keyboard, sound, chat and private gameplay', async ({
  browser,
}, info) => {
  const contexts: BrowserContext[] = [];
  const players: ReturnType<typeof observe>[] = [];
  const errors: string[] = [];
  try {
    for (let index = 0; index < 5; index++) {
      const context = await browser.newContext({
        baseURL: 'http://127.0.0.1:4173',
        viewport: info.project.use.viewport ?? { width: 1440, height: 1000 },
        isMobile: info.project.use.isMobile ?? false,
        hasTouch: info.project.use.hasTouch ?? false,
        reducedMotion: 'reduce',
      });
      contexts.push(context);
      const page = await context.newPage();
      page.on('pageerror', () => errors.push('Browser runtime error'));
      players.push(observe(page));
    }
    const host = players[0]!.page;
    await host.goto('/');
    await host.keyboard.press('Tab');
    await expect(
      host.getByRole('link', { name: 'Skip to game' }),
    ).toBeFocused();
    await host.keyboard.press('Tab');
    await host.keyboard.press('Tab');
    await expect(host.getByRole('combobox')).toBeFocused();
    expect(
      await host
        .getByRole('combobox')
        .evaluate((node) => getComputedStyle(node).outlineStyle),
    ).not.toBe('none');
    await host.getByRole('combobox').selectOption('ru');
    await expect(
      host.getByRole('heading', { name: 'Занимайте место' }),
    ).toBeVisible();
    await noOverflow(host);
    await host.getByRole('combobox').selectOption('az');
    await expect(
      host.getByRole('heading', { name: 'Yerini tut' }),
    ).toBeVisible();
    await host.reload();
    await expect(host.getByRole('combobox')).toHaveValue('az');
    await host.getByRole('combobox').selectOption('en');
    const sound = host.getByRole('button', { name: 'Enable sound' });
    await expect(sound).toHaveAttribute('aria-pressed', 'false');
    await sound.focus();
    await host.keyboard.press('Enter');
    await expect(
      host.getByRole('button', { name: 'Mute sound' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await host.getByRole('button', { name: 'Mute sound' }).click();
    expect(
      await host.evaluate(() => localStorage.getItem('domino101.sound')),
    ).toBe('off');
    await host.getByLabel('Your display name').fill('Əli');
    await host.getByRole('button', { name: 'Create a private room' }).click();
    await expect(host).toHaveURL(/\/room\/[a-f0-9]{32}$/);
    const url = host.url();
    for (let index = 1; index < 4; index++) {
      const page = players[index]!.page;
      await page.goto(url);
      await page
        .getByLabel('Your display name')
        .fill(['Əli', 'Murad', 'Leyla', 'Rauf'][index]!);
      await page
        .getByRole('button', { name: 'Join room', exact: true })
        .click();
      await expect(page.getByText('Room code', { exact: true })).toBeVisible();
    }
    const outsider = players[4]!.page;
    await outsider.goto('/');
    await outsider.getByLabel('Your display name').fill('Another room');
    await outsider
      .getByRole('button', { name: 'Create a private room' })
      .click();
    await expect(outsider).toHaveURL(/\/room\/[a-f0-9]{32}$/);
    const chat = host.getByRole('button', { name: /Room chat/ });
    await chat.focus();
    await host.keyboard.press('Enter');
    await expect(chat).toHaveAttribute('aria-expanded', 'true');
    const text = '<img src=x onerror=alert(1)> ' + 'x'.repeat(350);
    await host.getByRole('textbox', { name: 'Chat message' }).fill(text);
    await host.getByRole('textbox', { name: 'Chat message' }).press('Enter');
    await expect(host.locator('.chat-message p')).toHaveText(text);
    await expect(host.locator('.chat-message img')).toHaveCount(0);
    await expect(host.locator('.chat-message time')).toHaveText(/\d/);
    await noOverflow(host);
    await host.screenshot({
      path: `test-results/phase7-chat-${info.project.name}.png`,
      fullPage: true,
    });
    const peer = players[1]!.page;
    await expect(peer.getByLabel('1 unread messages')).toBeVisible();
    await peer.getByRole('button', { name: /Room chat/ }).click();
    await expect(peer.getByLabel('1 unread messages')).toHaveCount(0);
    await expect(peer.locator('.chat-message p')).toHaveText(text);
    await host.getByRole('button', { name: 'Send fire' }).click();
    await expect(peer.locator('.reaction-status')).toHaveText(
      'Əli reacted fire',
    );
    await expect.poll(() => players[4]!.state.chat).toBe(0);
    await peer.reload();
    await expect(peer.getByRole('button', { name: /Room chat/ })).toBeVisible();
    await peer.getByRole('button', { name: /Room chat/ }).click();
    await expect(peer.locator('.chat-message p')).toHaveText(text);
    await expect(
      host.getByRole('button', { name: 'Start match' }),
    ).toBeEnabled();
    await host
      .getByRole('textbox', { name: 'Chat message' })
      .fill('Unsent lobby draft');
    await host.getByRole('button', { name: 'Start match' }).click();
    await expect(
      host.getByRole('textbox', { name: 'Chat message' }),
    ).toHaveValue('Unsent lobby draft');
    for (const player of players.slice(0, 4)) {
      const hand = player.page.getByRole('region', { name: 'Your hand' });
      await expect(hand.getByRole('button')).toHaveCount(7);
      for (const tile of await hand.getByRole('button').all()) {
        const box = await tile.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      await noOverflow(player.page);
    }
    const peerToggle = peer.getByRole('button', { name: /Room chat/ });
    if ((await peerToggle.getAttribute('aria-expanded')) === 'false')
      await peerToggle.click();
    const actor = players
      .slice(0, 4)
      .find(
        (player) => player.state.game?.public.turn === player.state.game?.seat,
      )!;
    await expect(
      actor.page.getByRole('heading', { name: 'Your turn', exact: true }),
    ).toBeVisible();
    await expect(
      actor.page.getByRole('status', { name: 'Table updates' }),
    ).toHaveText('Your turn');
    const action = actor.state.game!.private.legalActions[0]!;
    if (action.type !== 'play')
      throw new Error('Expected a playable first tile');
    const button = actor.page.getByRole('button', {
      name: `Play ${action.tile}`,
      exact: true,
    });
    await button.focus();
    expect(
      await button.evaluate((node) => getComputedStyle(node).outlineStyle),
    ).toBe('solid');
    expect(
      await button.evaluate(
        (node) => getComputedStyle(node).transitionDuration,
      ),
    ).toBe('0s');
    await actor.page.keyboard.press('Enter');
    await expect.poll(() => actor.state.game?.private.hand.length).toBe(6);
    const hostToggle = host.getByRole('button', { name: /Room chat/ });
    if ((await hostToggle.getAttribute('aria-expanded')) === 'false')
      await hostToggle.click();
    await host.getByRole('textbox', { name: 'Chat message' }).fill('Good game');
    await host.getByRole('textbox', { name: 'Chat message' }).press('Enter');
    await expect(peer.locator('.chat-message p').last()).toHaveText(
      'Good game',
    );
    await hostToggle.click();
    await expect(
      host.getByRole('textbox', { name: 'Chat message' }),
    ).toHaveCount(0);
    for (const locale of ['ru', 'az', 'en']) {
      await host.getByRole('combobox').selectOption(locale);
      await noOverflow(host);
    }
    const tokens = players
      .map((p) => p.state.token)
      .filter((value): value is string => value !== null);
    for (const [index, player] of players.slice(0, 4).entries()) {
      const html = await player.page.locator('body').innerHTML();
      expect(tokens.some((token) => html.includes(token))).toBe(false);
      expect(html.includes('reconnectToken')).toBe(false);
      const hidden = players
        .slice(0, 4)
        .filter((_, other) => other !== index)
        .flatMap((p) => p.state.game!.private.hand);
      expect(
        hidden.some(
          (tile) =>
            html.includes(`Play ${tile}`) ||
            html.includes(`tile-state-${tile.replace(':', '-')}`),
        ),
      ).toBe(false);
    }
    if (info.project.name === 'phone') {
      await host.setViewportSize({ width: 320, height: 700 });
      await host.getByRole('combobox').selectOption('ru');
      await noOverflow(host);
      await host.setViewportSize({ width: 851, height: 393 });
      await noOverflow(host);
      await host.screenshot({
        path: `test-results/phase7-phone-landscape.png`,
        fullPage: true,
      });
      await host.setViewportSize({ width: 393, height: 851 });
    }
    await host.screenshot({
      path: `test-results/phase7-${info.project.name}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
