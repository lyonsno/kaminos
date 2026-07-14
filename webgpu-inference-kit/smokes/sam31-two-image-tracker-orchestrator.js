import {
  createSam31BrowserTrackerCallerDualInvocationEvidence,
  createSam31BrowserTrackerDualInvocationEvidence,
  createSam31BrowserTrackerPackageCache,
} from '../src/index.js';

const statusElement = document.querySelector('#status');
const params = new URLSearchParams(location.search);
const packageRoots = params.getAll('packageRoot');
const packageMode = packageRoots.length > 0;
const callerInput = params.get('callerInput') === '1';
const staticBacking = params.get('staticBacking') || 'memory';
const childRoots = packageMode ? packageRoots : [null];
const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
let state = { status: 'loading', phase: 'initialize-parent-realm', completedInvocationCount: 0 };

function compactReceiptTimings(timings) {
  if (!timings) return null;
  const compactStage = stage => ({ name: stage?.name || null, ms: stage?.ms ?? null });
  const profile = timings.profile ? {
    schema: timings.profile.schema || null,
    route: timings.profile.route || null,
    timingSource: timings.profile.timingSource || null,
    timestampQueryValidatedAgainstStaged: timings.profile.timestampQueryValidatedAgainstStaged ?? null,
    requiredStages: timings.profile.requiredStages || [],
    stageNames: timings.profile.stageNames || [],
    stages: (timings.profile.stages || []).map(compactStage),
    totalMs: timings.profile.totalMs ?? null,
  } : null;
  return {
    source: timings.source || null,
    totalMs: timings.totalMs ?? null,
    stages: (timings.stages || []).map(compactStage),
    profile,
  };
}

function compactInvocationEvidence(invocation) {
  return {
    ...invocation,
    receipts: (invocation?.receipts || []).map(receipt => ({
      ...receipt,
      timings: compactReceiptTimings(receipt.timings),
    })),
  };
}

function createTerminalEvidenceState(sourceState) {
  const { invocations = [], ...terminal } = sourceState;
  return {
    ...compactInvocationEvidence(terminal),
    invocations: invocations.map(compactInvocationEvidence),
  };
}

function shortIdentity(value) {
  if (!value) return 'none';
  const marker = ':sha256:';
  const offset = value.indexOf(marker);
  return offset < 0 ? value : `${value.slice(0, offset + marker.length)}${value.slice(offset + marker.length, offset + marker.length + 12)}`;
}

function createVisibleState(sourceState) {
  const invocations = sourceState.invocations || [];
  const invocationReceipts = invocations.map((invocation, index) => {
    const runtime = invocation.packageRuntime || {};
    const cache = runtime.cacheEvidence || {};
    const backing = cache.backingStore || {};
    const realRoutes = (invocation.receipts || []).filter(receipt => receipt.status === 'real').length;
    return `#${index + 1} ${invocation.verificationAttached ? 'verified' : callerInput ? 'caller-owned' : 'runtime-only'}; invocation=${shortIdentity(runtime.invocationId)}; realm=${shortIdentity(invocation.executionRealmId)}; routes=${realRoutes}/${(invocation.receipts || []).length} real; static-origin=${backing.staticOriginNetworkLoadCount ?? 'n/a'}; static-hits=${backing.staticBackingStoreHitCount ?? 'n/a'}; dynamic-reads=${cache.dynamicNetworkLoadCount ?? 'n/a'}; caller-reads=${runtime.inputEvidence?.callerArtifactReadCount ?? 'n/a'}; passed=${invocation.evidence?.passed === true}`;
  });
  const dual = sourceState.dualInvocationEvidence;
  return {
    status: sourceState.status,
    phase: sourceState.phase,
    completedInvocations: `${sourceState.completedInvocationCount || 0}/${childRoots.length}`,
    childStatus: sourceState.childStatus || null,
    adapter: invocations[0]?.adapterInfo ? `${invocations[0].adapterInfo.vendor}/${invocations[0].adapterInfo.architecture}; fallback=${invocations[0].adapterInfo.isFallbackAdapter}` : null,
    packageId: invocations[0]?.packageRuntime?.packageId || sourceState.packageRuntime?.packageId || null,
    invocationReceipts,
    realmCheckpointPassed: (sourceState.betweenInvocationCheckpoints || []).every(checkpoint => checkpoint.passed && checkpoint.realmRemoved),
    dualInvocationPassed: sourceState.dualInvocationEvidence?.passed || false,
    dualGate: dual ? `same-package=${dual.sameModelPackage}; distinct-encoded=${dual.distinctEncodedSourceImages}; distinct-rgba=${dual.distinctRgbaSourceImages}; distinct-invocations=${dual.distinctInvocationIds}; caller-mode=${dual.bothVerificationFree ?? false}; real-route-chains=${dual.bothRouteChainsReal}; no-second-static-load=${dual.noSecondStaticNetworkLoads}; no-dynamic-origin=${dual.noDynamicOriginFetches ?? false}; caller-input-authority=${dual.callerInputAuthorityPassed ?? false}; state-shape=${dual.trackerStateShapePassed}; causal-state=${dual.distinctCausalTrackerState}; state-isolated=${dual.stateIsolationPassed}; distinct-realms=${dual.distinctExecutionRealms}; no-device-loss=${dual.noDeviceLoss}` : null,
    deviceLoss: sourceState.deviceLoss || null,
  };
}

