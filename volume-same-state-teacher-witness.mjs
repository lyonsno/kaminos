#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import {
  SAME_STATE_TEACHER_CONTRACT,
  selectShortestVisibleTeacherResidual,
  validateSameStateTeacherPair,
} from './same-state-teacher-contract.mjs';
import {
  evaluateAnalyticalTeacherBaseline,
  validateAnalyticalCandidateReadback,
} from './boundary-splat-forced-response.mjs';

const REPORT_SCHEMA = 'kaminos.volume.same-state-forced-teacher-witness.v0';
const CONFIG_SCHEMA = 'kaminos.volume.same-state-forced-teacher-config.v0';
const CALIBRATION_REPORT_SCHEMA = 'kaminos.volume.same-state-analytical-teacher-calibration-witness.v0';
const CALIBRATION_CONFIG_SCHEMA = 'kaminos.volume.same-state-analytical-teacher-calibration-config.v0';
const TEACHER_AUTHORITY = 'exact-same-state-forced-response-teacher-fork-v0';
const TEACHER_APPLICATION = 'frame-current-emitter-wind-teacher-sequence-v0';
const args = parseArgs(process.argv.slice(2));
const configPath = resolve(String(args.get('--config') || ''));
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-same-state-teacher'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/witness-report.json`));
const requestedUrl = String(args.get('--url') || 'http://127.0.0.1:8095/?kaminos_volume_smoke=1');
const chromePort = positiveInteger(args.get('--chrome-port'), 19491);
const userDataDir = resolve(String(args.get('--user-data-dir') || `${outDir}/chrome-profile`));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const startedAt = new Date().toISOString();
const lastTrustworthyEvidence = {};
let browser = null;
let socket = null;
let failurePhase = 'startup';

mkdirSync(outDir, { recursive: true });

