// The ordinary editor needs water records and bounds, but not a running solver.
// Keep the runtime behind the consumer boundary; ESM owns module identity.
export function loadFingerFluidRuntime() {
  return import('./finger-fluid-webgpu-core.js');
}

export async function loadFingerFluidBenchFeature(params) {
  if (params.get('kaminos_finger_fluid_bench') !== '1') return {};
  const [runtime, analyticImpact] = await Promise.all([
    loadFingerFluidRuntime(),
    import('./finger-fluid-analytic-impact-handoff.js'),
  ]);
  return {...runtime, ...analyticImpact};
}
