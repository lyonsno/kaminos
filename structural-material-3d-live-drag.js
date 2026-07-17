export const STRUCTURAL_MATERIAL_3D_LIVE_DRAG_ROUTE = 'kaminos.structural-material.live-sympathetic-drag.v0';
export const STRUCTURAL_MATERIAL_3D_HAPTIC_ROUTE = 'kaminos.structural-material.causal-haptics.v0';
export const STRUCTURAL_MATERIAL_NATIVE_HAPTIC_ROUTE = 'kaminos.structural-material.native-trackpad-haptics.v0';
export const DEFAULT_STRUCTURAL_MATERIAL_NATIVE_HAPTIC_URL = 'http://127.0.0.1:8396';

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function interactionIdentity(interaction, fallback) {
  return typeof interaction?.id === 'string' && interaction.id.length > 0
    ? interaction.id
    : `interaction-${fallback}`;
}

function invalidatedReceipt(item, generation) {
  return {
    status: 'invalidated',
    interactionId: item.id,
    generation: item.generation,
    effectiveGeneration: generation,
  };
}

export function createLatestStructuralInteractionScheduler({ execute } = {}) {
  if (typeof execute !== 'function') throw new Error('live structural scheduler requires execute(interaction, context)');

  let generation = 0;
  let sequence = 0;
  let active = null;
  let pending = null;
  let activeExecutionCount = 0;
  let maxConcurrentExecutionCount = 0;
  let offeredCount = 0;
  let startedCount = 0;
  let completedCount = 0;
  let coalescedCount = 0;
  let invalidatedCount = 0;
  let finalOfferedCount = 0;
  let finalCompletedCount = 0;

  function start(item) {
    if (item.generation !== generation) {
      invalidatedCount += 1;
      item.resolve(invalidatedReceipt(item, generation));
      return;
    }
    active = item;
    activeExecutionCount += 1;
    maxConcurrentExecutionCount = Math.max(maxConcurrentExecutionCount, activeExecutionCount);
    startedCount += 1;
    let execution;
    try {
      execution = execute(item.interaction, {
        generation: item.generation,
        interactionId: item.id,
        final: item.final,
      });
    } catch (error) {
      execution = Promise.reject(error);
    }
    Promise.resolve(execution).then(
      receipt => finish(item, { receipt }),
      error => finish(item, { error }),
    );
  }

  function finish(item, { receipt, error } = {}) {
    activeExecutionCount -= 1;
    active = null;
    const next = pending;
    pending = null;
    let result = receipt;
    if (item.generation !== generation) {
      invalidatedCount += 1;
      result = invalidatedReceipt(item, generation);
    } else if (!error) {
      completedCount += 1;
      if (item.final) finalCompletedCount += 1;
    }
    if (next) start(next);
    if (error) item.reject(error);
    else item.resolve(result);
  }

  function enqueue(interaction, { final = false } = {}) {
    sequence += 1;
    offeredCount += 1;
    if (final) finalOfferedCount += 1;
    return new Promise((resolve, reject) => {
      const item = {
        interaction,
        id: interactionIdentity(interaction, sequence),
        generation,
        final,
        resolve,
        reject,
      };
      if (!active) {
        start(item);
        return;
      }
      if (pending) {
        coalescedCount += 1;
        pending.resolve({
          status: 'coalesced',
          interactionId: pending.id,
          supersededByInteractionId: item.id,
          generation: pending.generation,
        });
      }
      pending = item;
    });
  }

  return {
    offer(interaction) {
      return enqueue(interaction);
    },
    flush(interaction) {
      return enqueue(interaction, { final: true });
    },
    invalidate() {
      generation += 1;
      if (pending) {
        invalidatedCount += 1;
        pending.resolve(invalidatedReceipt(pending, generation));
        pending = null;
      }
      return generation;
    },
    snapshot() {
      return {
        route: STRUCTURAL_MATERIAL_3D_LIVE_DRAG_ROUTE,
        generation,
        pointerExecutionActive: active !== null,
        activeInteractionId: active?.id || null,
        pendingInteractionId: pending?.id || null,
        activeExecutionCount,
        maxConcurrentExecutionCount,
        offeredCount,
        startedCount,
        completedCount,
        coalescedCount,
        invalidatedCount,
        finalOfferedCount,
        finalCompletedCount,
      };
    },
  };
}

function safeGamepads(navigatorRef) {
  if (typeof navigatorRef?.getGamepads !== 'function') return [];
  try {
    return Array.from(navigatorRef.getGamepads() || []).filter(Boolean);
  } catch {
    return [];
  }
}