try {
  failurePhase = 'config-load';
  assert.ok(configPath && existsSync(configPath), `missing teacher config: ${configPath}`);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  validateConfig(config);
  lastTrustworthyEvidence.config = {
    path: configPath,
    schema: config.schema,
    horizons: config.horizons,
    initialStateSteps: config.initialStateSteps,
    thresholds: config.thresholds,
  };

  failurePhase = 'browser-launch';
  browser = spawn(chrome, [
    '--headless=new',
    '--enable-unsafe-webgpu',
    `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    `--window-size=${config.windowSize}`,
    requestedUrl,
  ], { stdio: 'ignore' });
  const version = await waitForCdp(chromePort, browser);
  const page = await findPage(chromePort);
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await waitForWebSocketOpen(socket);
  const cdp = createCdpClient(socket);
  await cdp.request('Runtime.enable');
  await cdp.request('Page.enable');
  await cdp.request('Page.navigate', { url: requestedUrl });

  failurePhase = 'route-settle';
  const settled = await waitForVolumeRoute(cdp, config.settleMs);
  assert.equal(settled.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0', 'wrong simulator route');
  assert.match(String(settled.backend || ''), /^WebGPU:/, 'same-state teacher requires adapter-qualified WebGPU');
  const effectiveUrl = await evaluate(cdp, 'location.href', 'effective-url');
  lastTrustworthyEvidence.route = {
    requestedUrl,
    effectiveUrl,
    browser: version.Browser,
    backend: settled.backend,
    effectiveRoute: settled.effectiveRoute,
    prototypeIdentity: settled.prototypeIdentity,
  };
  if (config.assay === 'same-state-analytical-calibration') {
    assertEffectiveRouteControls(effectiveUrl, config.route);
  }
  const canvasMount = await mountRendererCanvas(cdp);
  lastTrustworthyEvidence.canvasMount = canvasMount;

  failurePhase = 'initial-field-export';
  const initialBegin = await evaluate(cdp, `window.__kaminosVolumePrototype.beginDebugFullFieldExport(${JSON.stringify({
    steps: config.initialStateSteps,
    timeStepMs: config.timeStepMs,
    startTimeMs: config.startTimeMs,
  })})`, 'begin-initial-field-export');
  assert.equal(initialBegin?.ok, true, `initial field export failed: ${JSON.stringify(initialBegin)}`);
  const initialFluid = await drainExport(cdp, initialBegin, 'fluid', config.chunkFloats);
  const initialFront = await drainExport(cdp, initialBegin, 'front', config.chunkFloats);
  const initialBoundarySplats = config.assay === 'same-state-analytical-calibration'
    ? await drainExport(cdp, initialBegin, 'boundarySplat', config.chunkFloats)
    : null;
  await releaseExport(cdp, initialBegin.sessionId);
  const initialStep = Number(initialBegin.deterministicReplay?.simStepCount ?? initialBegin.deterministicReplay?.completedSteps);
  assert.ok(Number.isInteger(initialStep) && initialStep >= 0, 'initial export omitted simulator step identity');
  lastTrustworthyEvidence.initialField = {
    grid: initialBegin.grid,
    simStepCount: initialStep,
    fluidSha256: initialFluid.sha256,
    frontSha256: initialFront.sha256,
    fluidByteLength: initialFluid.bytes.byteLength,
    frontByteLength: initialFront.bytes.byteLength,
  };

  if (config.assay === 'same-state-analytical-calibration') {
    failurePhase = 'analytical-teacher-baseline';
    assert.equal(initialFluid.sha256, config.teacherInitialField.fluidSha256, 'calibration initial fluid checksum disagrees with teacher');
    assert.equal(initialFront.sha256, config.teacherInitialField.frontSha256, 'calibration initial front checksum disagrees with teacher');
    assert.equal(initialStep, config.teacherInitialField.simStepCount, 'calibration initial simulator step disagrees with teacher');
    const candidateDescriptor = initialBegin.boundarySplats?.sidecars?.boundarySplats;
    assert.ok(candidateDescriptor?.floatCount > 0, 'calibration boundary-splat candidate export is blank');
    const candidateValues = new Float32Array(
      initialBoundarySplats.bytes.buffer,
      initialBoundarySplats.bytes.byteOffset,
      initialBoundarySplats.bytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
    ).slice();
    const sourceAuthority = initialBegin.boundarySplats?.sourceAuthority || null;
    const rendererIdentity = initialBegin.boundarySplats?.identity || null;
    const draw = initialBegin.boundarySplats?.draw || null;
    lastTrustworthyEvidence.candidateExport = {
      authority: null,
      sourceAuthority,
      rendererIdentity,
      draw,
      descriptor: candidateDescriptor,
      sha256: initialBoundarySplats.sha256,
      validationStatus: 'unverified',
    };
    const validatedCandidate = validateAnalyticalCandidateReadback({
      candidateValues,
      descriptor: candidateDescriptor,
      draw,
      sourceAuthority,
      rendererIdentity,
    });
    lastTrustworthyEvidence.candidateExport = {
      ...lastTrustworthyEvidence.candidateExport,
      authority: validatedCandidate.authority,
      validationStatus: 'validated',
    };
    const baseline = evaluateAnalyticalTeacherBaseline({
      teacherResidual: config.teacherResidual,
      candidateValues,
      candidateAuthority: validatedCandidate.authority,
      response: config.baselineResponse,
      teacherGrid: initialBegin.grid,
      maximumAbsoluteLagErrorWorld: config.maximumAbsoluteLagErrorWorld,
    });
    const report = {
      schema: CALIBRATION_REPORT_SCHEMA,
      status: 'completed',
      failurePhase: null,
      error: null,
      startedAt,
      completedAt: new Date().toISOString(),
      requestedRoute: requestedUrl,
      effectiveRoute: 'boundary-splat-analytical-teacher-calibration-baseline-v0',
      simulatorRoute: settled.effectiveRoute,
      backend: settled.backend,
      browser: version.Browser,
      initialField: lastTrustworthyEvidence.initialField,
      teacherInitialField: config.teacherInitialField,
      teacherResidual: config.teacherResidual,
      candidateExport: {
        ...lastTrustworthyEvidence.candidateExport,
      },
      baseline,
      modelIdentity: null,
      analyticalWarpApplied: true,
      calibratedParametersApplied: false,
      splineAdmitted: false,
      latticeAdmitted: false,
      lastTrustworthyEvidence,
    };
    writeReport(report);
    console.log(JSON.stringify(report));
  } else {
  failurePhase = 'teacher-horizon-capture';
  const rows = [];
  for (const steps of config.horizons) {
    const control = await captureArm({
      cdp,
      config,
      initialBegin,
      initialFluid,
      initialFront,
      initialStep,
      steps,
      arm: 'stationary-source-control',
      outDir,
    });
    const teacher = await captureArm({
      cdp,
      config,
      initialBegin,
      initialFluid,
      initialFront,
      initialStep,
      steps,
      arm: 'moving-source-wind-teacher',
      outDir,
    });
    const residualPath = resolve(outDir, `horizon-${String(steps).padStart(2, '0')}-rigid-subtracted-residual.png`);
    const residual = measureRigidSubtractedResidual({
      controlFluid: control.field.fluidBytes,
      teacherFluid: teacher.field.fluidBytes,
      grid: initialBegin.grid,
      rigidDisplacement: teacher.sequence.measuredRigidDisplacement,
      outputPath: residualPath,
    });
    const row = {
      horizonMs: steps * config.timeStepMs,
      control: publicArm(control),
      teacher: publicArm(teacher),
      residual,
    };
    validateSameStateTeacherPair(row);
    rows.push(row);
    lastTrustworthyEvidence.lastCompletedHorizon = {
      steps,
      horizonMs: row.horizonMs,
      changedPixelFraction: residual.changedPixelFraction,
      upperPlumeLagPx: residual.upperPlumeLagPx,
      residualPath,
    };
  }

  failurePhase = 'shortest-visible-residual';
  const shortestVisibleResidual = selectShortestVisibleTeacherResidual(rows, config.thresholds);
  if (!shortestVisibleResidual) throw new Error('no-visible-named-teacher-residual-within-requested-horizons');
  const selectedRow = rows.find(row => row.control.sequence.requestedSteps === shortestVisibleResidual.requestedSteps);
  const report = {
    schema: REPORT_SCHEMA,
    status: 'completed',
    failurePhase: null,
    error: null,
    startedAt,
    completedAt: new Date().toISOString(),
    requestedRoute: requestedUrl,
    effectiveRoute: 'exact-same-state-forced-response-teacher-sequence-v0',
    simulatorRoute: settled.effectiveRoute,
    backend: settled.backend,
    browser: version.Browser,
    modelIdentity: null,
    analyticalWarpApplied: false,
    splineAdmitted: false,
    latticeAdmitted: false,
    initialField: lastTrustworthyEvidence.initialField,
    shortestVisibleResidual,
    selectedArtifacts: {
      stationaryRender: selectedRow.control.render.path,
      movingWindRender: selectedRow.teacher.render.path,
      rigidSubtractedResidual: selectedRow.residual.path,
    },
    horizons: rows,
    lastTrustworthyEvidence,
  };
  writeReport(report);
  console.log(JSON.stringify(report));
  }
} catch (error) {
  const report = {
    schema: lastTrustworthyEvidence.config?.schema === CALIBRATION_CONFIG_SCHEMA ? CALIBRATION_REPORT_SCHEMA : REPORT_SCHEMA,
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    startedAt,
    completedAt: new Date().toISOString(),
    requestedRoute: requestedUrl,
    effectiveRoute: lastTrustworthyEvidence.route?.effectiveRoute || null,
    modelIdentity: null,
    lastTrustworthyEvidence,
  };
  writeReport(report);
  console.error(JSON.stringify(report));
  process.exitCode = 1;
} finally {
  socket?.close();
  if (browser && browser.exitCode == null && browser.signalCode == null) browser.kill('SIGTERM');
}

async function captureArm({ cdp, config, initialBegin, initialFluid, initialFront, initialStep, steps, arm, outDir: targetDir }) {
  const importBegin = await evaluate(cdp, `window.__kaminosVolumePrototype.beginDebugFullFieldImport(${JSON.stringify({
    initializationAuthority: TEACHER_AUTHORITY,
    filterIdentity: TEACHER_APPLICATION,
    layoutIdentity: 'x-fastest-zyx-c-interleaved-v0',
    grid: initialBegin.grid,
    receiverInitialSimStepCount: initialStep,
    source: { identity: 'same-browser-checksum-addressed-teacher-fork-v0' },
    fluid: { ...initialBegin.fluid, sha256: initialFluid.sha256 },
    front: { ...initialBegin.front, sha256: initialFront.sha256 },
  })})`, `${arm}-import-begin`);
  assert.equal(importBegin?.ok, true, `${arm} import begin failed: ${JSON.stringify(importBegin)}`);
  await uploadImport(cdp, importBegin.sessionId, 'fluid', initialFluid.bytes, config.chunkBytes);
  await uploadImport(cdp, importBegin.sessionId, 'front', initialFront.bytes, config.chunkBytes);
  const importFinish = await evaluate(cdp, `window.__kaminosVolumePrototype.finishDebugFullFieldImport(${JSON.stringify({
    sessionId: importBegin.sessionId,
  })})`, `${arm}-import-finish`);
  assert.equal(importFinish?.ok, true, `${arm} import finish failed: ${JSON.stringify(importFinish)}`);
  assert.equal(importFinish.fluidSha256, initialFluid.sha256, `${arm} initial fluid checksum drift`);
  assert.equal(importFinish.frontSha256, initialFront.sha256, `${arm} initial front checksum drift`);

  const frames = teacherFrames(config, initialStep, steps, arm);
  const rigidDisplacement = sourceCenter(frames.at(-1)).map((component, axis) => component - sourceCenter(frames[0])[axis]);
  const sequence = await evaluate(cdp, `window.__kaminosVolumePrototype.advanceDebugForcedTeacherSequence(${JSON.stringify({
    sessionId: importBegin.sessionId,
    arm,
    frames,
    timeStepMs: config.timeStepMs,
    startTimeMs: config.teacherStartTimeMs,
    rigidDisplacement,
  })})`, `${arm}-teacher-sequence`);
  assert.equal(sequence?.ok, true, `${arm} teacher sequence failed: ${JSON.stringify(sequence)}`);
  assert.equal(sequence.completedSteps, steps, `${arm} teacher sequence was partial`);

  const renderReceipt = await evaluate(cdp, `window.__kaminosVolumePrototype.renderFrozenScaleToCanvas(${JSON.stringify({
    fullFieldImportSessionId: importBegin.sessionId,
    renderScale: config.renderScale,
    now: config.teacherStartTimeMs + steps * config.timeStepMs,
    sameStateCaptureId: `teacher-${steps}`,
  })})`, `${arm}-render`);
  assert.equal(renderReceipt?.ok, true, `${arm} render failed: ${JSON.stringify(renderReceipt)}`);
  const rect = renderReceipt.canvasCssRect;
  assert.ok(rect && rect.width >= 64 && rect.height >= 64 && rect.x >= 0 && rect.y >= 0, `${arm} render canvas is unavailable`);
  const screenshot = await cdp.request('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 },
  });
  const png = Buffer.from(screenshot.data, 'base64');
  const renderPath = resolve(targetDir, `horizon-${String(steps).padStart(2, '0')}-${arm}.png`);
  writeFileSync(renderPath, png);
  const activity = measurePngActivity(png);
  const render = {
    ok: true,
    complete: png.byteLength > 1024,
    nonblank: activity.litPixelFraction >= config.minimumRenderLitPixelFraction,
    path: renderPath,
    byteLength: png.byteLength,
    sha256: sha256(png),
    activity,
    receipt: renderReceipt,
  };
  assert.equal(render.complete, true, `${arm} render output is partial`);
  assert.equal(render.nonblank, true, `${arm} render output is blank`);

  const fieldBegin = await evaluate(cdp, 'window.__kaminosVolumePrototype.beginDebugFullFieldExport({})', `${arm}-field-export-begin`);
  assert.equal(fieldBegin?.ok, true, `${arm} output field export failed: ${JSON.stringify(fieldBegin)}`);
  const fluid = await drainExport(cdp, fieldBegin, 'fluid', config.chunkFloats);
  const front = await drainExport(cdp, fieldBegin, 'front', config.chunkFloats);
  await releaseExport(cdp, fieldBegin.sessionId);
  return {
    import: importFinish,
    sequence,
    render,
    field: {
      complete: true,
      fluidSha256: fluid.sha256,
      frontSha256: front.sha256,
      fluidBytes: fluid.bytes,
      frontBytes: front.bytes,
    },
  };
}

function teacherFrames(config, initialStep, steps, arm) {
  const moving = arm === 'moving-source-wind-teacher';
  return Array.from({ length: steps }, (_, index) => {
    const displacement = moving ? config.source.velocity[0] * config.timeStepMs * 0.001 * index : 0;
    const center = [config.source.center[0] + displacement, config.source.center[1], config.source.center[2]];
    const halfLength = config.source.length * 0.5;
    const frameId = initialStep + index;
    const timestampMs = config.teacherStartTimeMs + index * config.timeStepMs;
    return {
      frameId,
      controls: moving ? config.teacherControls : config.controlControls,
      externalEmitters: {
        mode: 'external',
        frameId,
        timestampMs,
        coordinateSpace: 'volume-local',
        emitters: [{
          start: [center[0], center[1] - halfLength, center[2]],
          end: [center[0], center[1] + halfLength, center[2]],
          radius: config.source.radius,
          strength: config.source.strength,
          velocity: moving ? config.source.velocity : [0, config.source.velocity[1], 0],
          smoke: config.source.smoke,
          heat: config.source.heat,
          fuel: config.source.fuel,
          flame: config.source.flame,
          detail: config.source.detail,
          lifetime: config.source.lifetime,
          active: true,
        }],
      },
    };
  });
}

function sourceCenter(frame) {
  const emitter = frame.externalEmitters.emitters[0];
  return emitter.start.map((component, axis) => (component + emitter.end[axis]) * 0.5);
}

function publicArm(arm) {
  return {
    import: arm.import,
    sequence: arm.sequence,
    render: arm.render,
    field: {
      complete: arm.field.complete,
      fluidSha256: arm.field.fluidSha256,
      frontSha256: arm.field.frontSha256,
      fluidByteLength: arm.field.fluidBytes.byteLength,
      frontByteLength: arm.field.frontBytes.byteLength,
    },
  };
}

function measureRigidSubtractedResidual({ controlFluid, teacherFluid, grid, rigidDisplacement, outputPath }) {
  const channels = 16;
  const control = new Float32Array(controlFluid.buffer, controlFluid.byteOffset, controlFluid.byteLength / 4);
  const teacher = new Float32Array(teacherFluid.buffer, teacherFluid.byteOffset, teacherFluid.byteLength / 4);
  assert.equal(control.length, grid ** 3 * channels, 'control field shape disagreement');
  assert.equal(teacher.length, control.length, 'teacher field shape disagreement');
  const displacementCells = rigidDisplacement.map(component => component * grid * 0.5);
  const controlProjection = new Float64Array(grid * grid);
  const teacherProjection = new Float64Array(grid * grid);
  let controlUpperX = 0;
  let controlUpperWeight = 0;
  let teacherUpperX = 0;
  let teacherUpperWeight = 0;
  for (let y = 0; y < grid; y += 1) {
    for (let x = 0; x < grid; x += 1) {
      for (let z = 0; z < grid; z += 1) {
        const controlWeight = visibleWeight(sampleCell(control, grid, channels, x, y, z));
        const teacherWeight = visibleWeight(sampleTrilinear(teacher, grid, channels, x + displacementCells[0], y + displacementCells[1], z + displacementCells[2]));
        controlProjection[x + y * grid] += controlWeight;
        teacherProjection[x + y * grid] += teacherWeight;
        if (y >= Math.floor(grid * 0.5)) {
          const worldX = ((x + 0.5) / grid) * 2 - 1;
          controlUpperX += worldX * controlWeight;
          controlUpperWeight += controlWeight;
          teacherUpperX += worldX * teacherWeight;
          teacherUpperWeight += teacherWeight;
        }
      }
    }
  }
  assert.ok(controlUpperWeight > 0 && teacherUpperWeight > 0, 'blank upper-plume field projection');
  const jointMax = Math.max(1e-9, ...controlProjection, ...teacherProjection);
  const rgba = new Uint8Array(grid * grid * 4);
  let changedPixels = 0;
  let meanAbsoluteDifference = 0;
  for (let y = 0; y < grid; y += 1) {
    for (let x = 0; x < grid; x += 1) {
      const sourceIndex = x + y * grid;
      const difference = (teacherProjection[sourceIndex] - controlProjection[sourceIndex]) / jointMax;
      const absolute = Math.abs(difference);
      if (absolute >= 0.06) changedPixels += 1;
      meanAbsoluteDifference += absolute;
      const targetY = grid - 1 - y;
      const targetIndex = (x + targetY * grid) * 4;
      const intensity = Math.min(255, Math.round(absolute * 920));
      rgba[targetIndex] = difference > 0 ? intensity : 0;
      rgba[targetIndex + 1] = difference < 0 ? intensity : Math.round(intensity * 0.16);
      rgba[targetIndex + 2] = difference < 0 ? intensity : 0;
      rgba[targetIndex + 3] = 255;
    }
  }
  const scale = 4;
  writeRgbaPng(outputPath, grid * scale, grid * scale, upscaleRgba(rgba, grid, grid, scale));
  const upperPlumeLagWorld = teacherUpperX / teacherUpperWeight - controlUpperX / controlUpperWeight;
  return {
    identity: 'rigid-subtracted-low-frequency-field-projection-v0',
    residualName: SAME_STATE_TEACHER_CONTRACT.residualName,
    rigidDisplacementSubtraction: {
      identity: SAME_STATE_TEACHER_CONTRACT.subtractionIdentity,
      applied: true,
      worldDisplacement: rigidDisplacement,
      imageDisplacementPx: [displacementCells[0], -displacementCells[1]],
      interpolation: 'trilinear-fluid-field-resample-v0',
    },
    projection: 'z-integrated-visible-fire-carrier-smoke-heat-v0',
    changedPixelThreshold: 0.06,
    changedPixelFraction: changedPixels / (grid * grid),
    meanAbsoluteDifference: meanAbsoluteDifference / (grid * grid),
    upperPlumeLagWorld,
    upperPlumeLagPx: upperPlumeLagWorld * grid * 0.5,
    path: outputPath,
    sha256: sha256(readFileSync(outputPath)),
  };
}

function sampleCell(values, grid, channels, x, y, z) {
  const offset = (x + y * grid + z * grid * grid) * channels;
  return values.subarray(offset, offset + channels);
}

function sampleTrilinear(values, grid, channels, x, y, z) {
  if (x < 0 || y < 0 || z < 0 || x > grid - 1 || y > grid - 1 || z > grid - 1) return new Float32Array(channels);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = Math.min(grid - 1, x0 + 1);
  const y1 = Math.min(grid - 1, y0 + 1);
  const z1 = Math.min(grid - 1, z0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const tz = z - z0;
  const output = new Float32Array(channels);
  for (let channel = 0; channel < channels; channel += 1) {
    let value = 0;
    for (const [cx, wx] of [[x0, 1 - tx], [x1, tx]]) {
      for (const [cy, wy] of [[y0, 1 - ty], [y1, ty]]) {
        for (const [cz, wz] of [[z0, 1 - tz], [z1, tz]]) {
          const offset = (cx + cy * grid + cz * grid * grid) * channels + channel;
          value += values[offset] * wx * wy * wz;
        }
      }
    }
    output[channel] = value;
  }
  return output;
}

function visibleWeight(cell) {
  return Math.max(0, cell[10]) + Math.max(0, cell[8]) * 0.6 + Math.max(0, cell[4]) * 0.18 + Math.max(0, cell[5]) * 0.08;
}

async function drainExport(cdp, begin, kind, chunkFloats) {
  const descriptor = kind === 'boundarySplat'
    ? begin.boundarySplats?.sidecars?.boundarySplats
    : begin[kind];
  assert.ok(descriptor?.floatCount > 0 && descriptor?.byteLength > 0, `missing ${kind} export descriptor`);
  const chunks = [];
  for (let startFloat = 0; startFloat < descriptor.floatCount; startFloat += chunkFloats) {
    const chunk = await evaluate(cdp, `window.__kaminosVolumePrototype.readDebugFullFieldExportChunk(${JSON.stringify({
      sessionId: begin.sessionId,
      kind,
      startFloat,
      floatCount: Math.min(chunkFloats, descriptor.floatCount - startFloat),
    })})`, `read-${kind}-chunk`);
    assert.equal(chunk?.ok, true, `${kind} export chunk failed`);
    chunks.push(Buffer.from(chunk.base64, 'base64'));
  }
  const bytes = Buffer.concat(chunks);
  const actualSha256 = sha256(bytes);
  assert.equal(bytes.byteLength, descriptor.byteLength, `${kind} export byte length mismatch`);
  if (descriptor.sha256 != null) assert.equal(actualSha256, descriptor.sha256, `${kind} export checksum mismatch`);
  return { bytes, sha256: actualSha256 };
}

async function uploadImport(cdp, sessionId, kind, bytes, chunkBytes) {
  for (let byteOffset = 0; byteOffset < bytes.byteLength; byteOffset += chunkBytes) {
    const chunk = bytes.subarray(byteOffset, Math.min(bytes.byteLength, byteOffset + chunkBytes));
    const receipt = await evaluate(cdp, `window.__kaminosVolumePrototype.writeDebugFullFieldImportChunk(${JSON.stringify({
      sessionId,
      kind,
      byteOffset,
      base64: chunk.toString('base64'),
    })})`, `upload-${kind}-chunk`);
    assert.equal(receipt?.ok, true, `${kind} import chunk failed: ${JSON.stringify(receipt)}`);
  }
}

async function releaseExport(cdp, sessionId) {
  const receipt = await evaluate(cdp, `window.__kaminosVolumePrototype.releaseDebugFullFieldExport(${JSON.stringify({ sessionId })})`, 'release-field-export');
  assert.equal(receipt?.ok, true, `field export release failed: ${JSON.stringify(receipt)}`);
}

async function waitForVolumeRoute(cdp, settleMs) {
  const deadline = Date.now() + Math.max(1000, settleMs);
  let state = null;
  while (Date.now() < deadline) {
    state = await evaluate(cdp, 'window.__kaminosVolumePrototype?.debugState?.()', 'route-state');
    if (state?.active && state?.frameCount > 8 && String(state?.backend || '').startsWith('WebGPU:')) return state;
    await delay(200);
  }
  throw new Error(`volume route did not settle: ${JSON.stringify({
    active: state?.active ?? null,
    frameCount: state?.frameCount ?? null,
    backend: state?.backend ?? null,
    effectiveRoute: state?.effectiveRoute ?? null,
    prototypeIdentity: state?.prototypeIdentity ?? null,
    error: state?.error ?? null,
  })}`);
}

async function mountRendererCanvas(cdp) {
  const mount = await evaluate(cdp, `(() => {
    const canvas = window.__kaminosVolumePrototype?.canvasElement?.();
    if (!canvas) return { ok: false, reason: 'renderer-canvas-missing' };
    const height = Math.max(64, Math.min(680, window.innerHeight));
    const width = Math.max(64, Math.min(window.innerWidth, height * canvas.width / Math.max(1, canvas.height)));
    document.body.appendChild(canvas);
    canvas.style.setProperty('position', 'fixed', 'important');
    canvas.style.setProperty('left', '0px', 'important');
    canvas.style.setProperty('top', '0px', 'important');
    canvas.style.setProperty('width', width + 'px', 'important');
    canvas.style.setProperty('height', height + 'px', 'important');
    canvas.style.setProperty('display', 'block', 'important');
    canvas.style.setProperty('visibility', 'visible', 'important');
    canvas.style.setProperty('opacity', '1', 'important');
    canvas.style.setProperty('transform', 'none', 'important');
    canvas.style.setProperty('z-index', '2147483647', 'important');
    const rect = canvas.getBoundingClientRect();
    return {
      ok: true,
      identity: 'witness-mounted-same-state-teacher-canvas-v0',
      connected: canvas.isConnected,
      intrinsicWidth: canvas.width,
      intrinsicHeight: canvas.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    };
  })()`, 'mount-renderer-canvas');
  assert.equal(mount?.ok, true, `renderer canvas mount failed: ${JSON.stringify(mount)}`);
  assert.equal(mount.connected, true, 'renderer canvas mount is disconnected');
  assert.ok(mount.rect?.width >= 64 && mount.rect?.height >= 64, 'renderer canvas mount is too small');
  assert.ok(mount.rect.x >= 0 && mount.rect.y >= 0, 'renderer canvas mount is offscreen');
  assert.ok(mount.rect.x + mount.rect.width <= mount.viewportWidth + 0.5, 'renderer canvas mount exceeds viewport width');
  assert.ok(mount.rect.y + mount.rect.height <= mount.viewportHeight + 0.5, 'renderer canvas mount exceeds viewport height');
  return mount;
}

async function evaluate(cdp, expression, phase) {
  const response = await cdp.request('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(`${phase}: ${response.exceptionDetails.text || 'browser evaluation failed'}`);
  return response.result?.value;
}

function createCdpClient(ws) {
  let nextId = 0;
  return {
    request(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolveRequest, rejectRequest) => {
        const onMessage = event => {
          const message = JSON.parse(String(event.data));
          if (message.id !== id) return;
          cleanup();
          if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
          else resolveRequest(message.result);
        };
        const onClose = () => { cleanup(); rejectRequest(new Error(`${method}: WebSocket closed`)); };
        const onError = () => { cleanup(); rejectRequest(new Error(`${method}: WebSocket error`)); };
        const cleanup = () => {
          ws.removeEventListener('message', onMessage);
          ws.removeEventListener('close', onClose);
          ws.removeEventListener('error', onError);
        };
        ws.addEventListener('message', onMessage);
        ws.addEventListener('close', onClose, { once: true });
        ws.addEventListener('error', onError, { once: true });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function waitForCdp(port, process) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (process.exitCode != null) throw new Error(`Chrome exited before CDP opened: ${process.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch {}
    await delay(100);
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

async function findPage(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const pages = await response.json();
    const page = pages.find(target => target.type === 'page' && target.url.includes('kaminos_volume_smoke=1'))
      || pages.find(target => target.type === 'page');
    if (page?.webSocketDebuggerUrl) return page;
    await delay(100);
  }
  throw new Error('could not find Chrome page target');
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

function measurePngActivity(buffer) {
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'render output is not PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, 'render PNG must use 8-bit channels');
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(width >= 64 && height >= 64 && channels > 0 && idat.length > 0, 'render PNG is incomplete');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  let sourceOffset = 0;
  let previous = Buffer.alloc(stride);
  let litPixels = 0;
  let measuredPixels = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[sourceOffset++];
    const row = Buffer.from(raw.subarray(sourceOffset, sourceOffset + stride));
    sourceOffset += stride;
    for (let byte = 0; byte < stride; byte += 1) {
      const left = byte >= channels ? row[byte - channels] : 0;
      const up = previous[byte] || 0;
      const upLeft = byte >= channels ? previous[byte - channels] || 0 : 0;
      if (filter === 1) row[byte] = (row[byte] + left) & 255;
      else if (filter === 2) row[byte] = (row[byte] + up) & 255;
      else if (filter === 3) row[byte] = (row[byte] + Math.floor((left + up) * 0.5)) & 255;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        row[byte] = (row[byte] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 255;
      } else if (filter !== 0) throw new Error(`unsupported render PNG filter ${filter}`);
    }
    for (let x = 0; x < width; x += 2) {
      const pixel = x * channels;
      const luma = row[pixel] * 0.2126 + row[pixel + 1] * 0.7152 + row[pixel + 2] * 0.0722;
      if (luma > 18) litPixels += 1;
      measuredPixels += 1;
    }
    previous = row;
  }
  return {
    width,
    height,
    litPixelFraction: litPixels / Math.max(1, measuredPixels),
    authority: 'decoded-png-luma-nonblank-gate-v0',
  };
}

function upscaleRgba(source, width, height, scale) {
  const output = new Uint8Array(width * scale * height * scale * 4);
  for (let y = 0; y < height * scale; y += 1) {
    for (let x = 0; x < width * scale; x += 1) {
      const sourceOffset = (Math.floor(x / scale) + Math.floor(y / scale) * width) * 4;
      const targetOffset = (x + y * width * scale) * 4;
      output.set(source.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
  return output;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return output;
}

function writeRgbaPng(path, width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function validateConfig(config) {
  if (config?.assay === 'same-state-analytical-calibration') {
    assert.equal(config.schema, CALIBRATION_CONFIG_SCHEMA, 'analytical calibration config schema disagreement');
    assert.ok(config.teacherInitialField?.fluidSha256 && config.teacherInitialField?.frontSha256, 'calibration teacher initial field is missing');
    assert.equal(config.teacherResidual?.residualName, SAME_STATE_TEACHER_CONTRACT.residualName, 'calibration teacher residual identity disagreement');
    assert.equal(config.teacherResidual?.rigidDisplacementSubtraction?.applied, true, 'calibration teacher rigid subtraction is missing');
    assert.equal(config.baselineResponse?.calibrationIdentity, 'baseline-untuned-analytical-control-v0', 'calibration baseline identity disagreement');
    return;
  }
  assert.equal(config?.schema, CONFIG_SCHEMA, 'teacher config schema disagreement');
  assert.ok(Array.isArray(config.horizons) && config.horizons.length > 0, 'teacher horizons are missing');
  assert.ok(config.horizons.every((value, index) => Number.isInteger(value) && value > 0 && (index === 0 || value > config.horizons[index - 1])), 'teacher horizons must increase');
  assert.ok(config.source?.center?.length === 3 && config.source?.velocity?.length === 3, 'teacher source path is missing');
  assert.ok(config.controlControls && config.teacherControls, 'teacher controls are missing');
}

function assertEffectiveRouteControls(effectiveUrl, requestedControls) {
  const effective = new URL(effectiveUrl);
  for (const [key, value] of Object.entries(requestedControls)) {
    assert.equal(
      effective.searchParams.get(key),
      String(value),
      `analytical calibration route control disagreement:${key}`,
    );
  }
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv) {
  const map = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) map.set(key, '1');
    else { map.set(key, value); index += 1; }
  }
  return map;
}

function positiveInteger(value, fallback) {
  const parsed = Math.floor(Number(value || fallback));
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`invalid positive integer: ${value}`);
  return parsed;
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
