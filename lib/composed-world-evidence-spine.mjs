import { createHash } from 'node:crypto';

export const COMPOSED_WORLD_EVIDENCE_SCHEMA = 'kaminos.composed-world.fire-sharp-evidence.v0';

const FIRE_ACTOR_RECEIPT_SCHEMA = 'kaminos.wake-sharp-fire-actor-product-episode.v1';
const FOREGROUND_HEARTBEAT_SCHEMA = 'kaminos.foreground-kiln-heartbeat.v0';
const SHARP_DUTY_CORRELATION_SCHEMA = 'kaminos.foreground-sharp-duty-correlation.v0';
const SHARP_PIPELINE_REPORT_SCHEMA = 'kaminos.sharp-inline-pipeline-report.v0';
const SHARP_ADAPTER_REPORT_SCHEMA = 'kaminos.sharp-inline-product-route-report.v0';
const CLOCK_SCHEMA = 'kaminos.browser-epoch-monotonic-clock.v0';
const CLOCK_AUTHORITY = 'performance-time-origin-plus-now';
const ROUTE_ID = 'sharp-image-to-splat-live-v0';
const ROUTE_AUTHORITY = 'same-browser-product-realm-shared-device';
const SHARP_ROUTE_ID = 'sharp.image-to-splat.webgpu-local.v0';
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_REVISION = /^[a-f0-9]{40}$/;