function gamepadActuator(gamepad) {
  const actuator = gamepad?.vibrationActuator || gamepad?.hapticActuators?.[0];
  return actuator && typeof actuator.playEffect === 'function' ? actuator : null;
}

function normalizeNativeCompanionUrl(value) {
  if (value === null || value === undefined || value === '') return null;
  const url = new URL(String(value));
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('native haptic companion must use a loopback host');
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function detectStructuralHapticCapabilities(navigatorRef = globalThis.navigator, {
  nativeCompanionUrl = null,
} = {}) {
  const gamepads = safeGamepads(navigatorRef);
  const gamepadActuatorCount = gamepads.filter(gamepad => gamepadActuator(gamepad)).length;
  let normalizedNativeCompanionUrl = null;
  let nativeCompanionConfigurationError = null;
  try {
    normalizedNativeCompanionUrl = normalizeNativeCompanionUrl(nativeCompanionUrl);
  } catch (error) {
    nativeCompanionConfigurationError = error instanceof Error ? error.message : String(error);
  }
  return {
    route: STRUCTURAL_MATERIAL_3D_HAPTIC_ROUTE,
    hostVibration: {
      route: 'w3c-vibration-api',
      supported: typeof navigatorRef?.vibrate === 'function',
    },
    gamepadHaptics: {
      route: 'w3c-gamepad-haptic-actuator',
      supported: gamepadActuatorCount > 0,
      actuatorCount: gamepadActuatorCount,
    },
    macTrackpad: {
      route: STRUCTURAL_MATERIAL_NATIVE_HAPTIC_ROUTE,
      supported: false,
      browserExposed: false,
      companionConfigured: normalizedNativeCompanionUrl !== null,
      companionUrl: normalizedNativeCompanionUrl,
      configurationError: nativeCompanionConfigurationError,
    },
  };
}

function componentCount(state) {
  if (Array.isArray(state?.components) && state.components.length > 0) return state.components.length;
  const labels = new Set((state?.nodes || []).map(node => node.componentId).filter(Boolean));
  return Math.max(1, labels.size);
}

export function buildLayeredStructuralHapticImpulse(previousState, nextState, receipt = {}, interaction = {}) {
  if (receipt?.status !== 'passed') return null;
  const previousBonds = previousState?.bonds || [];
  const nextBonds = nextState?.bonds || [];
  if (previousBonds.length !== nextBonds.length) throw new Error('haptic impulse requires stable bond identity');
  const newlyBroken = [];
  for (let index = 0; index < nextBonds.length; index += 1) {
    if (previousBonds[index].alive !== false && nextBonds[index].alive === false) newlyBroken.push(nextBonds[index]);
  }
  const componentCountDelta = Math.max(0, componentCount(nextState) - componentCount(previousState));
  if (newlyBroken.length === 0 && componentCountDelta === 0) return null;
  const depthBreakCount = newlyBroken.filter(bond => bond.bondKind === 'depth').length;
  const magnitude = clamp(interaction.magnitude, 0, 5);
  const fractureWeight = 1 - Math.exp(-newlyBroken.length / 9);
  const depthWeight = 1 - Math.exp(-depthBreakCount / 4);
  const componentWeight = 1 - Math.exp(-componentCountDelta);
  const forceWeight = 1 - Math.exp(-magnitude / 1.4);
  const intensity = clamp(
    fractureWeight * 0.44 + depthWeight * 0.2 + componentWeight * 0.24 + forceWeight * 0.12,
    0.08,
    1,
  );
  return {
    schema: 'kaminos.structural-material.causal-haptic-impulse.v0',
    requestedRoute: STRUCTURAL_MATERIAL_3D_HAPTIC_ROUTE,
    effectiveRoute: STRUCTURAL_MATERIAL_3D_HAPTIC_ROUTE,
    cause: 'accepted-gpu-connectivity-delta',
    sourceRoute: receipt.effectiveRoute || null,
    eventEpoch: receipt.eventEpoch ?? null,
    newlyBrokenBondCount: newlyBroken.length,
    newlyBrokenDepthBondCount: depthBreakCount,
    componentCountDelta,
    interactionMagnitude: magnitude,
    intensity,
    durationMs: Math.round(7 + intensity * 29),
    pattern: componentCountDelta > 0 ? 'separation' : 'crack',
  };
}

export async function dispatchStructuralHapticImpulse(impulse, {
  navigatorRef = globalThis.navigator,
  nativeCompanionUrl = null,
  fetchRef = globalThis.fetch,
} = {}) {
  if (!impulse) throw new Error('haptic dispatch requires a causal impulse');
  const capabilities = detectStructuralHapticCapabilities(navigatorRef, { nativeCompanionUrl });
  const hostVibration = {
    requested: true,
    supported: capabilities.hostVibration.supported,
    accepted: false,
    error: null,
  };
  if (capabilities.hostVibration.supported) {
    try {
      hostVibration.accepted = navigatorRef.vibrate([impulse.durationMs]) === true;
    } catch (error) {
      hostVibration.error = error instanceof Error ? error.message : String(error);
    }
  }

  const gamepadResults = [];
  for (const gamepad of safeGamepads(navigatorRef)) {
    const actuator = gamepadActuator(gamepad);
    if (!actuator) continue;
    const supportedEffects = Array.from(actuator.effects || []);
    const effect = supportedEffects.includes('dual-rumble') || supportedEffects.length === 0
      ? 'dual-rumble'
      : supportedEffects[0];
    try {
      const result = await actuator.playEffect(effect, {
        duration: impulse.durationMs,
        strongMagnitude: clamp(impulse.intensity * 0.7, 0, 1),
        weakMagnitude: clamp(impulse.intensity, 0, 1),
      });
      gamepadResults.push({ id: gamepad.id || 'unidentified-gamepad', effect, result, accepted: result !== 'preempted' });
    } catch (error) {
      gamepadResults.push({
        id: gamepad.id || 'unidentified-gamepad',
        effect,
        result: 'error',
        accepted: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const macTrackpad = {
    status: capabilities.macTrackpad.configurationError
      ? 'rejected'
      : capabilities.macTrackpad.companionConfigured
        ? 'unavailable'
        : 'not-configured',
    requested: capabilities.macTrackpad.companionConfigured,
    route: STRUCTURAL_MATERIAL_NATIVE_HAPTIC_ROUTE,
    effectiveRoute: null,
    endpoint: capabilities.macTrackpad.companionUrl,
    performed: false,
    tactileOutputVerified: false,
    receipt: null,
    error: capabilities.macTrackpad.configurationError,
  };
  if (macTrackpad.requested) {
    if (typeof fetchRef !== 'function') {
      macTrackpad.error = 'fetch is unavailable';
    } else {
      try {
        const response = await fetchRef(`${macTrackpad.endpoint}/v1/impulse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(impulse),
        });
        const receipt = await response.json();
        const receiptIdentityValid =
          receipt?.schema === 'kaminos.structural-material.native-haptic-receipt.v0' &&
          receipt?.effectiveRoute === STRUCTURAL_MATERIAL_NATIVE_HAPTIC_ROUTE;
        const tactileOutputOverclaim = receipt?.tactileOutputVerified === true;
        macTrackpad.receipt = tactileOutputOverclaim
          ? {
              ...receipt,
              status: 'failed',
              tactileOutputVerified: false,
              rejectedCompanionClaim: {
                field: 'tactileOutputVerified',
                claimedValue: true,
              },
            }
          : receipt;
        macTrackpad.status = response.ok && receipt?.status === 'passed' && receiptIdentityValid && !tactileOutputOverclaim
          ? 'passed'
          : 'failed';
        macTrackpad.effectiveRoute = receipt?.effectiveRoute || null;
        macTrackpad.performed = macTrackpad.status === 'passed' && receipt?.performed === true;
        macTrackpad.tactileOutputVerified = false;
        if (!response.ok) macTrackpad.error = `native companion returned HTTP ${response.status}`;
        else if (!receiptIdentityValid) macTrackpad.error = 'native companion receipt identity mismatch';
        else if (tactileOutputOverclaim) macTrackpad.error = 'native companion claimed unverifiable physical tactile output';
        else if (receipt?.status !== 'passed') macTrackpad.error = receipt?.error || 'native companion rejected impulse';
      } catch (error) {
        macTrackpad.error = error instanceof Error ? error.message : String(error);
      }
    }
  }

  return {
    schema: 'kaminos.structural-material.causal-haptic-dispatch.v0',
    status: 'passed',
    requestedRoute: STRUCTURAL_MATERIAL_3D_HAPTIC_ROUTE,
    effectiveRoute: STRUCTURAL_MATERIAL_3D_HAPTIC_ROUTE,
    impulse,
    capabilities,
    hostVibration,
    gamepadHaptics: {
      requested: true,
      supported: capabilities.gamepadHaptics.supported,
      acceptedCount: gamepadResults.filter(result => result.accepted).length,
      results: gamepadResults,
    },
    macTrackpad,
  };
}
