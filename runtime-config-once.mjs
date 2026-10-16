// Startup needs the server's runtime configuration in two places (the hybrid
// overlay module and SAM's GPU requirements). Ask once, as early as possible,
// and share the answer; a failed request is shared too, then retried on the
// next call.
export function createRuntimeConfigLoader(fetchImpl = (...args) => fetch(...args)) {
  let pending = null;
  return function loadRuntimeConfig() {
    if (!pending) {
      pending = (async () => {
        const response = await fetchImpl('/api/runtime-config', {cache: 'no-store'});
        if (!response.ok) throw new Error(`runtime config ${response.status}`);
        return response.json();
      })();
      pending.catch(() => { pending = null; });
    }
    return pending;
  };
}

export const loadRuntimeConfig = createRuntimeConfigLoader();
