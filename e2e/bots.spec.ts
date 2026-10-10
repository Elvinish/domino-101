import { expect, test } from '@playwright/test';
import { expectChainFits } from './chain-checks';
import { expectHandsReachSceneEdges } from './hand-checks';
import {
  gameSnapshotSchema,
  roomSnapshotSchema,
  findBotPersona,
} from '../packages/protocol/src/index';
import type { GameSnapshot } from '../packages/protocol/src/index';

test('one human fills bot seats and plays a real round while bots respond', async ({
  page,
}, info) => {
  let latest: GameSnapshot | null = null;
  const errors: string[] = [];
  let sessions = 0;
  let names: string[] = [];
  const handRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/images\/lounge\/(?:hands?-|player-top-).*\.png/.test(request.url()))
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
      if (event === 'room:snapshot')
        names = roomSnapshotSchema
          .parse(data)
          .seats.flatMap((player) => (player ? [player.displayName] : []));
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
    .getByRole('button', { name: 'Add player', exact: true })
    .first()
    .click();
  await expect(page.getByRole('button', { name: 'Remove player' })).toHaveCount(
    1,
  );
  await page.getByRole('button', { name: 'Remove player' }).click();
  await page.getByRole('button', { name: 'Fill empty seats' }).click();
  await expect(page.getByRole('button', { name: 'Remove player' })).toHaveCount(
    3,
  );
  await expect(page.getByText('Ready', { exact: true })).toHaveCount(3);
  const assignedNames = [...names];
  await expect(page.locator('.persona-badge')).toHaveCount(3);
  expect(new Set(assignedNames).size).toBe(4);
  expect(
    assignedNames.every(
      (name) => !/Domino \d|\b(?:Bot|AI|NPC|Computer)\b/i.test(name),
    ),
  ).toBe(true);
  await noOverflow();
  // Entering a match must keep the same straight tabletop as the waiting room.
  const tableAppearance = () =>
    page.locator('.physical-table').evaluate((table) => {
      const surface = getComputedStyle(table);
      const scene = getComputedStyle(table.parentElement!);
      return {
        width: table.getBoundingClientRect().width,
        background: surface.backgroundImage,
        border: surface.border,
        shadow: surface.boxShadow,
        surfaceTransform: surface.transform,
        surfacePerspective: surface.perspective,
        sceneTransform: scene.transform,
        scenePerspective: scene.perspective,
      };
    });
  const lobbyAppearance = await tableAppearance();
  expect(lobbyAppearance).toMatchObject({
    background: expect.stringContaining('/images/lounge/walnut.png'),
    surfaceTransform: 'none',
    surfacePerspective: 'none',
    sceneTransform: 'none',
    scenePerspective: 'none',
  });
  await page.screenshot({
    path: `test-results/${info.project.name}-bot-lobby.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.getByRole('region', { name: 'Your hand' })).toBeVisible();
  await expect.poll(() => latest !== null).toBe(true);
  await expect(page.locator('.scene-player.is-active')).toHaveCount(1);
  await expect(page.locator('.held-set')).toHaveCount(4);
  for (let seat = 1; seat < 4; seat++) {
    const gender = findBotPersona(assignedNames[seat]!)!.gender;
    await expect(
      page.locator(`.scene-player[data-seat="${seat}"]`),
    ).toHaveAttribute('data-persona-gender', gender);
  }
  await expect(page.locator('.table-decor')).toHaveCount(1);
  await expect(page.locator('.table-decor-seat')).toHaveCount(4);
  const roomId = new URL(page.url()).pathname.split('/').pop()!;
  await expect(page.locator('.table-decor')).toHaveAttribute(
    'data-decor-seed',
    new RegExp(`^${roomId}\\|`),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page
      .locator('.held-set.is-active')
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe('none');
  expect(
    await page
      .locator('.table-decor-seat')
      .first()
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe('none');
  expect(
    await page
      .locator('.table-decor-seat')
      .first()
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const richScene = (info.project.use.viewport?.width ?? 1440) > 640;
  expect(await tableAppearance()).toEqual(lobbyAppearance);
  if (richScene) {
    await expectHandsReachSceneEdges(page);
    await expect
      .poll(() =>
        page
          .locator('.table-decor-seat.is-arriving')
          .evaluateAll((elements) =>
            elements
              .filter((element) => element.getClientRects().length > 0)
              .every((element) => getComputedStyle(element).opacity === '1'),
          ),
      )
      .toBe(true);
  }
  if (richScene) {
    await expect
      .poll(() =>
        page
          .locator('.grip-photo img')
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
  let checkedPassLayout = false;
  for (let step = 0; step < 80; step++) {
    const game = snapshot();
    if (
      game.public.phase === 'round-ended' ||
      game.public.phase === 'match-finished'
    )
      break;
    expect(game.public.revealedHands).toBeUndefined();
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
      } else if (action.type === 'pass') {
        const pass = page.getByRole('button', { name: 'Pass', exact: true });
        if (!checkedPassLayout) {
          const viewport = page.viewportSize()!;
          // A real, server-authorized pass stays available while checking reflow.
          for (const width of [320, 393, 640, 641, 820, 1100, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            await pass.scrollIntoViewIfNeeded();
            await expect(pass).toBeVisible();
            await pass.click({ trial: true });
            const layout = await pass.evaluate((button) => {
              const box = button.getBoundingClientRect();
              const obstacles = document.querySelectorAll(
                '.local-grip .grip-photo, .local-grip .hand-tile, .board, .seat',
              );
              return {
                touchSize: box.width >= 48 && box.height >= 48,
                inViewport: box.left >= 0 && box.right <= innerWidth,
                clear: Array.from(obstacles).every((element) => {
                  const other = element.getBoundingClientRect();
                  return (
                    other.width === 0 ||
                    other.height === 0 ||
                    box.right <= other.left ||
                    box.left >= other.right ||
                    box.bottom <= other.top ||
                    box.top >= other.bottom
                  );
                }),
              };
            });
            expect(layout, `Pass clearance at ${width}px`).toEqual({
              touchSize: true,
              inViewport: true,
              clear: true,
            });
            if ([393, 820, 1440].includes(width))
              await page.screenshot({
                path: `test-results/${info.project.name}-pass-${width}.png`,
              });
          }
          await page.setViewportSize(viewport);
          checkedPassLayout = true;
        }
        if (info.project.use.hasTouch) await pass.tap();
        else await pass.click();
      } else throw new Error('Unexpected action during first round');
      humanMoves++;
    }
    await expect.poll(() => snapshot().revision).toBeGreaterThan(game.revision);
  }
  expect(
    ['round-ended', 'match-finished'].includes(snapshot().public.phase),
  ).toBe(true);
  expect(humanMoves).toBeGreaterThan(0);
  const reveal = snapshot().public.revealedHands!;
  expect(reveal.map((hand) => hand.length)).toEqual(
    snapshot().public.handCounts,
  );
  for (const [seat, position] of ['bottom', 'left', 'top', 'right'].entries()) {
    if (seat === 0) continue;
    const faces = page.locator(`.scene-player--${position} .revealed-tile`);
    expect(
      await faces.evaluateAll((tiles) =>
        tiles.map((tile) => tile.getAttribute('aria-label')),
      ),
    ).toEqual(reveal[seat]);
    if (!richScene)
      await expect(
        page.locator(`.seat-${position} .seat-reveal .revealed-tile`),
      ).toHaveCount(reveal[seat]!.length);
  }
  expect(names).toEqual(assignedNames);
  expect(
    await page.locator('.revealed-tile .pip.filled').evaluateAll((pips) =>
      pips.every((pip) => {
        const dot = pip.getBoundingClientRect();
        if (!dot.width || !dot.height) return true;
        const tile = pip.closest('.domino')!.getBoundingClientRect();
        return (
          dot.left >= tile.left - 1 &&
          dot.right <= tile.right + 1 &&
          dot.top >= tile.top - 1 &&
          dot.bottom <= tile.bottom + 1
        );
      }),
    ),
  ).toBe(true);
  expect(snapshot().revision - initialRevision).toBeGreaterThan(humanMoves + 3);
  expect(sessions).toBe(1);
  expect(errors).toEqual([]);
  await noOverflow();
  await expectChainFits(page);
  if (richScene) {
    await expectHandsReachSceneEdges(page);
    const decoration = await page
      .locator('.physical-table')
      .evaluate((table) => {
        const board = table.querySelector('.board')!.getBoundingClientRect();
        const hands = Array.from(
          table.querySelectorAll('.scene-hand, .local-grip'),
        );
        return {
          nonInteractive: Array.from(
            table.querySelectorAll(
              '.scene-decoration, .table-decor, .table-decor-seat, .table-prop, .grip-layer, .grip-photo, .scene-prop',
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
          propsClear: Array.from(table.querySelectorAll('.table-prop')).every(
            (prop) => {
              if (!prop.getClientRects().length) return true;
              const box = prop.getBoundingClientRect();
              return Array.from(
                table.querySelectorAll(
                  '.board, .hand-tile, .hand-controls, .seat',
                ),
              ).every((content) => {
                const bounds = content.getBoundingClientRect();
                return (
                  box.right <= bounds.left ||
                  box.left >= bounds.right ||
                  box.bottom <= bounds.top ||
                  box.top >= bounds.bottom
                );
              });
            },
          ),
        };
      });
    expect(decoration.nonInteractive).toBe(true);
    expect(decoration.outsideChain).toBe(true);
    expect(
      decoration.propsClear,
      'Props never cover the chain, held tiles, controls or names',
    ).toBe(true);
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
    if (width > 640) await expectHandsReachSceneEdges(page);
  }
  latest = null;
  names = [];
  await page.reload();
  await expect(page.getByRole('region', { name: 'Your hand' })).toBeVisible();
  await expect.poll(() => latest !== null).toBe(true);
  expect(names).toEqual(assignedNames);
  expect(snapshot().public.revealedHands).toEqual(reveal);
});
