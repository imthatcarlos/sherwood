/**
 * Concurrency pool for parallel agent operations.
 *
 * Fixed-window batching: processes `concurrency` items at a time,
 * waits for the whole batch before starting the next.
 *
 * State safety: JavaScript is single-threaded. Subprocess I/O runs in
 * parallel via libuv, but microtask callbacks (which mutate SimState)
 * execute one at a time — no locking needed.
 */

export async function runInPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const size = Math.max(1, concurrency);
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}
