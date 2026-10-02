import { RoomError } from './errors.js';

/** Each room owns one queue. Rejection never poisons the next operation. */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  constructor(private readonly limit = 128) {}
  run<T>(operation: () => T | Promise<T>, essential = false): Promise<T> {
    if (!essential && this.pending >= this.limit)
      return Promise.reject(new RoomError('SERVER_BUSY'));
    this.pending++;
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => {
        this.pending--;
      },
      () => {
        this.pending--;
      },
    );
    return result;
  }
  drain(): Promise<void> {
    return this.tail;
  }
}
