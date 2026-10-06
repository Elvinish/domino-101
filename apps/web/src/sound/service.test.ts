import { describe, expect, it, vi } from 'vitest';
import {
  CueTracker,
  placementSamples,
  SoundService,
  soundKey,
} from './service';
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
    sound.play('your-turn');
    expect(localStorage.getItem(soundKey)).toBe('on');
    expect(audio.context.createOscillator).toHaveBeenCalledTimes(2);
    sound.toggle();
    sound.play('your-turn');
    expect(audio.oscillator.stop).toHaveBeenCalled();
    expect(audio.oscillator.disconnect).toHaveBeenCalled();
    expect(audio.gain.disconnect).toHaveBeenCalled();
    expect(audio.context.close).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(soundKey)).toBe('off');
    expect(audio.context.createOscillator).toHaveBeenCalledTimes(2);
  });
  it('plays rotating recorded-placement assets with subtle rate and level variation', () => {
    localStorage.setItem(soundKey, 'on');
    const clips = placementSamples.map(() => ({
      src: '',
      volume: 1,
      playbackRate: 1,
      currentTime: 0,
      muted: false,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
    }));
    const makeClip = vi.fn((src: string) => {
      const index = placementSamples.indexOf(
        src as (typeof placementSamples)[number],
      );
      return clips[index]!;
    });
    const values = [0, 1, 0.5, 0.5];
    const sound = new SoundService(
      () => fakeAudio().context as unknown as AudioContext,
      () => localStorage,
      makeClip,
      () => values.shift() ?? 0.5,
    );
    sound.unlock();
    sound.play('tile-placed');
    sound.play('tile-placed');
    expect(makeClip).toHaveBeenCalledTimes(placementSamples.length);
    expect(clips[0]!.play).toHaveBeenCalledTimes(2);
    expect(clips[1]!.play).toHaveBeenCalledTimes(2);
    expect(clips[0]!.volume).toBeCloseTo(0.144);
    expect(clips[0]!.playbackRate).toBeCloseTo(1.02);
    sound.toggle();
    expect(clips[0]!.pause).toHaveBeenCalledTimes(2);
    expect(clips[0]!.currentTime).toBe(0);
    sound.dispose();
  });
  it('keeps placement silent while muted and exposes unavailable media gracefully', async () => {
    const mutedFactory = vi.fn((src: string) => ({
      src,
      volume: 1,
      playbackRate: 1,
      currentTime: 0,
      muted: false,
      play: vi.fn().mockRejectedValue(new Error('missing audio')),
      pause: vi.fn(),
    }));
    const muted = new SoundService(undefined, undefined, mutedFactory);
    muted.play('tile-placed');
    expect(mutedFactory).not.toHaveBeenCalled();
    muted.toggle();
    muted.unlock();
    muted.play('tile-placed');
    await Promise.resolve();
    expect(muted.getSnapshot().unavailable).toBe(true);
    muted.dispose();
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
  it('cues once for each bot or remote placement and stays silent on reconnect baselines', () => {
    const tracker = new CueTracker();
    const baseline = view(10);
    tracker.next(baseline);
    const remoteMove = structuredClone(baseline);
    remoteMove.revision++;
    remoteMove.public.turn = 1;
    remoteMove.public.board = [{ tile: '1:2', left: 1, right: 2 }];
    expect(tracker.next(remoteMove)).toBe('tile-placed');
    expect(tracker.next(structuredClone(remoteMove))).toBeNull();
    const botMove = structuredClone(remoteMove);
    botMove.revision++;
    botMove.public.turn = 2;
    botMove.public.board.push({ tile: '2:3', left: 2, right: 3 });
    expect(tracker.next(botMove)).toBe('tile-placed');

    const reconnected = new CueTracker();
    expect(reconnected.next(botMove)).toBeNull();
    expect(reconnected.next(structuredClone(botMove))).toBeNull();
  });
});
