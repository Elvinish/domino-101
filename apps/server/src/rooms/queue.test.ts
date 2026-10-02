import { expect, it } from 'vitest';
import { SerialQueue } from './queue.js';

it('serializes asynchronous work and recovers after a rejected operation', async () => {
  const queue = new SerialQueue();
  const order: number[] = [];
  let release!: () => void;
  const first = queue.run(async () => {
    order.push(1);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    order.push(2);
  });
  const second = queue.run(() => {
    order.push(3);
    throw new Error('expected');
  });
  const rejected = expect(second).rejects.toThrow('expected');
  const third = queue.run(() => {
    order.push(4);
  });
  await Promise.resolve();
  expect(order).toEqual([1]);
  release();
  await first;
  await rejected;
  await third;
  expect(order).toEqual([1, 2, 3, 4]);
});
it('bounds pending ordinary work but admits essential disconnect cleanup', async () => {
  const queue = new SerialQueue(1);
  let release!: () => void;
  const first = queue.run(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await expect(queue.run(() => 1)).rejects.toMatchObject({
    code: 'SERVER_BUSY',
  });
  const cleanup = queue.run(() => 2, true);
  release();
  await first;
  expect(await cleanup).toBe(2);
  await queue.drain();
});
