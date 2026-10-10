import { expect, type Page } from '@playwright/test';

/** Open the same controls through the phone HUD or the desktop inline panel. */
export async function openChat(page: Page) {
  if (await page.locator('.phone-game').count()) {
    if (!(await page.getByRole('dialog', { name: 'Room chat' }).isVisible()))
      await page
        .getByRole('button', { name: 'Room chat', exact: true })
        .click();
  } else {
    const toggle = page.getByRole('button', { name: /Room chat/ });
    if ((await toggle.getAttribute('aria-expanded')) === 'false')
      await toggle.click();
  }
  await expect(
    page.getByRole('textbox', { name: 'Chat message' }),
  ).toBeVisible();
}

export async function closeChat(page: Page) {
  if (await page.locator('.phone-game').count()) {
    await page
      .getByRole('dialog', { name: 'Room chat' })
      .getByRole('button', { name: 'Close panel' })
      .click();
  } else {
    await page.getByRole('button', { name: /Room chat/ }).click();
  }
}

export async function openMenu(page: Page) {
  if (await page.locator('.phone-game').count())
    await page.locator('.mobile-tool--settings').click();
}

export async function closeMenu(page: Page) {
  if (await page.locator('.phone-game').count())
    await page
      .locator(
        '.responsive-panel.is-mobile > dialog[open] .sheet-heading button',
      )
      .click();
}

export async function openVoice(page: Page) {
  if (await page.locator('.phone-game').count()) {
    if (await page.getByRole('dialog', { name: 'Voice chat' }).isVisible())
      return;
    const close = page.locator(
      '.responsive-panel.is-mobile > dialog[open] .sheet-heading button',
    );
    if (await close.isVisible()) await close.click();
    await page.getByRole('button', { name: 'Voice chat', exact: true }).click();
  }
}