function requiredString(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function requiredSha(value, label) {
  const normalized = requiredString(value, label);
  if (!SHA256.test(normalized)) throw new Error(`${label} must be a lowercase SHA-256`);
  return normalized;
}

function requiredRevision(value, label) {
  const normalized = requiredString(value, label);
  if (!GIT_REVISION.test(normalized)) throw new Error(`${label} must be an exact 40-character Git revision`);
  return normalized;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch: expected ${expected}, received ${actual}`);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function exactObjectMatch(left, right, label) {
  if (canonicalJson(left) !== canonicalJson(right)) {
    throw new Error(`${label} mismatch`);
  }
}

function validateClock(clock, label) {
  assertEqual(clock?.schema, CLOCK_SCHEMA, `${label} schema`);
  assertEqual(clock?.timingAuthority, CLOCK_AUTHORITY, `${label} authority`);
  if (!Number.isFinite(clock?.timeOriginEpochMs)) {
    throw new Error(`${label} time origin is required`);
  }
  return structuredClone(clock);
}

function validateForegroundHeartbeat(heartbeat, firingId) {
  assertEqual(heartbeat?.schema, FOREGROUND_HEARTBEAT_SCHEMA, 'foreground heartbeat schema');
  assertEqual(heartbeat?.status, 'verified', 'foreground heartbeat status');
  assertEqual(heartbeat?.firingId, firingId, 'foreground firing identity');
  assertEqual(heartbeat?.routeId, ROUTE_ID, 'foreground route identity');
  assertEqual(heartbeat?.pipelineId, ROUTE_ID, 'foreground pipeline identity');
  if (heartbeat?.sampleRetention !== 'uncapped') {
    throw new Error('composed-world evidence requires uncapped foreground samples');
  }
  const samples = Array.isArray(heartbeat?.samples) ? heartbeat.samples : [];
  if (!Number.isInteger(heartbeat?.sampleCount)
    || heartbeat.sampleCount < 2
    || heartbeat.sampleCount !== samples.length) {
    throw new Error('foreground sample count does not match the complete sample sequence');
  }
  const clock = validateClock(heartbeat.clock, 'foreground clock');
  let previousTimestamp = null;
  let previousEpoch = null;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (!Number.isFinite(sample?.timestampMs) || !Number.isFinite(sample?.epochMs)) {
      throw new Error(`foreground sample clock is missing at index ${index}`);
    }
    if (sample.sampleIndex !== undefined && sample.sampleIndex !== index) {
      throw new Error(`foreground sample index mismatch at index ${index}`);
    }
    if (previousTimestamp !== null
      && (sample.timestampMs < previousTimestamp || sample.epochMs < previousEpoch)) {
      throw new Error(`foreground sample order is invalid at index ${index}`);
    }
    if (Math.abs(clock.timeOriginEpochMs + sample.timestampMs - sample.epochMs) > 1) {
      throw new Error(`foreground sample clock mismatch at index ${index}`);
    }
    if (index > 0) {
      const expectedGap = sample.timestampMs - previousTimestamp;
      if (!Number.isFinite(sample.frameGapMs) || Math.abs(expectedGap - sample.frameGapMs) > 0.001) {
        throw new Error(`foreground frame gap mismatch at index ${index}`);
      }
    }
    previousTimestamp = sample.timestampMs;
    previousEpoch = sample.epochMs;
  }
  if (heartbeat.failures?.length) {
    throw new Error(`foreground heartbeat carries failures: ${heartbeat.failures.join(', ')}`);
  }
  exactObjectMatch(
    heartbeat.requestedFireBudget,
    heartbeat.effectiveFireBudget,
    'requested/effective FireActor budget',
  );
  return { clock, samples: structuredClone(samples) };
}

function validateSharpDutyCorrelation(correlation, heartbeat, firingId) {
  assertEqual(correlation?.schema, SHARP_DUTY_CORRELATION_SCHEMA, 'SHARP duty correlation schema');
  assertEqual(correlation?.status, 'verified', 'SHARP duty correlation status');
  assertEqual(correlation?.firingId, firingId, 'SHARP duty correlation firing identity');
  assertEqual(
    correlation?.timingAuthority,
    'performance-time-origin-plus-now-cross-page-join',
    'SHARP duty correlation clock authority',
  );
  requiredString(correlation?.runId, 'SHARP duty correlation run identity');
  assertEqual(correlation.runId, firingId, 'SHARP duty correlation episode identity');
  const foregroundClock = validateClock(correlation.foregroundClock, 'correlation foreground clock');
  exactObjectMatch(foregroundClock, heartbeat.clock, 'foreground/correlation clock');
  const sharpClock = validateClock(correlation.sharpClock, 'SHARP cross-page clock');
  assertEqual(sharpClock.runId, correlation.runId, 'SHARP clock run identity');
  if (!Number.isFinite(sharpClock.inferenceWindowStartEpochMs)
    || !Number.isFinite(sharpClock.inferenceWindowEndEpochMs)
    || sharpClock.inferenceWindowEndEpochMs <= sharpClock.inferenceWindowStartEpochMs) {
    throw new Error('SHARP cross-page clock is missing an ordered inference window');
  }
  const gaps = Array.isArray(correlation?.foregroundGaps) ? correlation.foregroundGaps : [];
  if (!Number.isInteger(correlation?.foregroundGapCount)
    || correlation.foregroundGapCount < 1
    || correlation.foregroundGapCount !== gaps.length) {
    throw new Error('SHARP correlation gap count does not match the complete gap sequence');
  }
  if (correlation.failures?.length) {
    throw new Error(`SHARP duty correlation carries failures: ${correlation.failures.join(', ')}`);
  }
  return { foregroundClock, sharpClock, gaps: structuredClone(gaps) };
}

function validateFireActorReceipt(receipt, firingId) {
  assertEqual(receipt?.schema, FIRE_ACTOR_RECEIPT_SCHEMA, 'FireActor receipt schema');
  assertEqual(receipt?.status, 'completed', 'FireActor receipt status');
  assertEqual(receipt?.firingId, firingId, 'FireActor firing identity');
  requiredString(receipt?.mountId, 'FireActor mount identity');
  requiredString(receipt?.actorId, 'FireActor actor identity');
  requiredString(receipt?.basinRevision, 'FireActor basin identity');
  requiredSha(receipt?.packageSha256, 'FireActor package identity');
  requiredString(receipt?.policyId, 'FireActor policy identity');
  requiredString(receipt?.carrier?.identity, 'FireActor carrier identity');
  requiredSha(receipt?.carrier?.effectiveSha256, 'FireActor carrier effective identity');
  if (receipt?.effectivePresentation?.fallbackReason) {
    throw new Error(`FireActor presentation fallback is present: ${receipt.effectivePresentation.fallbackReason}`);
  }
  assertEqual(receipt?.effectivePresentation?.smokePresentation, 'on', 'FireActor smoke presentation');
  if (receipt?.sharp?.sharedGpuExactObjectIdentityVerified !== true) {
    throw new Error('FireActor receipt did not verify exact shared GPU identity');
  }
  const requestedRevision = requiredRevision(receipt?.sharp?.requestedRevision, 'FireActor SHARP requested revision');
  const effectiveRevision = requiredRevision(receipt?.sharp?.effectiveRevision, 'FireActor SHARP effective revision');
  assertEqual(effectiveRevision, requestedRevision, 'FireActor SHARP revision identity');
  return { requestedRevision, effectiveRevision };
}

function validateAuthenticatedSharpEpisode(runDebug, firingId, splat, kitIdentity) {
  assertEqual(runDebug?.status, 'real', 'SHARP run debug status');
  const schedulerTelemetry = runDebug?.schedulerTelemetry;
  assertEqual(schedulerTelemetry?.runId, firingId, 'SHARP scheduler run identity');
  const eventArchive = schedulerTelemetry?.eventArchive;
  assertEqual(eventArchive?.schema, 'sharp-webgpu.scheduler-event-archive-ref.v0', 'SHARP scheduler archive schema');
  assertEqual(eventArchive?.status, 'resident-sealed', 'SHARP scheduler archive status');
  assertEqual(eventArchive?.retention, 'uncapped', 'SHARP scheduler archive retention');
  assertEqual(eventArchive?.runId, firingId, 'SHARP scheduler archive run identity');
  const sequence = schedulerTelemetry?.eventTrace?.sequenceEnvelope;
  if (!sequence
    || sequence.firstSequence !== 0
    || !Number.isSafeInteger(sequence.lastSequence)
    || !Number.isSafeInteger(sequence.nextSequence)
    || !Number.isSafeInteger(sequence.eventCount)
    || sequence.lastSequence !== sequence.nextSequence - 1
    || sequence.eventCount !== sequence.nextSequence
    || sequence.eventCount !== eventArchive.eventCount) {
    throw new Error('SHARP scheduler event sequence is incomplete or contradictory');
  }

  const route = runDebug?.route;
  assertEqual(route?.requestedRouteId, SHARP_ROUTE_ID, 'requested SHARP runtime route identity');
  assertEqual(route?.effectiveRouteId, SHARP_ROUTE_ID, 'effective SHARP runtime route identity');
  if (route?.receiptError) throw new Error(`SHARP route receipt failed: ${route.receiptError}`);
  const receipt = route?.receipt;
  assertEqual(receipt?.requestedRouteId, SHARP_ROUTE_ID, 'requested SHARP receipt route identity');
  assertEqual(receipt?.effectiveRouteId, SHARP_ROUTE_ID, 'effective SHARP receipt route identity');
  assertEqual(receipt?.kernel?.kitVersion, kitIdentity.effectiveVersion, 'SHARP receipt WebGPU inference kit identity');
  const metadata = receipt?.metadataPayload;
  assertEqual(metadata?.schema, 'sharp.webgpu-route-metadata.v0', 'SHARP route metadata schema');
  assertEqual(metadata?.episodeId, firingId, 'SHARP route metadata episode identity');
  assertEqual(metadata?.schedulerTrace?.runId, firingId, 'SHARP route metadata scheduler identity');
  exactObjectMatch(metadata?.schedulerTrace?.eventSequence, sequence, 'SHARP route metadata event sequence');
  assertEqual(metadata?.routeId, SHARP_ROUTE_ID, 'SHARP route metadata route identity');

  const metadataOutput = (receipt?.outputs || []).find(output => output?.role === 'sharp-webgpu-metadata');
  const metadataSha256 = requiredSha(metadataOutput?.sha256, 'SHARP route metadata SHA-256');
  if (sha256Json(metadata) !== metadataSha256) {
    throw new Error('SHARP route metadata SHA-256 does not authenticate its payload');
  }
  const receiptSplat = (receipt?.outputs || []).find(output => output?.role === 'splat-candidate');
  requiredSha(receiptSplat?.sha256, 'SHARP receipt PLY SHA-256');
  assertEqual(receiptSplat.sha256, splat.sha256, 'SHARP receipt/terminal PLY identity');

  const terminal = metadata?.terminalOutput;
  assertEqual(terminal?.completeness, 'complete', 'SHARP terminal output completeness');
  assertEqual(terminal?.plySha256, splat.sha256, 'SHARP terminal output PLY identity');
  assertEqual(terminal?.plyByteLength, splat.bytes, 'SHARP terminal output PLY byte length');
  if (!Number.isSafeInteger(terminal?.numGaussians) || terminal.numGaussians <= 0) {
    throw new Error('SHARP terminal output Gaussian count must be a positive safe integer');
  }
  assertEqual(receiptSplat?.shape?.[0], terminal.numGaussians, 'SHARP receipt Gaussian count');
  assertEqual(runDebug?.outputs?.numGaussians, terminal.numGaussians, 'SHARP run output Gaussian count');
  assertEqual(runDebug?.outputs?.plyByteLength, terminal.plyByteLength, 'SHARP run output PLY byte length');
  return {
    metadataSha256,
    eventSequence: structuredClone(sequence),
    numGaussians: terminal.numGaussians,
  };
}

function validatePipelineReport(report, firingId, sharpRevision) {
  assertEqual(report?.schema, SHARP_PIPELINE_REPORT_SCHEMA, 'SHARP pipeline report schema');
  assertEqual(report?.status, 'real', 'SHARP pipeline report status');
  assertEqual(report?.requestedPipelineId, ROUTE_ID, 'requested SHARP pipeline identity');
  assertEqual(report?.effectiveRouteConfig?.routeId, ROUTE_ID, 'effective SHARP route identity');
  assertEqual(report?.effectiveRouteConfig?.routeAuthority, ROUTE_AUTHORITY, 'effective SHARP route authority');
  const realStage = (report?.stages || []).find(stage => stage?.status === 'real');
  const adapter = realStage?.effectiveRoute?.adapterReport;
  assertEqual(adapter?.schema, SHARP_ADAPTER_REPORT_SCHEMA, 'SHARP adapter report schema');
  if (adapter?.status !== undefined) assertEqual(adapter.status, 'real', 'SHARP adapter report status');
  assertEqual(adapter?.firingId, firingId, 'SHARP adapter firing identity');
  assertEqual(adapter?.revision, sharpRevision, 'SHARP revision identity');
  assertEqual(adapter?.effectiveRoute, ROUTE_AUTHORITY, 'SHARP adapter route authority');
  if (adapter?.sharedGpu?.exactObjectIdentityVerified !== true
    || !adapter?.sharedGpu?.deviceIdentity
    || !adapter?.sharedGpu?.queueIdentity) {
    throw new Error('SHARP adapter shared GPU identity is missing or unverified');
  }
  exactObjectMatch(
    adapter.requestedScheduler,
    adapter.effectiveScheduler,
    'requested/effective scheduler',
  );
  validateRuntimeIdentity(adapter.webgpuInferenceKit);
  const splat = report?.artifacts?.splat;
  assertEqual(splat?.status, 'real', 'terminal output status');
  requiredString(splat?.path, 'terminal output path');
  if (!Number.isSafeInteger(splat?.bytes) || splat.bytes <= 0) {
    throw new Error('terminal output byte count must be a positive safe integer');
  }
  requiredSha(splat?.sha256, 'terminal output SHA-256');
  const authenticatedEpisode = validateAuthenticatedSharpEpisode(
    report?.authoritativeTrace?.sharpRunDebug,
    firingId,
    splat,
    adapter.webgpuInferenceKit,
  );
  return {
    adapter,
    splat,
    authenticatedEpisode,
    kitIdentity: structuredClone(adapter.webgpuInferenceKit),
  };
}

function validateRuntimeIdentity(value) {
  if (value?.status !== 'matched'
    || !value?.sourceLockedVersion
    || value.sourceLockedVersion !== value.requestedVersion
    || value.sourceLockedVersion !== value.effectiveVersion) {
    throw new Error('WebGPU inference kit identity did not match source, request, and effective runtime');
  }
}

function validateSourceIdentity(value, requestedInvocation) {
  const requested = requiredString(
    value?.requestedAssetId || requestedInvocation?.sourceAssetId,
    'requested source identity',
  );
  const effective = requiredString(value?.effectiveAssetId, 'effective source identity');
  assertEqual(effective, requested, 'requested/effective source identity');
  requiredString(value?.source, 'effective source route');
  if (!Number.isSafeInteger(value?.bytes) || value.bytes <= 0
    || !Number.isSafeInteger(value?.postBytes) || value.postBytes <= 0) {
    throw new Error('source content identity requires positive pre/post byte counts');
  }
  const sha256 = requiredSha(value?.sha256, 'source content identity SHA-256');
  const postSha256 = requiredSha(value?.postSha256, 'source content identity post-firing SHA-256');
  if (value.bytes !== value.postBytes || sha256 !== postSha256) {
    throw new Error('source content identity changed during the firing');
  }
  return { requested, effective };
}

function validateInvocation(value) {
  requiredString(value?.url, 'requested Kaminos URL');
  if (value?.fireFriendly !== true) throw new Error('composed-world evidence requires the Friendly firing route');
  assertEqual(value?.schedulerProfileId, 'cooperative-spn-gaussian', 'requested scheduler profile');
  assertEqual(value?.firePresentation, 'full-volume', 'requested fire presentation');
  assertEqual(value?.flameContinuity, 'live-every-frame', 'requested flame continuity');
}

function validateBrowserIdentity(value) {
  if (!value?.requested || !value?.effective) {
    throw new Error('requested/effective browser identity is required');
  }
  requiredString(value.effective.executable, 'effective browser executable');
  requiredString(value.effective.product, 'effective browser product');
  return structuredClone(value);
}

export function createComposedWorldFireSharpEvidence(input = {}) {
  if (input.failure) {
    if (!input.failure.phase || !input.failure.lastTrustworthyEvidence) {
      throw new Error('composed-world failure requires a failure phase and last trustworthy evidence');
    }
    throw new Error(`composed-world firing failed during ${input.failure.phase}: ${input.failure.error || 'unknown error'}`);
  }
  const kaminosRevision = requiredRevision(input.kaminosRevision, 'Kaminos revision');
  validateInvocation(input.requestedInvocation);
  const browser = validateBrowserIdentity(input.browserIdentity);
  const source = validateSourceIdentity(input.sourceIdentity, input.requestedInvocation);
  validateRuntimeIdentity(input.webgpuInferenceKit);
  const firingId = requiredString(input.foregroundHeartbeat?.firingId, 'composed-world firing identity');
  const fireActorSharp = validateFireActorReceipt(input.fireActorProductReceipt, firingId);
  const foreground = validateForegroundHeartbeat(input.foregroundHeartbeat, firingId);
  const correlation = validateSharpDutyCorrelation(input.sharpDutyCorrelation, input.foregroundHeartbeat, firingId);
  const pipeline = validatePipelineReport(input.pipelineReport, firingId, fireActorSharp.effectiveRevision);
  assertEqual(input.foregroundHeartbeat.profileId, input.requestedInvocation.schedulerProfileId, 'foreground scheduler profile');

  return {
    schema: COMPOSED_WORLD_EVIDENCE_SCHEMA,
    status: 'verified',
    claimCeiling: 'On this exact named firing, the mounted promoted FireActor remained live every foreground frame while the exact same-browser shared-device SHARP route completed and wrote the identified real PLY output; timing is browser RAF and host-await evidence, not display-present or GPU-exclusive latency.',
    identity: {
      firingId,
      kaminosRevision,
      sharpRevision: fireActorSharp.effectiveRevision,
      webgpuInferenceKitVersion: pipeline.kitIdentity.effectiveVersion,
      sourceAssetId: source.effective,
      browser,
      fireActor: {
        mountId: input.fireActorProductReceipt.mountId,
        actorId: input.fireActorProductReceipt.actorId,
        basinRevision: input.fireActorProductReceipt.basinRevision,
        packageSha256: input.fireActorProductReceipt.packageSha256,
        policyId: input.fireActorProductReceipt.policyId,
        carrier: structuredClone(input.fireActorProductReceipt.carrier),
      },
      sharedGpu: structuredClone(pipeline.adapter.sharedGpu),
      sharpEpisode: {
        runId: firingId,
        routeMetadataSha256: pipeline.authenticatedEpisode.metadataSha256,
        eventSequence: pipeline.authenticatedEpisode.eventSequence,
      },
    },
    route: {
      requestedUrl: input.requestedInvocation.url,
      requestedPipelineId: ROUTE_ID,
      effectiveRouteId: ROUTE_ID,
      effectiveRouteAuthority: ROUTE_AUTHORITY,
      schedulerProfileId: input.requestedInvocation.schedulerProfileId,
      requestedScheduler: structuredClone(pipeline.adapter.requestedScheduler),
      effectiveScheduler: structuredClone(pipeline.adapter.effectiveScheduler),
      firePresentation: input.requestedInvocation.firePresentation,
      flameContinuity: input.requestedInvocation.flameContinuity,
      requestedFireBudget: structuredClone(input.foregroundHeartbeat.requestedFireBudget),
      effectiveFireBudget: structuredClone(input.foregroundHeartbeat.effectiveFireBudget),
    },
    clockJoin: {
      authority: 'performance-time-origin-plus-now-cross-page-join',
      foreground: {
        clock: foreground.clock,
        startedAtMs: input.foregroundHeartbeat.startedAtMs,
        finishedAtMs: input.foregroundHeartbeat.finishedAtMs,
        durationMs: input.foregroundHeartbeat.durationMs,
        sampleRetention: input.foregroundHeartbeat.sampleRetention,
        sampleCount: input.foregroundHeartbeat.sampleCount,
        samples: foreground.samples,
      },
      sharp: {
        runId: input.sharpDutyCorrelation.runId,
        clock: correlation.sharpClock,
      },
      correlation: {
        status: input.sharpDutyCorrelation.status,
        foregroundGapCount: input.sharpDutyCorrelation.foregroundGapCount,
        foregroundGaps: correlation.gaps,
      },
    },
    terminalOutput: {
      status: pipeline.splat.status,
      path: pipeline.splat.path,
      bytes: pipeline.splat.bytes,
      sha256: pipeline.splat.sha256,
      numGaussians: pipeline.authenticatedEpisode.numGaussians,
    },
    source: structuredClone(input.sourceIdentity),
    fireActorProductReceipt: structuredClone(input.fireActorProductReceipt),
    evidenceLimits: [
      'Main-page requestAnimationFrame gaps do not prove display-present cadence.',
      'Submitted-work drain intervals are host-await overlap evidence, not GPU-exclusive attribution.',
      'This receipt records observed wall time and does not assert an under-one-minute result.',
    ],
  };
}

function htmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderComposedWorldFireSharpTraceHtml(evidence) {
  if (evidence?.schema !== COMPOSED_WORLD_EVIDENCE_SCHEMA || evidence.status !== 'verified') {
    throw new Error('shared-clock trace requires verified composed-world evidence');
  }
  const samples = evidence.clockJoin.foreground.samples;
  const gaps = samples.slice(1).map(sample => sample.frameGapMs);
  const maxGap = Math.max(...gaps);
  const durationMs = evidence.clockJoin.foreground.durationMs;
  const payload = JSON.stringify({ gaps, maxGap, durationMs }).replaceAll('<', '\\u003c');
  const firingId = htmlEscape(evidence.identity.firingId);
  const outputHash = htmlEscape(evidence.terminalOutput.sha256);
  const fireActor = htmlEscape(evidence.identity.fireActor.actorId);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Composed Fire + SHARP shared-clock trace</title>
  <style>
    :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    body { margin: 0; background: #101312; color: #f1eee2; }
    main { max-width: 1100px; margin: 0 auto; padding: 28px; }
    h1 { margin: 0 0 8px; font-size: 24px; letter-spacing: 0; }
    .sub { color: #b7b9b4; margin-bottom: 24px; }
    .metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid #414944; }
    .metric { padding: 14px; border-right: 1px solid #414944; }
    .metric:last-child { border-right: 0; }
    .label { color: #a9b3ad; font-size: 12px; }
    .value { margin-top: 6px; font-size: 18px; overflow-wrap: anywhere; }
    canvas { display: block; width: 100%; height: 360px; margin-top: 18px; border: 1px solid #414944; background: #181d1a; }
    .legend { display: flex; gap: 18px; margin-top: 10px; color: #b7b9b4; font-size: 12px; }
    .hash { margin-top: 22px; color: #a9b3ad; overflow-wrap: anywhere; }
    @media (max-width: 700px) { .metrics { grid-template-columns: 1fr; } .metric { border-right: 0; border-bottom: 1px solid #414944; } }
  </style>
</head>
<body>
  <main>
    <h1>Composed Fire + SHARP shared-clock trace</h1>
    <div class="sub">Exact firing ${firingId} with promoted actor ${fireActor}</div>
    <div class="metrics">
      <div class="metric"><div class="label">Foreground samples</div><div class="value">${samples.length}</div></div>
      <div class="metric"><div class="label">Observed wall</div><div class="value">${htmlEscape(durationMs)} ms</div></div>
      <div class="metric"><div class="label">Worst RAF gap</div><div class="value">${htmlEscape(maxGap)} ms</div></div>
    </div>
    <canvas id="trace" width="1100" height="360" aria-label="Foreground requestAnimationFrame gap trace"></canvas>
    <div class="legend"><span>Gold: foreground RAF gap</span><span>Red line: 50 ms</span><span>Green line: 16.67 ms</span></div>
    <div class="hash">Terminal PLY SHA-256: ${outputHash}</div>
  </main>
  <script>
    const data = ${payload};
    const canvas = document.getElementById('trace');
    const ctx = canvas.getContext('2d');
    const pad = { left: 56, right: 18, top: 18, bottom: 34 };
    const width = canvas.width - pad.left - pad.right;
    const height = canvas.height - pad.top - pad.bottom;
    const ceiling = Math.max(60, data.maxGap * 1.08);
    const y = ms => pad.top + height - Math.min(1, ms / ceiling) * height;
    ctx.strokeStyle = '#333b36';
    ctx.lineWidth = 1;
    for (const ms of [0, 16.67, 50, ceiling]) {
      ctx.beginPath(); ctx.moveTo(pad.left, y(ms)); ctx.lineTo(pad.left + width, y(ms)); ctx.stroke();
      ctx.fillStyle = '#9ca49f'; ctx.fillText(ms.toFixed(ms === ceiling ? 1 : 2) + ' ms', 6, y(ms) + 4);
    }
    ctx.strokeStyle = '#72c98d'; ctx.beginPath(); ctx.moveTo(pad.left, y(16.67)); ctx.lineTo(pad.left + width, y(16.67)); ctx.stroke();
    ctx.strokeStyle = '#e07068'; ctx.beginPath(); ctx.moveTo(pad.left, y(50)); ctx.lineTo(pad.left + width, y(50)); ctx.stroke();
    ctx.strokeStyle = '#e3bd62'; ctx.lineWidth = 1.5; ctx.beginPath();
    data.gaps.forEach((gap, index) => {
      const x = pad.left + (data.gaps.length <= 1 ? 0 : index / (data.gaps.length - 1)) * width;
      if (index === 0) ctx.moveTo(x, y(gap)); else ctx.lineTo(x, y(gap));
    });
    ctx.stroke();
  </script>
</body>
</html>`;
}
