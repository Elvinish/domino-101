import type { PublicGame } from '@domino/protocol';

export type SoundCue =
  'your-turn' | 'tile-placed' | 'round-result' | 'match-result';
export const soundKey = 'domino101.sound';
export interface SoundView {
  matchId: string;
  revision: number;
  seat: number;
  paused: boolean;
  public: PublicGame;
}
/** Reads only public projections; reconnect snapshots establish a silent baseline. */
export class CueTracker {
  private previous: SoundView | null = null;
  next(view: SoundView | null): SoundCue | null {
    const previous = this.previous;
    if (!view || !previous || view.matchId !== previous.matchId) {
      this.previous = view;
      return null;
    }
    if (view.revision <= previous.revision) return null;
    this.previous = view;
    if (view.paused || previous.paused) return null;
    if (
      view.public.phase === 'match-finished' &&
      previous.public.phase !== 'match-finished'
    )
      return 'match-result';
    if (
      view.public.phase === 'round-ended' &&
      previous.public.phase !== 'round-ended'
    )
      return 'round-result';
    if (
      view.public.roundNumber === previous.public.roundNumber &&
      view.public.board.length > previous.public.board.length
    )
      return 'tile-placed';
    if (
      view.public.phase === 'playing' &&
      view.public.turn === view.seat &&
      (previous.public.turn !== view.seat ||
        previous.public.phase !== 'playing')
    )
      return 'your-turn';
    return null;
  }
}
const tones: Record<SoundCue, readonly number[]> = {
  'your-turn': [440, 587],
  'tile-placed': [280],
  'round-result': [392, 494],
  'match-result': [392, 494, 587],
};
export const placementSamples = [
  '/audio/domino/placement-01.wav',
  '/audio/domino/placement-02.wav',
  '/audio/domino/placement-03.wav',
  '/audio/domino/placement-04.wav',
  '/audio/domino/placement-05.wav',
] as const;
type PlacementAudio = Pick<HTMLAudioElement, 'play' | 'pause'> & {
  src: string;
  volume: number;
  playbackRate: number;
  currentTime: number;
  muted: boolean;
};
export class SoundService {
  private context: AudioContext | null = null;
  private voices = new Set<{ oscillator: OscillatorNode; gain: GainNode }>();
  private listeners = new Set<() => void>();
  private tracker = new CueTracker();
  private placementVoices: PlacementAudio[] = [];
  private placementIndex = 0;
  private placementPrimed = false;
  private state: { enabled: boolean; unavailable: boolean };
  constructor(
    private readonly makeContext: () => AudioContext = () => new AudioContext(),
    private readonly storage: () => Storage = () => localStorage,
    private readonly makePlacementAudio: (src: string) => PlacementAudio = (
      src,
    ) => new Audio(src),
    private readonly random: () => number = Math.random,
  ) {
    let enabled = false;
    try {
      enabled = storage().getItem(soundKey) === 'on';
    } catch {
      /* Optional preference. */
    }
    this.state = { enabled, unavailable: false };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  /** Call only from a user click/key gesture, never from mount or a socket event. */
  unlock = () => {
    if (!this.state.enabled || this.context?.state === 'running') return;
    try {
      const context = this.context ?? this.makeContext();
      this.context = context;
      this.primePlacementAudio();
      void context.resume().catch(() => {
        if (this.context === context) this.update({ unavailable: true });
      });
    } catch {
      this.update({ unavailable: true });
    }
  };
  toggle = () => {
    const enabled = !this.state.enabled;
    this.update({ enabled, unavailable: false });
    try {
      this.storage().setItem(soundKey, enabled ? 'on' : 'off');
    } catch {
      /* Remains usable in this tab. */
    }
    if (enabled) this.unlock();
    else this.closeAudio();
  };
  observe = (view: SoundView | null) => {
    const cue = this.tracker.next(view);
    if (cue) this.play(cue);
  };
  play(cue: SoundCue) {
    if (cue === 'tile-placed') {
      this.playPlacement();
      return;
    }
    const context = this.context;
    if (!this.state.enabled || !context || context.state !== 'running') return;
    try {
      tones[cue].forEach((frequency, index) => {
        const oscillator = context.createOscillator(),
          gain = context.createGain();
        const start = context.currentTime + index * 0.085;
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.045, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.075);
        oscillator.connect(gain);
        gain.connect(context.destination);
        const voice = { oscillator, gain };
        this.voices.add(voice);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
          this.voices.delete(voice);
        };
        oscillator.start(start);
        oscillator.stop(start + 0.08);
      });
    } catch {
      this.closeAudio();
      this.update({ unavailable: true });
    }
  }
  private playPlacement() {
    if (!this.state.enabled) return;
    try {
      if (!this.placementVoices.length)
        this.placementVoices = placementSamples.map(this.makePlacementAudio);
      const voice =
        this.placementVoices[
          this.placementIndex++ % this.placementVoices.length
        ]!;
      const pick = this.random();
      voice.volume = 0.16 * (0.9 + pick * 0.2);
      voice.playbackRate = 0.98 + this.random() * 0.04;
      voice.currentTime = 0;
      void voice.play().catch(() => this.update({ unavailable: true }));
    } catch {
      this.update({ unavailable: true });
    }
  }
  private primePlacementAudio() {
    if (this.placementPrimed) return;
    try {
      if (!this.placementVoices.length)
        this.placementVoices = placementSamples.map(this.makePlacementAudio);
      this.placementVoices.forEach((voice) => {
        // Prime each exact element during a user gesture so later socket-driven
        // placements can play without asking for another interaction.
        voice.muted = true;
        void voice.play().catch(() => {});
        voice.pause();
        voice.currentTime = 0;
        voice.muted = false;
      });
      this.placementPrimed = true;
    } catch {
      this.update({ unavailable: true });
    }
  }
  private closeAudio() {
    for (const { oscillator, gain } of this.voices) {
      oscillator.onended = null;
      try {
        oscillator.stop();
      } catch {
        /* Already ended. */
      }
      oscillator.disconnect();
      gain.disconnect();
    }
    this.voices.clear();
    for (const voice of this.placementVoices) {
      voice.pause();
      voice.currentTime = 0;
    }
    this.placementVoices = [];
    this.placementIndex = 0;
    this.placementPrimed = false;
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
  }
  dispose = () => {
    this.closeAudio();
    this.tracker = new CueTracker();
  };
}
