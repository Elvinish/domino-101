import type { BotClock } from '../bots/scheduler.js';
/** Run callbacks manually, including cancelled ones, to exercise stale timer guards. */
export function botClock() {
  const tasks: {
    callback: () => void;
    delay: number;
    cancelled: boolean;
    fired: boolean;
  }[] = [];
  const clock: BotClock = {
    schedule(callback, delay) {
      const task = { callback, delay, cancelled: false, fired: false };
      tasks.push(task);
      return () => {
        task.cancelled = true;
      };
    },
  };
  const next = () => tasks.find((task) => !task.cancelled && !task.fired);
  return {
    clock,
    tasks,
    next,
    fire() {
      const task = next();
      if (!task) throw new Error('Expected scheduled bot');
      task.fired = true;
      task.callback();
      return task;
    },
  };
}