window.sam31TwoFrameTrackerParityState = (options = {}) => options.summary ? {
  status: state.status,
  phase: state.phase,
  error: state.error || null,
  invocationIndex: state.invocationIndex ?? null,
  completedInvocationCount: state.completedInvocationCount || 0,
  childStatus: state.childStatus || null,
  deviceLoss: state.deviceLoss || null,
  dualInvocationEvidence: state.dualInvocationEvidence || null,
  betweenInvocationCheckpoints: state.betweenInvocationCheckpoints || [],
} : options.evidence ? createTerminalEvidenceState(state) : state;
window.sam31SharedTrackerPackageCache = packageMode ? createSam31BrowserTrackerPackageCache({
  persistentStaticBacking: staticBacking === 'opfs',
}) : null;

function update(status, phase, extra = {}) {
  state = { ...state, ...extra, status, phase };
  document.body.dataset.status = status;
  statusElement.textContent = JSON.stringify(createVisibleState(state), null, 2);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function childUrl(packageRoot, invocationIndex) {
  const childParams = new URLSearchParams(params);
  childParams.delete('packageRoot');
  if (packageRoot) childParams.append('packageRoot', packageRoot);
  childParams.set('invocationIndex', String(invocationIndex));
  return `./sam31-two-image-tracker-invocation.html?${childParams}`;
}

async function runChild(packageRoot, invocationIndex, completedInvocationCount) {
  const executionRealmId = `sam31-tracker-child-realm:${invocationIndex}:${crypto.randomUUID()}`;
  const iframe = document.createElement('iframe');
  iframe.title = `SAM3.1 tracker invocation ${invocationIndex + 1}`;
  iframe.src = childUrl(packageRoot, invocationIndex);
  iframe.style.cssText = 'position:fixed;left:-12000px;top:0;width:1000px;height:560px;border:0;';
  document.body.append(iframe);
  await new Promise((resolveLoad, rejectLoad) => {
    iframe.addEventListener('load', resolveLoad, { once: true });
    iframe.addEventListener('error', () => rejectLoad(new Error(`tracker invocation ${invocationIndex} frame failed to load`)), { once: true });
  });

  let childState;
  try {
    while (true) {
      childState = iframe.contentWindow?.sam31TwoFrameTrackerParityState?.() || null;
      if (childState?.status === 'failed') throw Object.assign(new Error(childState.error || `tracker invocation ${invocationIndex} failed`), { childState: clone(childState) });
      if (childState?.status === 'passed') break;
      update('running', `invocation-${invocationIndex}:${childState?.phase || 'load-child'}`, {
        invocationIndex,
        completedInvocationCount,
        childStatus: childState?.status || 'loading',
      });
      await delay(100);
    }
    const finalState = clone(childState);
    const invocation = finalState.invocations?.at(-1) || finalState;
    return { ...invocation, invocationIndex, executionRealmId };
  } finally {
    iframe.remove();
    if (typeof globalThis.gc === 'function') globalThis.gc();
    await delay(0);
    await delay(0);
  }
}

async function run() {
  const invocations = [];
  const betweenInvocationCheckpoints = [];
  for (let index = 0; index < childRoots.length; index += 1) {
    invocations.push(await runChild(childRoots[index], index, invocations.length));
    if (index + 1 >= childRoots.length) continue;
    const checkpoint = {
      afterInvocationIndex: index,
      realmRemoved: true,
      gcObserved: typeof globalThis.gc === 'function',
      passed: true,
    };
    betweenInvocationCheckpoints.push(checkpoint);
    update('running', 'between-invocation-checkpoint', {
      invocationIndex: index,
      completedInvocationCount: invocations.length,
      invocations,
      betweenInvocationCheckpoints,
      deviceLoss: null,
    });
  }

  if (!packageMode) {
    update('passed', 'complete', invocations[0]);
    return;
  }
  const final = invocations.at(-1);
  const dualInvocationEvidence = invocations.length === 2
    ? (callerInput
      ? createSam31BrowserTrackerCallerDualInvocationEvidence({ invocations, betweenInvocationCheckpoints })
      : createSam31BrowserTrackerDualInvocationEvidence({ invocations, betweenInvocationCheckpoints }))
    : null;
  if (dualInvocationEvidence && !dualInvocationEvidence.passed) {
    throw Object.assign(new Error(`dual tracker invocation evidence failed: ${JSON.stringify(dualInvocationEvidence)}`), {
      evidenceState: { ...final, invocations, betweenInvocationCheckpoints, dualInvocationEvidence },
    });
  }
  update('passed', 'complete', {
    ...final,
    invocations,
    betweenInvocationCheckpoints,
    dualInvocationEvidence,
    completedInvocationCount: invocations.length,
    invocationIndex: invocations.length - 1,
    childStatus: 'passed',
    deviceLoss: null,
  });
}

run().catch(error => {
  console.error(error);
  update('failed', state.phase, {
    ...(error.evidenceState || error.childState || {}),
    error: String(error?.stack || error),
  });
});
