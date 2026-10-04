import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { VoicePanel, RemoteAudio } from './VoicePanel';
import { I18nProvider } from '../i18n/Provider';
import { fakeVoice, fakeStream } from '../test/voice';
import { own, roomFixture } from '../test/multiplayer';

const voices: ReturnType<typeof fakeVoice>[] = [];
afterEach(() => {
  voices.splice(0).forEach((value) => value.voice.unbind());
  vi.restoreAllMocks();
});
function setup() {
  const f = fakeVoice();
  voices.push(f);
  const rendered = render(
    <I18nProvider>
      <VoicePanel
        voice={f.voice}
        room={roomFixture()}
        own={own}
        disabled={false}
      />
    </I18nProvider>,
  );
  return { ...f, ...rendered };
}
it.each([
  ['en', 'Voice chat', 'Enable microphone'],
  ['ru', 'Голосовой чат', 'Включить микрофон'],
  ['az', 'Səsli söhbət', 'Mikrofonu aktiv et'],
])(
  'renders localized opt-in controls in %s without requesting media',
  (locale, title, enable) => {
    localStorage.setItem('domino101.language', locale!);
    const f = setup();
    expect(screen.getByRole('region', { name: title })).toBeVisible();
    expect(screen.getByRole('button', { name: enable })).toBeEnabled();
    expect(f.media.getUserMedia).not.toHaveBeenCalled();
  },
);
it('renders microphone/mute state, semantic controls and stops media when the panel unmounts', async () => {
  const f = setup();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Enable microphone' }));
  });
  expect(
    screen.getByRole('button', { name: 'Mute microphone' }),
  ).toHaveAttribute('aria-pressed', 'false');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }));
  });
  expect(f.local.track.enabled).toBe(false);
  expect(
    screen.getByRole('button', { name: 'Unmute microphone' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Unmute microphone' }));
  });
  expect(f.local.track.enabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Leave voice' }));
  expect(
    screen.getByRole('button', { name: 'Enable microphone' }),
  ).toBeEnabled();
  expect(f.local.track.stop).toHaveBeenCalledTimes(1);
  f.media.getUserMedia.mockResolvedValue(fakeStream().stream);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Enable microphone' }));
  });
  f.unmount();
  expect(f.voice.getSnapshot().status).toBe('off');
});
it('shows safe permission errors while leaving the enable control available', async () => {
  const f = setup();
  f.media.getUserMedia.mockRejectedValue(
    new DOMException('private details', 'NotAllowedError'),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Enable microphone' }));
  });
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Microphone permission denied',
  );
  expect(screen.getByRole('alert')).not.toHaveTextContent('private details');
  expect(
    screen.getByRole('button', { name: 'Enable microphone' }),
  ).toBeEnabled();
});
it('attaches exactly one remote audio output, offers an autoplay recovery button and detaches on cleanup', async () => {
  const stream = fakeStream().stream;
  const play = vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockRejectedValueOnce(new DOMException('', 'NotAllowedError'))
    .mockResolvedValue(undefined);
  const pause = vi
    .spyOn(HTMLMediaElement.prototype, 'pause')
    .mockImplementation(() => {});
  const { container, unmount, rerender } = render(
    <I18nProvider>
      <RemoteAudio stream={stream} name="Murad" />
    </I18nProvider>,
  );
  expect(
    await screen.findByRole('button', { name: 'Play voice audio from Murad' }),
  ).toBeVisible();
  const audio = container.querySelector('audio')!;
  expect(audio.srcObject).toBe(stream);
  await act(async () => {
    fireEvent.click(within(container).getByRole('button'));
  });
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  rerender(
    <I18nProvider>
      <RemoteAudio stream={stream} name="Murad" />
    </I18nProvider>,
  );
  expect(container.querySelectorAll('audio')).toHaveLength(1);
  expect(play).toHaveBeenCalledTimes(2);
  unmount();
  expect(audio.srcObject).toBeNull();
  expect(pause).toHaveBeenCalledTimes(1);
});
