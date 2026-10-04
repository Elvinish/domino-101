import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

interface VoiceQA {
  calls: number;
  peers: RTCPeerConnection[];
  streams: MediaStream[];
  captureFailed: boolean;
}
declare global {
  interface Window {
    voiceQA: VoiceQA;
  }
}
const panel = (page: Page) =>
  page.getByRole('region', { name: 'Voice chat', exact: true });
async function stats(page: Page) {
  return page.evaluate(async () => {
    const qa = window.voiceQA;
    const active = qa.peers.filter((peer) => peer.connectionState !== 'closed');
    const inbound = await Promise.all(
      active.map(async (peer) => {
        let packets = 0;
        (await peer.getStats()).forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind === 'audio')
            packets += Number(report.packetsReceived ?? 0);
        });
        return packets;
      }),
    );
    return {
      calls: qa.calls,
      captureFailed: qa.captureFailed,
      active: active.length,
      connected: active.filter((peer) => peer.connectionState === 'connected')
        .length,
      receiving: inbound.filter((packets) => packets > 0).length,
      live: qa.streams
        .flatMap((stream) => stream.getTracks())
        .filter((track) => track.readyState === 'live').length,
      enabled: qa.streams
        .flatMap((stream) => stream.getAudioTracks())
        .filter((track) => track.readyState === 'live' && track.enabled).length,
      playing: Array.from(
        document.querySelectorAll<HTMLAudioElement>('.voice-panel audio'),
      ).filter((audio) => audio.srcObject && !audio.paused).length,
    };
  });
}
async function mediaConnected(page: Page, count = 1) {
  await expect.poll(async () => (await stats(page)).connected).toBe(count);
  await expect.poll(async () => (await stats(page)).receiving).toBe(count);
  await expect(panel(page).locator('audio')).toHaveCount(count);
  const playback = panel(page).getByRole('button', {
    name: /^Play voice audio from /,
  });
  for (const button of await playback.all()) await button.click();
  await expect.poll(async () => (await stats(page)).playing).toBe(count);
}

