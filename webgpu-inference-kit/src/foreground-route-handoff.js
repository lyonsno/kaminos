import { createWebGpuForegroundService } from './foreground-opportunity.js';

/**
 * Keep a renderer's foreground requester stable while sequential producers
 * take turns on the same device. Callback completion is not GPU completion.
 */
export function createWebGpuForegroundRouteHandoff({ device, queue = device?.queue, idleRouteId = 'application.foreground-idle' } = {}) {
  if (!device || typeof device !== 'object' || queue !== device.queue || typeof queue?.submit !== 'function') {
    throw new Error('foreground handoff requires one device and its exact queue');
  }
  const idle = createWebGpuForegroundService({ routeId: idleRouteId, device, queue });
  const pending = new Map();
  let active = null;
  let transition = null;
  let disposal = null;

  function assertOpen() {
    if (disposal) throw new Error('foreground handoff is disposed');
  }

  function request(input) {
    assertOpen();
    const provider = active;
    const handle = provider ? provider.request(input) : idle.request(input);
    if (!handle || typeof handle.completion?.then !== 'function' || typeof handle.cancel !== 'function') {
      throw new Error('foreground provider must return a completion and cancel handle');
    }
    const flights = pending.get(provider) || new Set();
    pending.set(provider, flights);
    const completion = Promise.resolve(handle.completion).then(
      value => { flights.delete(completion); if (flights.size === 0) pending.delete(provider); return value; },
      error => { flights.delete(completion); if (flights.size === 0) pending.delete(provider); throw error; },
    );
    flights.add(completion);
    completion.catch(() => {});
    return Object.freeze({ requestId: handle.requestId, completion, cancel(reason) { return handle.cancel(reason); } });
  }

  async function change(next) {
    assertOpen();
    if (transition) throw new Error('foreground handoff already has a transition');
    if (next && (typeof next.routeId !== 'string' || !next.routeId.trim() ||
      next.device !== device || next.queue !== queue || typeof next.request !== 'function')) {
      throw new Error('foreground provider requires routeId, matching device and queue, and request');
    }
    const outgoing = active;
    active = null;
    const draining = [...(pending.get(outgoing) || [])];
    transition = Promise.allSettled(draining).then(() => {
      if (!disposal) active = next;
    });
    try { await transition; }
    finally { transition = null; }
  }

  function dispose() {
    if (disposal) return disposal;
    active = null;
    disposal = (async () => {
      await transition;
      await Promise.allSettled([...pending.values()].flatMap(flights => [...flights]));
      await idle.dispose();
    })();
    return disposal;
  }

  return Object.freeze({
    request,
    activate(provider) { return change(provider); },
    deactivate() { return change(null); },
    snapshot() {
      return Object.freeze({ routeId: active?.routeId ?? null, transitioning: transition !== null,
        pendingCallbacks: [...pending.values()].reduce((total, flights) => total + flights.size, 0), disposed: disposal !== null });
    },
    dispose,
  });
}
