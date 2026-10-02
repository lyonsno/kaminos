export function createGenerationBoundLocalLiquidHostMount({
  getGeneration,
  getHost,
  setHost,
  createHost,
  onFailure = () => {},
  onMounted = () => {},
}) {
  if (typeof getGeneration !== 'function' || typeof getHost !== 'function'
    || typeof setHost !== 'function' || typeof createHost !== 'function') {
    throw new TypeError('Local liquid host mount requires generation, host, and factory callbacks');
  }
  const inFlight = new Map();

  async function mount(inputs) {
    const generation = getGeneration();
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw new TypeError('Local liquid host scene generation must be a nonnegative safe integer');
    }
    if (getHost()) return true;
    const existing = inFlight.get(generation);
    if (existing) return existing;

    const promise = Promise.resolve().then(async () => {
      try {
        const host = await createHost({
          ...inputs,
          generation,
          isCurrent: () => getGeneration() === generation,
        });
        if (!host) return false;
        if (getGeneration() !== generation) {
          host.dispose?.();
          return false;
        }
        if (getHost()) {
          host.dispose?.();
          return true;
        }
        try {
          onMounted(host, generation);
        } catch (error) {
          host.dispose?.();
          throw error;
        }
        if (getGeneration() !== generation) {
          host.dispose?.();
          return false;
        }
        setHost(host);
        return true;
      } catch (error) {
        if (getGeneration() === generation) onFailure(error);
        return false;
      } finally {
        inFlight.delete(generation);
      }
    });
    inFlight.set(generation, promise);
    return promise;
  }

  return Object.freeze({
    mount,
    isLoading: () => inFlight.has(getGeneration()),
  });
}
