import { chooseCommand, getBotView } from '@domino/bot-player';
import type { GameAction } from '@domino/protocol';
import type { Room } from '../rooms/types.js';
import { roomReady } from '../rooms/types.js';

export const BOT_DELAY_MS = 650;
export interface BotClock {
  schedule(callback: () => void, delay: number): () => void;
}
const clock: BotClock = {
  schedule(callback, delay) {
    const timer = setTimeout(callback, delay);
    timer.unref();
    return () => clearTimeout(timer);
  },
};
export interface BotTurn {
  readonly roomId: string;
  readonly matchId: string;
  readonly revision: number;
  readonly playerId: string;
}
/** Decisions see only the existing bot view, never opponents' hands. */
export function botDecision(
  room: Room,
): { playerId: string; command: GameAction } | null {
  if (room.lifecycle !== 'playing' || !room.match || !roomReady(room))
    return null;
  for (const player of room.seats) {
    if (player?.kind !== 'bot') continue;
    const { command } = chooseCommand(
      getBotView(room.match.state, player.seat),
      'deterministic-first',
      0,
    );
    if (!command) continue;
    // Keep actor identity out of the normal game command, just as for human requests.
    const action: GameAction =
      command.type === 'play'
        ? { type: 'play', tile: command.tile, end: command.end }
        : command.type === 'pass'
          ? { type: 'pass' }
          : { type: 'select-starter', selected: command.selected };
    return { playerId: player.playerId, command: action };
  }
  return null;
}
/** At most one scheduled or in-flight turn per room. Timers retain IDs, not hands. */
export class BotScheduler {
  private readonly jobs = new Map<
    string,
    { turn: BotTurn; cancel: () => void; fired: boolean }
  >();
  constructor(
    private readonly submit: (turn: BotTurn) => Promise<void>,
    private readonly timer: BotClock = clock,
  ) {}
  sync(room: Room): void {
    const actor = botDecision(room);
    if (!actor || !room.match) {
      this.cancel(room.id);
      return;
    }
    const turn = {
      roomId: room.id,
      matchId: room.match.id,
      revision: room.revision,
      playerId: actor.playerId,
    };
    const old = this.jobs.get(room.id)?.turn;
    if (
      old?.revision === turn.revision &&
      old.matchId === turn.matchId &&
      old.playerId === turn.playerId
    )
      return;
    this.cancel(room.id);
    const job = { turn, cancel: () => {}, fired: false };
    this.jobs.set(room.id, job);
    job.cancel = this.timer.schedule(() => {
      if (this.jobs.get(room.id) !== job || job.fired) return;
      job.fired = true;
      // Keep the ticket until submission finishes: a rejected command must not retry itself forever.
      void this.submit(turn)
        .catch(() => undefined)
        .finally(() => {
          if (this.jobs.get(room.id) === job) this.jobs.delete(room.id);
        });
    }, BOT_DELAY_MS);
  }
  owns(turn: BotTurn): boolean {
    return this.jobs.get(turn.roomId)?.turn === turn;
  }
  cancel(roomId: string): void {
    this.jobs.get(roomId)?.cancel();
    this.jobs.delete(roomId);
  }
  close(): void {
    for (const roomId of this.jobs.keys()) this.cancel(roomId);
  }
}
