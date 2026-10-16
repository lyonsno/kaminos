// Startup only. Startup needs the server's runtime configuration in two
// places (the hybrid overlay module and SAM's GPU requirements); ask once,
// starting from the <head> guard's early request when there is one, and
// share the answer. A failed request is shared too, then retried on the next
// call. Do not read source identity, source.dirty or mount state after
// startup through this: those must come from a fresh /api/runtime-config.
export function createRuntimeConfigLoader(fetchImpl = (...args) => fetch(...args), scope = globalThis) {
  let pending = null;
  return function loadStartupRuntimeConfig() {
    if (!pending) {
      const early = scope?.__kaminosEarlyRuntimeConfig;
      if (scope && '__kaminosEarlyRuntimeConfig' in scope) scope.__kaminosEarlyRuntimeConfig = null;
      pending = (async () => {
        const response = await (early || fetchImpl('/api/runtime-config', {cache: 'no-store'}));
        if (!response.ok) throw new Error(`runtime config ${response.status}`);
        return response.json();
      })();
      pending.catch(() => { pending = null; });
    }
    return pending;
  };
}

export const loadStartupRuntimeConfig = createRuntimeConfigLoader();