test('opt-in real audio mesh, mute, refresh cleanup and independent game/chat controls', async ({
  browser,
}, info) => {
  const contexts: BrowserContext[] = [],
    pages: Page[] = [];
  let errors = 0;
  const signalingErrors: string[] = [];
  info.annotations.push({
    type: 'audio-capture',
    description:
      process.env.DOMINO_E2E_SYNTHETIC_AUDIO === '1'
        ? 'Web Audio test source; native microphone capture unverified'
        : 'Chromium fake microphone',
  });
  try {
    for (let index = 0; index < 4; index++) {
      const context = await browser.newContext({
        baseURL: 'http://127.0.0.1:4173',
        viewport: info.project.use.viewport ?? { width: 1440, height: 1000 },
        isMobile: info.project.use.isMobile ?? false,
        hasTouch: info.project.use.hasTouch ?? false,
        permissions: ['microphone'],
      });
      contexts.push(context);
      // Native capture by default. Explicit fallback replaces only capture, never WebRTC or RTP.
      await context.addInitScript(
        ({ synthetic }) => {
          const qa: VoiceQA = {
            calls: 0,
            peers: [],
            streams: [],
            captureFailed: false,
          };
          window.voiceQA = qa;
          const acquire = navigator.mediaDevices.getUserMedia.bind(
            navigator.mediaDevices,
          );
          navigator.mediaDevices.getUserMedia = async (constraints) => {
            qa.calls++;
            const stream = await (async () => {
              if (!synthetic) return acquire(constraints);
              if (!constraints?.audio || constraints.video)
                throw new Error('Audio-only test capture required');
              const audio = new AudioContext();
              const source = audio.createOscillator();
              const destination = audio.createMediaStreamDestination();
              source.connect(destination);
              source.start();
              await audio.resume();
              const track = destination.stream.getAudioTracks()[0]!;
              const stop = track.stop.bind(track);
              track.stop = () => {
                stop();
                source.stop();
                void audio.close();
              };
              return destination.stream;
            })().catch((error: unknown) => {
              qa.captureFailed = true;
              throw error;
            });
            qa.streams.push(stream);
            return stream;
          };
          window.RTCPeerConnection = new Proxy(window.RTCPeerConnection, {
            construct(target, args: [RTCConfiguration?]) {
              const peer = new target(...args);
              qa.peers.push(peer);
              return peer;
            },
          });
        },
        { synthetic: process.env.DOMINO_E2E_SYNTHETIC_AUDIO === '1' },
      );
      const page = await context.newPage();
      page.on('pageerror', () => {
        errors++;
      });
      page.on('websocket', (socket) =>
        socket.on('framereceived', ({ payload }) => {
          const text = payload.toString();
          if (!text.startsWith('42') || text.indexOf('[') === -1) return;
          const [event, data] = JSON.parse(text.slice(text.indexOf('['))) as [
            string,
            { code?: string },
          ];
          if (event === 'server:error')
            signalingErrors.push(data.code ?? 'UNKNOWN');
        }),
      );
      pages.push(page);
    }
    const host = pages[0]!,
      guest = pages[1]!;
    await host.goto('/');
    await expect(host.getByText('Connected', { exact: true })).toBeVisible();
    await host.getByLabel('Your display name').fill('Voice host');
    await host.getByRole('button', { name: 'Create a private room' }).click();
    await expect(host).toHaveURL(/\/room\/[a-f0-9]{32}$/);
    for (const [index, page] of pages.slice(1).entries()) {
      await page.goto(host.url());
      await page
        .getByLabel('Your display name')
        .fill(`Voice guest ${index + 1}`);
      await page
        .getByRole('button', { name: 'Join room', exact: true })
        .click();
      await expect(panel(page)).toBeVisible();
    }
    for (const page of pages) {
      expect(await stats(page)).toMatchObject({ calls: 0, active: 0, live: 0 });
      await expect(panel(page).getByRole('status')).toHaveText(
        'Microphone off',
      );
      const button = panel(page).getByRole('button', {
        name: 'Enable microphone',
      });
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    for (const page of [host, guest]) {
      const button = panel(page).getByRole('button', {
        name: 'Enable microphone',
      });
      if (info.project.use.hasTouch) await button.tap();
      else await button.click();
      await expect
        .poll(async () => ({
          ...(await stats(page)),
          controls: await panel(page).getByRole('button').allTextContents(),
        }))
        .toMatchObject({
          controls: expect.arrayContaining(['Mute microphone', 'Leave voice']),
        });
    }
    for (const page of [host, guest]) await mediaConnected(page);
    await expect(
      panel(host).getByRole('listitem').filter({ hasText: 'Voice guest 1' }),
    ).toContainText('Connected');
    await expect(
      panel(guest).getByRole('listitem').filter({ hasText: 'Voice host' }),
    ).toContainText('Connected');
    await panel(host)
      .getByRole('button', { name: 'Mute microphone', exact: true })
      .click();
    expect(await stats(host)).toMatchObject({ calls: 1, enabled: 0, live: 1 });
    await expect(
      panel(guest).getByRole('listitem').filter({ hasText: 'Voice host' }),
    ).toContainText('Muted');
    await panel(host)
      .getByRole('button', { name: 'Unmute microphone', exact: true })
      .click();
    expect(await stats(host)).toMatchObject({ calls: 1, enabled: 1 });
    if (info.project.name === 'desktop') {
      for (const page of pages.slice(2))
        await panel(page)
          .getByRole('button', { name: 'Enable microphone' })
          .click();
      for (const page of pages) {
        await mediaConnected(page, 3);
        expect((await stats(page)).active).toBe(3);
      }
      for (const page of pages.slice(2))
        await panel(page).getByRole('button', { name: 'Leave voice' }).click();
      for (const page of [host, guest]) await mediaConnected(page);
    }
    await host.getByRole('button', { name: 'Start match' }).click();
    for (const page of pages)
      await expect(
        page.getByRole('region', { name: 'Your hand' }),
      ).toBeVisible();
    const revision = Number(
      await host.locator('.game').getAttribute('data-revision'),
    );
    for (const page of pages) {
      const legal = page
        .getByRole('button', { name: /^Play / })
        .and(page.locator('button:enabled'));
      if (await legal.count()) {
        await legal.first().click();
        const end = page.getByRole('button', {
          name: '← Left end',
          exact: true,
        });
        if (await end.isVisible()) await end.click();
        break;
      }
    }
    for (const page of pages)
      await expect(page.locator('.game')).toHaveAttribute(
        'data-revision',
        String(revision + 1),
      );
    for (const page of [host, guest])
      await page.getByRole('button', { name: /Room chat/ }).click();
    await host
      .getByRole('textbox', { name: 'Chat message' })
      .fill('Voice and chat work together');
    await host.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(
      guest.getByText('Voice and chat work together', { exact: true }),
    ).toBeVisible();
    await guest.reload();
    await expect(
      guest.getByRole('region', { name: 'Your hand' }),
    ).toBeVisible();
    await expect(
      panel(guest).getByRole('button', { name: 'Enable microphone' }),
    ).toBeEnabled();
    expect(await stats(guest)).toMatchObject({ calls: 0, live: 0, active: 0 });
    await expect.poll(async () => (await stats(host)).active).toBe(0);
    await expect(panel(host).locator('audio')).toHaveCount(0);
    await panel(guest)
      .getByRole('button', { name: 'Enable microphone' })
      .click();
    for (const page of [host, guest]) await mediaConnected(page);
    await expect(
      panel(host).getByText('Peer disconnected', { exact: true }),
    ).toHaveCount(0);
    await host.screenshot({
      path: `test-results/${info.project.name}-voice.png`,
      fullPage: true,
    });
    for (const page of pages)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    await panel(host).getByRole('button', { name: 'Leave voice' }).click();
    expect(await stats(host)).toMatchObject({ active: 0, live: 0, enabled: 0 });
    await expect.poll(async () => (await stats(guest)).active).toBe(0);
    await expect(panel(guest).locator('audio')).toHaveCount(0);
    await guest.getByRole('button', { name: /Room chat/ }).click();
    await guest
      .getByRole('textbox', { name: 'Chat message' })
      .fill('Still here after voice leave');
    await guest.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(
      host.getByText('Still here after voice leave', { exact: true }),
    ).toBeVisible();
    expect(errors).toBe(0);
    expect(signalingErrors).toEqual([]);
  } catch (error) {
    console.info(
      'Voice QA counters',
      await Promise.all(pages.map(stats)),
      'Signaling error codes',
      signalingErrors,
    );
    throw error;
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
