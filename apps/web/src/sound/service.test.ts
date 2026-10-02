import { describe, expect, it, vi } from 'vitest';
import { CueTracker, SoundService, soundKey } from './service';
import type { SoundView } from './service';
import { gameFixture } from '../test/multiplayer';

function view(revision = 5): SoundView {
  const game = gameFixture();
  return {
    matchId: game.matchId,
    revision,
    seat: 0,
    paused: false,
    public: game.public,
  };
}
function fakeAudio() {
  const oscillator = {
    frequency: { value: 0 },
    type: 'sine',
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null,
  };
  const gain = {
    gain: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const context = {
    state: 'running',
    currentTime: 1,
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createOscillator: vi.fn(() => ({ ...oscillator })),
    createGain: vi.fn(() => ({ ...gain })),
  };
  const factory = vi.fn(() => context as unknown as AudioContext);
  return { context, factory, oscillator, gain };
}
describe('gesture-activated sound service', () => {
  it('starts muted and never allocates audio on mount or server updates', () => {
    const audio = fakeAudio();
    const sound = new SoundService(audio.factory);
    sound.observe(view());
    sound.play('your-turn');
    sound.unlock();
    expect(sound.getSnapshot().enabled).toBe(false);
    expect(audio.factory).not.toHaveBeenCalled();
  });
  it('enables, persists, mutes, stops nodes and closes its context', () => {
    const audio = fakeAudio();
    const sound = new SoundService(audio.factory);
    sound.toggle();
    sound.play('tile-placed');
    expect(localStorage.getItem(soundKey)).toBe('on');
    expect(audio.context.createOscillator).toHaveBeenCalledTimes(1);
    sound.toggle();
    sound.play('tile-placed');
    expect(audio.oscillator.stop).toHaveBeenCalled();
    expect(audio.oscillator.disconnect).toHaveBeenCalled();
    expect(audio.gain.disconnect).toHaveBeenCalled();
    expect(audio.context.close).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(soundKey)).toBe('off');
    expect(audio.context.createOscillator).toHaveBeenCalledTimes(1);
  });
  it('restores opt-in but requires a gesture to unlock each new page', () => {
    localStorage.setItem(soundKey, 'on');
    const audio = fakeAudio();
    const sound = new SoundService(audio.factory);
    expect(sound.getSnapshot().enabled).toBe(true);
    sound.play('round-result');
    expect(audio.factory).not.toHaveBeenCalled();
    sound.unlock();
    sound.play('round-result');
    expect(audio.context.createOscillator).toHaveBeenCalledTimes(2);
    sound.dispose();
    expect(audio.context.close).toHaveBeenCalledTimes(1);
  });
  it('handles unavailable APIs, denied storage and rejected resume without throwing', async () => {
    const sound = new SoundService(
      () => {
        throw new Error('No audio');
      },
      () => {
        throw new Error('No storage');
      },
    );
    expect(() => sound.toggle()).not.toThrow();
    expect(sound.getSnapshot().unavailable).toBe(true);
    const audio = fakeAudio();
    audio.context.resume.mockRejectedValueOnce(new Error('denied'));
    const denied = new SoundService(audio.factory);
    denied.toggle();
    await Promise.resolve();
    expect(denied.getSnapshot().unavailable).toBe(true);
    denied.dispose();
  });
  it('does not replay cues for duplicate/old snapshots or reconnect baselines', () => {
    const tracker = new CueTracker();
    const initial = view();
    initial.public.turn = 1;
    expect(tracker.next(initial)).toBeNull();
    const next = view(6);
    expect(tracker.next(next)).toBe('your-turn');
    expect(tracker.next(structuredClone(next))).toBeNull();
    expect(tracker.next(initial)).toBeNull();
    expect(tracker.next(null)).toBeNull();
    expect(tracker.next(next)).toBeNull();
    const paused = view(7);
    paused.paused = true;
    expect(tracker.next(paused)).toBeNull();
    expect(tracker.next(view(8))).toBeNull();
  });
  it('chooses one semantic cue per update, with result priority', () => {
    const tracker = new CueTracker();
    tracker.next(view());
    const placed = view(6);
    placed.public.turn = 1;
    placed.public.board = [{ tile: '1:1', left: 1, right: 1 }];
    expect(tracker.next(placed)).toBe('tile-placed');
    const round = view(7);
    round.public.phase = 'round-ended';
    expect(tracker.next(round)).toBe('round-result');
    const match = view(8);
    match.public.phase = 'match-finished';
    expect(tracker.next(match)).toBe('match-result');
    expect(tracker.next({ ...match, revision: 9 })).toBeNull();
  });
});
