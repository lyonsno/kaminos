import {createWebGpuForegroundService} from './webgpu-inference-kit/src/core.js';

export const sharedGpuBufferRequirements = {};

export function judgeForegroundRebindPixels(before, after) {
  const errors = [];
  for (const [phase, sample] of [['before', before], ['after', after]]) {
    if (!sample || sample.sampledPixels !== 2304) errors.push(`${phase} ordinary-flame pixel sample is missing`);
    else if (sample.litPixels < 16 || sample.coloredPixels < 16) errors.push(`${phase} ordinary-flame canvas is blank or partial`);
  }
  return errors;
}

export function judgeForegroundRebind(result) {
  const errors = [];
  if (result?.sameDevice !== true) errors.push('providers did not borrow the host device');
  const phases = result?.phases;
  if (!Array.isArray(phases) || phases.length !== 3 || phases.map(phase => phase.routeId).join(',') !== 'a,b,a') {
    errors.push('missing A-B-A route sequence');
  } else {
    for (const phase of phases) {
      if (!(phase.after?.frameCount > phase.before?.frameCount && phase.after?.simStepCount > phase.before?.simStepCount)) {
        errors.push(`${phase.routeId} ordinary flame did not advance`);
      }
      if (!Array.isArray(phase.receipts) || phase.receipts.length < 3) {
        errors.push(`${phase.routeId} has fewer than three foreground receipts`);
        continue;
      }
      for (const receipt of phase.receipts) {
        if (receipt.status !== 'completed' || receipt.result?.status !== 'submitted' || receipt.result?.renderer !== 'ordinary-volume') {
          errors.push(`${phase.routeId} has a failed or alternate frame`);
        }
        if (!receipt.submissions?.some(row => row.submissionStatus === 'queue-submit-returned' && row.commandBufferCount > 0)) {
          errors.push(`${phase.routeId} has no actual GPU submission`);
        }
      }
    }
  }
  if (result?.final?.active !== true || result?.final?.error) errors.push('renderer did not remain active');
  return errors;
}

export async function mountComposition({prototype, sharedGpu, host} = {}) {
  if (!prototype?.setActive) throw new Error('foreground rebind probe requires the ordinary volume prototype');
  await prototype.setActive(true);
  const context = prototype?.foregroundGpuContext?.();
  if (!sharedGpu?.device || sharedGpu.queue !== sharedGpu.device.queue || host?.device !== sharedGpu.device ||
      context?.device !== sharedGpu.device || context.queue !== sharedGpu.device.queue ||
      context.renderer !== 'ordinary-volume' || context.productFrameOwner !== 'prototype') {
    throw new Error('foreground rebind probe requires the actual ordinary flame on one borrowed host device');
  }
  const services = Object.fromEntries(['a', 'b'].map(routeId => [routeId, createWebGpuForegroundService({
    routeId: `host-rebind-${routeId}`, device: sharedGpu.device, queue: sharedGpu.device.queue,
  })]));
  const receipts = {a: [], b: []};
  const snapshot = () => {
    const state = prototype.debugState();
    return {active: state.active, error: state.error ?? null, frameCount: state.frameCount, simStepCount: state.simStepCount};
  };
  function sampleCanvas() {
    const source = prototype.canvasElement?.();
    if (!source?.width || !source.height) return null;
    const target = document.createElement('canvas');
    target.width = 48;
    target.height = 48;
    const context2d = target.getContext('2d', {willReadFrequently: true});
    context2d.drawImage(source, 0, 0, 48, 48);
    const pixels = context2d.getImageData(0, 0, 48, 48).data;
    let litPixels = 0;
    let coloredPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
      const high = Math.max(r, g, b), low = Math.min(r, g, b);
      if (a > 8 && high > 24) litPixels++;
      if (a > 8 && high > 24 && high - low > 12) coloredPixels++;
    }
    return {sourceWidth: source.width, sourceHeight: source.height, sampledPixels: 2304, litPixels, coloredPixels};
  }
  function bind(routeId) {
    prototype.setForegroundOpportunityRequester(request => {
      const handle = services[routeId].request({
        ...request,
        run: service => {
          if (service.device !== sharedGpu.device || service.queue !== sharedGpu.device.queue) throw new Error('rebound service device mismatch');
          return host.runForegroundFrame(() => request.run(service));
        },
      });
      return {...handle, completion: handle.completion.then(receipt => {
        receipts[routeId].push(receipt);
        return receipt;
      })};
    });
  }
  async function waitForFrames(routeId, initialCount) {
    while (receipts[routeId].length < initialCount + 3) {
      const state = snapshot();
      if (!state.active || state.error) throw new Error(`ordinary flame stopped during ${routeId}: ${state.error}`);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }
  async function switchTo(routeId) {
    await prototype.pauseForegroundAdmission();
    const state = snapshot();
    if (!state.active || state.error) throw new Error(`cannot rebind stopped flame: ${state.error}`);
    bind(routeId);
    prototype.resumeForegroundAdmission();
  }
  host.setForegroundServiceActive(true);
  bind('a');
  const probe = {
    status: 'mounted',
    sameDevice: true,
    routes: ['a', 'b'],
    sampleCanvas,
    async run() {
      if (probe.status !== 'mounted') throw new Error('foreground rebind probe already started');
      probe.status = 'running';
      const phases = [];
      try {
        for (const [index, routeId] of ['a', 'b', 'a'].entries()) {
          if (index) await switchTo(routeId);
          const before = snapshot();
          const start = receipts[routeId].length;
          await waitForFrames(routeId, start);
          phases.push({routeId, before, after: snapshot(), receipts: receipts[routeId].slice(start)});
        }
        const result = {sameDevice: true, phases, final: snapshot()};
        result.errors = judgeForegroundRebind(result);
        probe.result = result;
        probe.status = result.errors.length ? 'failed' : 'completed';
        return result;
      } catch (error) {
        probe.status = 'failed';
        probe.error = String(error?.message || error);
        probe.result = {sameDevice: true, phases, final: snapshot(), error: probe.error};
        throw error;
      }
    },
  };
  window.__foregroundRebindProbe = probe;
}
