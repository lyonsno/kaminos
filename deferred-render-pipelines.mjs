// Keep renderer-selection identity cheap. Only the pipeline submitted to a GPU
// pass is constructed; comparing other variants must not compile them.
export function createDeferredRenderPipelines() {
  const entries = new WeakMap();
  return {
    defer(create) {
      const handle = Object.freeze({});
      let pipeline;
      entries.set(handle, () => pipeline ??= create());
      return handle;
    },
    resolve(pipeline) {
      return entries.get(pipeline)?.() ?? pipeline;
    },
  };
}
