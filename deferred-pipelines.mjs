// Pipeline identity follows the device, shader, layout and specialization;
// changing field dimensions only replaces resources/bindings. Derived from the
// deferred root-renderer selection introduced in 96e658d.
export function createDeferredPipelines(device) {
  const identities = new WeakMap(), entries = new WeakMap(), cache = new Map();
  let nextIdentity = 0;
  const identity = object => {
    if (!identities.has(object)) identities.set(object, ++nextIdentity);
    return identities.get(object);
  };
  function defer(kind, descriptor) {
    const key = kind + JSON.stringify(descriptor, (name, value) => {
      if (name === 'label') return undefined;
      if ((name === 'layout' || name === 'module') && value && typeof value === 'object') return {gpuIdentity: identity(value)};
      return value;
    });
    if (cache.has(key)) return cache.get(key);
    let pipeline;
    const resolve = () => pipeline ??= kind === 'render'
      ? device.createRenderPipeline(descriptor) : device.createComputePipeline(descriptor);
    const handle = Object.freeze({getBindGroupLayout: index => resolve().getBindGroupLayout(index)});
    entries.set(handle, resolve);
    cache.set(key, handle);
    return handle;
  }
  return {
    render: descriptor => defer('render', descriptor),
    compute: descriptor => defer('compute', descriptor),
    resolve: pipeline => entries.get(pipeline)?.() ?? pipeline,
  };
}
