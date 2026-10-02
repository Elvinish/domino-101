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
      view.public.phase === 'playing' &&
      view.public.turn === view.seat &&
      (previous.public.turn !== view.seat ||
        previous.public.phase !== 'playing')
    )
      return 'your-turn';
    if (
      view.public.roundNumber === previous.public.roundNumber &&
      view.public.board.length > previous.public.board.length
    )
      return 'tile-placed';
    return null;
  }
}
const tones: Record<SoundCue, readonly number[]> = {
  'your-turn': [440, 587],
  'tile-placed': [280],
  'round-result': [392, 494],
  'match-result': [392, 494, 587],
};
export class SoundService {
  private context: AudioContext | null = null;
  private voices = new Set<{ oscillator: OscillatorNode; gain: GainNode }>();
  private listeners = new Set<() => void>();
  private tracker = new CueTracker();
  private state: { enabled: boolean; unavailable: boolean };
  constructor(
    private readonly makeContext: () => AudioContext = () => new AudioContext(),
    private readonly storage: () => Storage = () => localStorage,
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
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
  }
  dispose = () => {
    this.closeAudio();
    this.tracker = new CueTracker();
  };
}
