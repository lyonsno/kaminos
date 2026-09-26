export function createSceneLoadRequests() {
  let generation = 0;
  return Object.freeze({
    begin() { return ++generation; },
    invalidate() { return ++generation; },
    isCurrent(requestId) { return Number.isSafeInteger(requestId) && requestId === generation; },
    async awaitStage(requestId, pending) {
      const value = await pending;
      return {current: Number.isSafeInteger(requestId) && requestId === generation, value};
    },
    current() { return generation; },
  });
}
