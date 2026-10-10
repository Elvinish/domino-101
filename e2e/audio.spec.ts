import { expect, test } from '@playwright/test';
import { gameSnapshotSchema } from '../packages/protocol/src/index';
import type { GameSnapshot } from '../packages/protocol/src/index';
import { openMenu, closeMenu } from './panels';

test('serves five short normalized recorded domino placement cues', async ({
  request,
}) => {
  for (const file of [1, 2, 3, 4, 5]) {
    const response = await request.get(`/audio/domino/placement-0${file}.wav`);
    expect(response.ok()).toBe(true);
    const bytes = await response.body();
    expect(bytes.length).toBeLessThan(100_000);
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');
    expect(bytes.readUInt16LE(20)).toBe(1); // PCM
    const channels = bytes.readUInt16LE(22);
    const sampleRate = bytes.readUInt32LE(24);
    const bitsPerSample = bytes.readUInt16LE(34);
    const dataLength = bytes.readUInt32LE(40);
    expect(channels).toBe(2);
    expect(sampleRate).toBe(44_100);
    expect(bitsPerSample).toBe(16);
    const duration = dataLength / (channels * (bitsPerSample / 8) * sampleRate);
    expect(duration).toBeGreaterThanOrEqual(0.1);
    expect(duration).toBeLessThan(0.35);
    let peak = 0;
    for (let offset = 44; offset < 44 + dataLength; offset += 2)
      peak = Math.max(peak, Math.abs(bytes.readInt16LE(offset)) / 32768);
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThan(0.61);
  }
});

async function playTile(
  page: import('@playwright/test').Page,
  game: GameSnapshot,
) {
  const action = game.private.legalActions.find(
    (candidate) => candidate.type === 'play',
  );
  if (action?.type !== 'play')
    throw new Error('Expected a legal tile placement');
  await page
    .getByRole('button', { name: `Play ${action.tile}`, exact: true })
    .click();
  if (
    game.private.legalActions.filter(
      (candidate) =>
        candidate.type === 'play' && candidate.tile === action.tile,
    ).length > 1
  )
    await page
      .getByRole('button', {
        name: action.end === 'left' ? '← Left end' : 'Right end →',
        exact: true,
      })
      .click();
}
async function passUntilPlayable(
  page: import('@playwright/test').Page,
  snapshot: () => GameSnapshot | null,
) {
  for (let step = 0; step < 20; step++) {
    const game = snapshot();
    if (!game) throw new Error('Expected a game snapshot');
    if (
      game.public.turn === game.seat &&
      game.private.legalActions.some((candidate) => candidate.type === 'play')
    )
      return game;
    if (
      game.public.turn === game.seat &&
      game.private.legalActions.some((candidate) => candidate.type === 'pass')
    ) {
      const revision = game.revision;
      await page.getByRole('button', { name: 'Pass', exact: true }).click();
      await expect
        .poll(() => (snapshot()?.revision ?? revision) > revision)
        .toBe(true);
    } else {
      const revision = game.revision;
      await expect
        .poll(() => (snapshot()?.revision ?? revision) > revision, {
          timeout: 20_000,
        })
        .toBe(true);
    }
  }
  throw new Error('The bot match did not reach a playable human turn');
}

test('placement sound observes new bot and human moves once and reconnect stays silent', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const prototype = HTMLAudioElement.prototype;
    prototype.play = function () {
      if (!this.muted) {
        const count = Number(sessionStorage.getItem('placementPlayCount') ?? 0);
        sessionStorage.setItem('placementPlayCount', String(count + 1));
      }
      return Promise.resolve();
    };
  });
  let latest: GameSnapshot | null = null;
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      const frame = payload.toString();
      if (!frame.startsWith('42')) return;
      const [event, value] = JSON.parse(frame.slice(frame.indexOf('['))) as [
        string,
        unknown,
      ];
      if (event === 'game:snapshot') latest = gameSnapshotSchema.parse(value);
    }),
  );
  await page.goto('/');
  await page.getByLabel('Your display name').fill('Sound test');
  await page.getByRole('button', { name: 'Enable sound' }).click();
  await page.getByRole('button', { name: 'Create a private room' }).click();
  await page.getByRole('button', { name: 'Fill empty seats' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.getByRole('region', { name: 'Your hand' })).toBeVisible();
  await expect.poll(() => latest !== null).toBe(true);
  if (latest!.public.board.length === 0 && latest!.public.turn === latest!.seat)
    await playTile(page, latest!);
  await expect.poll(() => latest?.public.board.length ?? 0).toBeGreaterThan(0);
  await expect
    .poll(() => Boolean(latest && latest.public.turn === latest.seat))
    .toBe(true);
  const count = () =>
    page.evaluate(() =>
      Number(sessionStorage.getItem('placementPlayCount') ?? 0),
    );
  const beforeRender = await count();
  expect(beforeRender).toBeGreaterThan(0);
  await openMenu(page);
  await page.getByRole('combobox').selectOption('ru');
  await expect.poll(count).toBe(beforeRender);
  await page.getByRole('combobox').selectOption('en');
  await closeMenu(page);
  latest = null;
  await page.reload();
  await expect(page.getByRole('region', { name: 'Your hand' })).toBeVisible();
  await expect.poll(() => latest !== null).toBe(true);
  await expect.poll(count).toBe(beforeRender);
  const game = await passUntilPlayable(page, () => latest);
  const beforeMove = await count();
  await playTile(page, game);
  await expect.poll(count).toBe(beforeMove + 1);
});
