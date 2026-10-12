import {TIMBER_IGNITION_BASIN} from './timber-ignition-smoke.mjs';

export function bindTimberInvestigation({controller, volume, basin, readObjects, readCamera, readScene, readEdits, operations}) {
  for (const [name, operation] of Object.entries({basin, readObjects, readCamera, readScene, readEdits})) {
    if (typeof operation !== 'function') throw Error(`Timber investigation requires ${name}`);
  }
  if (!controller?.status || !controller?.subscribeOperations || !volume?.debugState) {
    throw Error('Timber investigation requires the actual mounted controller and volume');
  }
  if (!operations || typeof operations.emit !== 'function') throw Error('Shared investigation operation channel is required');
  let disposed = false;
  const unsubscribe = controller.subscribeOperations(operation => {
    if (operations.active) operations.emit(operation);
  });
  return Object.freeze({
    read() {
      if (disposed) throw Error('Timber investigation adapter is disposed');
      const timber = controller.status(), live = volume.debugState(), objects = readObjects(), preset = basin();
      const reasons = [];
      if (typeof timber.resources?.fluidAllocationId !== 'string' || typeof timber.resources?.materialAssemblyId !== 'string') reasons.push('physical-resources-unverified');
      else if (timber.resources.fluidAllocationId !== live.fluidAllocationId
        || timber.resources.materialAssemblyId !== live.gpuStructuralCombustionAssembly?.assemblyId) reasons.push('physical-resources-replaced');
      if (!timber.attemptId || ['loading', 'restoring', 'failed'].includes(timber.phase)) reasons.push('physical-attempt-unavailable');
      if (live.error || !live.active || !/^WebGPU:/.test(live.backend)
        || live.effectiveRoute !== 'native-3d-compute-fluid-raymarch-v0') reasons.push('volume-route-unavailable');
      if (preset !== TIMBER_IGNITION_BASIN || live.simGrid !== 48
        || JSON.stringify(live.simGridDimensions) !== '[48,96,48]') reasons.push('setup-changed');
      if (objects.length !== 2 || objects[0].id !== 'sinter-source-timber' || objects[1].id !== 'sinter-receiver-timber'
        || live.gpuStructuralCombustionAssembly?.structureCount !== 2 || live.combustibleObjectSource?.sameDevice !== true) reasons.push('timber-scene-replaced');
      return structuredClone({schema:'kaminos.timber-investigation-context.v1',
        attempt:{id:timber.attemptId,generation:timber.generation,available:reasons.length===0,reasons},
        context:{timber,volume:live,basin:preset,objects,camera:readCamera(),scene:readScene(),edits:readEdits()}});
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
    },
  });
}
