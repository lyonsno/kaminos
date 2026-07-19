export function createSerializedRebakeRunner({ rebake, persist = async () => {} } = {}) {
  if (typeof rebake !== 'function') throw new TypeError('stage-b-rebake-queue-missing:rebake');
  if (typeof persist !== 'function') throw new TypeError('stage-b-rebake-queue-invalid:persist');

  let tail = Promise.resolve();
  let completedCount = 0;

  return {
    run(input) {
      const task = tail.then(async () => {
        const result = await rebake(input);
        const nextCompletedCount = completedCount + 1;
        await persist({ result, completedCount: nextCompletedCount });
        completedCount = nextCompletedCount;
        return result;
      });
      tail = task.then(() => undefined, () => undefined);
      return task;
    },
    get completedCount() {
      return completedCount;
    },
  };
}
