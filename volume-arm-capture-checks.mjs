// Checks shared by the transport arm capture and its contract: which requested
// controls took effect in the renderer receipt, and which headless browser the
// capture may launch. Pure functions, no browser, so the negative paths (a
// missing receipt field, no independent browser) can be exercised by a test.
import { accessSync, constants, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveGridHeight } from './volume-grid-shape.mjs';

const solverExpectation = { legacy: { solver: 'legacy' }, converged: { solver: 'converged', openTop: false }, 'converged-open-top': { solver: 'converged', openTop: true } };
// `expectedMode` is the last requested confinement mode (or the admitted one), so
// an arm that only changes the override cannot complete in a different mode.
// `fault` is the capture's injected fault name (or ''), which perturbs the
// observation for the epsilon and null-mode-drift faults.
// The immersed source clears the analytic injector (main 5511fea6b), so the
// analytic receipt reads 'inactive' under that law; the immersed receipt's own
// requested law and admission are the effective route.
export function effectiveEmitterSourceLaw(end) {
  const immersed = end?.immersedSource;
  if (immersed?.requested?.sourceLaw === 'immersed-source' && immersed?.effective?.admitted === true) return 'immersed-source';
  return end?.emitterSourceLaw;
}

export function effectiveMismatches(arm, end, expectedMode, fault = '') {
  const mismatches = [];
  for (const [cid, value] of arm.set) {
    if (cid === 'volume-advection-scheme' && end.transport?.scheme !== value) mismatches.push(`scheme requested ${value}, effective ${end.transport?.scheme}`);
    // Inflow-dependent arms are evidence only while the inflow is admitted: the
    // refused state still carries the default pattern and zero values.
    const inflow = end.inflowBoundary?.effective;
    const inflowRefused = () => `the inflow is not admitted (${inflow?.reason ?? 'no receipt'})`;
    // Under the immersed law the same inlet controls read on the slab (slab
    // inlet dynamics): the receipt to compare against is the immersed source's.
    const immersed = end.immersedSource?.effective;
    const slab = inflow?.admitted !== true && immersed?.admitted === true ? immersed : null;
    if (cid === 'volume-emitter-aperture-pattern') {
      const holder = slab ?? (inflow?.admitted === true ? inflow : null);
      if (!holder) mismatches.push(`aperture pattern requested ${value} but ${inflowRefused()} and the immersed source is ${immersed?.admitted === true ? 'admitted' : `not admitted (${immersed?.reason ?? 'no receipt'})`}`);
      else if (holder.pattern?.kind !== value) mismatches.push(`aperture pattern requested ${value}, effective ${holder.pattern?.kind}`);
    }
    if (cid === 'volume-emitter-swirl') {
      // An absent or nonfinite effective swirl can never satisfy a requested one.
      const effective = inflow?.swirl;
      if (inflow?.admitted !== true) mismatches.push(`swirl requested ${value} but ${inflowRefused()}`);
      else if (!Number.isFinite(effective) || Math.abs(effective - Number(value)) > 1e-6) mismatches.push(`swirl requested ${value}, effective ${effective}`);
    }
    if (cid === 'volume-wind-model' && end.wind?.effective?.model !== value) mismatches.push(`wind model requested ${value}, effective ${end.wind?.effective?.model}`);
    if (cid === 'volume-velocity-staggering') {
      const effective = end.velocityStaggering?.effective;
      // The complete pair is checked: the shader runs from `admitted`, the arm is
      // identified by `mode`, and a receipt that disagrees with itself or lacks
      // either field cannot satisfy either arm.
      if (!effective) mismatches.push(`velocity staggering requested ${value}, no receipt`);
      else if (value === 'staggered' && !(effective.mode === 'staggered' && effective.admitted === true)) mismatches.push(`velocity staggering requested but effective ${effective.mode ?? 'no mode'} / admitted ${effective.admitted} (${effective.reason ?? 'no reason'})`);
      else if (value !== 'staggered' && !(effective.mode === 'collocated' && effective.admitted === false)) mismatches.push(`velocity staggering requested ${value} but effective ${effective.mode ?? 'no mode'} / admitted ${effective.admitted}`);
    }
    if (cid === 'volume-heat-release-expansion') {
      const requestedGain = Number(value); const effective = end.heatRelease?.effective;
      if (!Number.isFinite(requestedGain)) mismatches.push(`heat release requested ${JSON.stringify(value)} is not a number`);
      else if (!Number.isFinite(effective?.expansion)) mismatches.push(`heat release requested ${value}, no receipt`);
      else if (requestedGain > 0 && (effective.admitted !== true || Math.abs(effective.expansion - requestedGain) > 1e-6)) mismatches.push(`heat release requested ${value} but ${effective.admitted ? `effective ${effective.expansion}` : `not admitted (${effective.reason})`}`);
      // Requested off is the control arm: any active or nonzero effective gain fails it.
      else if (requestedGain <= 0 && (effective.admitted === true || Math.abs(effective.expansion) > 1e-6)) mismatches.push(`heat release requested off but ${effective.admitted ? 'admitted' : 'effective'} gain ${effective.expansion}`);
    }
    // Slice-3 inlet controls: the receipt must carry the requested value as a finite number.
    const inletField = { 'volume-emitter-line-weight': ['pattern', 'lineWeight'], 'volume-emitter-jet-jitter': ['pattern', 'jetJitter'], 'volume-emitter-inlet-turbulence': ['inletDynamics', 'turbulence'], 'volume-emitter-inlet-turbulence-scale': ['inletDynamics', 'turbulenceScaleCells'], 'volume-emitter-puff': ['inletDynamics', 'puff'], 'volume-emitter-puff-period': ['inletDynamics', 'puffPeriod'] }[cid];
    if (inletField) {
      const holder = slab ?? (inflow?.admitted === true ? inflow : null);
      const effective = holder?.[inletField[0]]?.[inletField[1]];
      if (!holder) mismatches.push(`${cid} requested ${value} but ${inflowRefused()} and no admitted immersed source holds it`);
      else if (!Number.isFinite(effective) || Math.abs(effective - Number(value)) > 1e-6) mismatches.push(`${cid} requested ${value}, effective ${effective}`);
    }
    if (cid === 'volume-emitter-source-law') {
      const effectiveLaw = effectiveEmitterSourceLaw(end);
      if (effectiveLaw !== value) mismatches.push(`emitter source law requested ${value}, effective ${effectiveLaw}`);
      if (value === 'inflow-boundary' && end.inflowBoundary?.effective?.admitted !== true) mismatches.push(`inflow-boundary requested but not admitted${end.inflowBoundary?.effective?.reason ? ` (${end.inflowBoundary.effective.reason})` : ''}`);
      if (value === 'immersed-source' && end.immersedSource?.effective?.admitted !== true) mismatches.push(`immersed-source requested but not admitted${end.immersedSource?.effective?.reason ? ` (${end.immersedSource.effective.reason})` : ''}`);
    }
    // Immersed source controls (review IS-05): a source-dependent arm needs an
    // admitted receipt, and every control it sets is compared to the receipt's
    // requested value (the resolver's clamped reading of the control).
    const immersedField = { 'volume-immersed-centre-x': ['centre', 0], 'volume-immersed-centre-y': ['centre', 1], 'volume-immersed-centre-z': ['centre', 2], 'volume-immersed-yaw': ['yaw'], 'volume-immersed-pitch': ['pitch'], 'volume-immersed-radius': ['radius'], 'volume-immersed-thickness': ['thickness'], 'volume-immersed-speed': ['speed'], 'volume-immersed-fuel': ['fuel'], 'volume-immersed-temperature': ['temperature'], 'volume-immersed-momentum-gain': ['momentumGain'], 'volume-immersed-cap-fraction': ['capFraction'], 'volume-immersed-back-wall': ['backWall'] }[cid];
    if (immersedField) {
      const receipt = end.immersedSource;
      if (receipt?.effective?.admitted !== true) mismatches.push(`${cid} requested ${value} but the immersed source is not admitted (${receipt?.effective?.reason ?? 'no receipt'})`);
      else if (immersedField[0] === 'backWall') {
        const wanted = Number(value) >= 0.5;
        if (receipt.requested?.backWall !== wanted || receipt.effective.backWall?.requested !== wanted) mismatches.push(`${cid} requested ${value}, receipt requested ${receipt.requested?.backWall} / effective ${receipt.effective.backWall?.requested}`);
      } else {
        const effective = immersedField.length === 2 ? receipt.requested?.[immersedField[0]]?.[immersedField[1]] : receipt.requested?.[immersedField[0]];
        if (!Number.isFinite(effective) || Math.abs(effective - Number(value)) > 1e-6) mismatches.push(`${cid} requested ${value}, receipt ${effective}`);
      }
    }
    if (cid === 'volume-grid-height-ratio') {
      // The resolver at the effective width is the expectation (review GH-05):
      // a clamped or snapped request passes at its resolved height and mode; a
      // receipt missing an authority-bearing field, for another width, or
      // refused by the device fails the arm.
      const dims = end.gridDimensions; const height = end.gridHeight;
      const width = Array.isArray(dims) && dims.length === 3 ? dims[0] : null;
      let expected = null;
      try { expected = Number.isInteger(width) ? resolveGridHeight({ gridHeightRatio: Number(value) || 2 }, width) : null; } catch { expected = null; }
      const modes = ['auto-twice-width', 'requested', 'requested-snapped', 'requested-clamped'];
      if (!expected || !height) mismatches.push(`grid height requested ${value}, no valid grid receipt (dimensions ${JSON.stringify(dims ?? null)})`);
      else if (height.admitted !== true) mismatches.push(height.admitted === false
        ? `grid height requested ${value} was refused by the device (${height.admissionReason ?? 'no reason'})`
        : `grid height requested ${value}: the receipt carries no affirmative admission (admitted ${JSON.stringify(height.admitted ?? null)})`);
      else if (!modes.includes(height.mode) || height.widthCells !== width || height.heightCells !== expected.heightCells || height.mode !== expected.mode || dims[1] !== expected.heightCells) {
        mismatches.push(`grid height requested ${value}: expected ${expected.heightCells} (${expected.mode}) at width ${width}, receipt ${height.heightCells} (${height.mode ?? 'no mode'}, width ${height.widthCells ?? 'none'}), effective ${dims[1]}`);
      }
    }
    if (cid === 'volume-time-step' && end.timeStep?.mode !== value) mismatches.push(`time step requested ${value}, effective ${end.timeStep?.mode}${end.timeStep?.reason ? ` (${end.timeStep.reason})` : ''}`);
    if (cid === 'volume-confinement') {
      if (end.confinement?.mode !== value) mismatches.push(`confinement requested ${value}, effective ${end.confinement?.mode}`);
      const packedMode = { 'curl-slider': 0, calibrated: 1, off: 2 }[value];
      if (end.confinementUniform?.mode !== packedMode) mismatches.push(`confinement ${value} requested but uniform slot 345 holds mode ${end.confinementUniform?.mode}`);
    }
    if (cid === '@confinementEpsilon') {
      // The shader reads uniform slot 346 (a Float32Array element), so the packed
      // value must equal the float32 rounding of the request, not just the
      // resolver's double. `packed-epsilon` perturbs the observation to prove
      // this comparison can fail.
      const packed = end.confinementUniform?.confinementAmount;
      const observed = fault === 'packed-epsilon' ? (Number(packed) || 0) + 1 : packed;
      // The drift fault targets the null-override arm specifically, the case the
      // confirmation review constructed (override-only arm ending in `off`).
      const observedMode = fault === 'null-mode-drift' && value === 'null' ? 'off' : end.confinement?.mode;
      const packedMode = { 'curl-slider': 0, calibrated: 1, off: 2 }[expectedMode];
      if (!expectedMode) mismatches.push('override requested but no confinement mode has been requested or admitted');
      else if (observedMode !== expectedMode) mismatches.push(`confinement mode drifted: expected ${expectedMode} (last requested or admitted), observed ${observedMode}`);
      else if (!(fault === 'null-mode-drift' && value === 'null') && end.confinementUniform?.mode !== packedMode) mismatches.push(`confinement mode ${expectedMode} expected but uniform slot 345 holds ${end.confinementUniform?.mode}`);
      if (value === 'null') {
        if (expectedMode === 'calibrated') {
          if (end.confinement?.calibration?.source !== 'table') mismatches.push(`null override requested but calibration source is ${end.confinement?.calibration?.source}`);
          if (observed !== Math.fround(Number(end.confinement?.calibration?.epsilon))) mismatches.push(`null override: packed epsilon ${observed} is not the table value ${end.confinement?.calibration?.epsilon}`);
        }
      } else {
        if (end.confinement?.confinementAmount !== Number(value)) mismatches.push(`confinement epsilon override ${value} requested, effective amount ${end.confinement?.confinementAmount} (mode ${end.confinement?.mode})`);
        if (observed !== Math.fround(Number(value))) mismatches.push(`packed epsilon ${observed} is not the float32 of the requested ${value} (${Math.fround(Number(value))})`);
      }
    }
    if (cid === 'volume-pressure-solver') {
      const expected = solverExpectation[value];
      if (!expected) mismatches.push(`unknown solver request ${value}`);
      else if (end.solver?.solver !== expected.solver || (expected.openTop !== undefined && Boolean(end.solver?.openTop) !== expected.openTop)) mismatches.push(`solver requested ${value}, effective ${end.solver?.solver}${end.solver?.openTop ? ' open top' : ''}`);
    }
  }
  return mismatches;
}

// The headless browser must be an independent executable (Chrome for Testing /
// Playwright Chromium), never the installed GUI Chrome app bundle: on a shared
// operator machine a headless launch of that bundle absorbs ordinary
// `open -a` launches and clicked links. Resolution order: the
// KAMINOS_HEADLESS_BROWSER environment variable, then the newest Playwright
// Chromium under the Playwright cache. The refusal is by canonical identity
// (realpath, so dot segments and symlink aliases resolve), the candidate must
// be an executable regular file, and absence fails visibly.
const GUI_CHROME = /\/Applications\/Google Chrome\.app\//;
function admitExecutable(candidate, source) {
  let resolved;
  try { resolved = realpathSync(candidate); } catch { throw new Error(`${source} does not exist: ${candidate}`); }
  if (GUI_CHROME.test(resolved) || GUI_CHROME.test(candidate)) throw new Error(`${source} names the installed GUI Chrome (${candidate} -> ${resolved}); headless capture needs an independent executable`);
  let ok = false;
  try { ok = statSync(resolved).isFile(); if (ok) accessSync(resolved, constants.X_OK); } catch { ok = false; }
  if (!ok) throw new Error(`${source} is not an executable file: ${candidate} -> ${resolved}`);
  return { executable: candidate, resolvedExecutable: resolved, source };
}
export function resolveHeadlessBrowser({ env = process.env, playwrightRoot = join(homedir(), 'Library', 'Caches', 'ms-playwright') } = {}) {
  const override = env.KAMINOS_HEADLESS_BROWSER;
  if (override) return admitExecutable(override, 'KAMINOS_HEADLESS_BROWSER');
  let candidates = [];
  try {
    candidates = readdirSync(playwrightRoot)
      .map(name => ({ name, revision: Number((name.match(/^chromium-(\d+)$/) || [])[1]) }))
      .filter(entry => Number.isFinite(entry.revision))
      .sort((a, b) => b.revision - a.revision)
      .map(entry => join(playwrightRoot, entry.name, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'))
      .filter(path => existsSync(path));
  } catch { candidates = []; }
  if (candidates.length === 0) throw new Error(`no independent headless browser: set KAMINOS_HEADLESS_BROWSER or install Playwright Chromium (looked under ${playwrightRoot})`);
  return admitExecutable(candidates[0], 'playwright-chromium');
}

// Arm grammar: `name[,controlId=value,...]` joined by `;`. Fails loud on a name
// that carries controls (a ':' or '=' in the name) or a control without '=', so
// a mistyped arm cannot run the saved basin under a misleading label.
// `@cameraFrame=x:y:z:tx:ty:tz` frames the scene camera for an arm: the
// basins' saved cameras are zoomed and a grid-height witness has to see the
// top of the box. Strict: six finite numbers or nothing.
export function parseCameraFrame(value) {
  const parts = String(value ?? '').split(':');
  if (parts.length !== 6 || parts.some(part => part.trim() === '')) return null;
  const numbers = parts.map(Number);
  if (numbers.some(v => !Number.isFinite(v))) return null;
  return { position: numbers.slice(0, 3), target: numbers.slice(3) };
}

// The effective camera frame must be the requested one; anything missing or
// off by more than the tolerance is a mismatch (the arm fails).
export function cameraFrameMismatch(requested, effective, tolerance = 1e-4) {
  if (!effective || !Array.isArray(effective.position) || !Array.isArray(effective.target)
    || effective.position.length !== 3 || effective.target.length !== 3) return 'no effective camera frame';
  const offsets = [...requested.position.map((v, i) => Math.abs(v - effective.position[i])), ...requested.target.map((v, i) => Math.abs(v - effective.target[i]))];
  return offsets.some(offset => !(offset <= tolerance)) ? `camera frame requested ${JSON.stringify(requested)}, effective ${JSON.stringify(effective)}` : null;
}

export function parseArms(armsArg) {
  return String(armsArg ?? '').split(';').map(a => {
    const [name, ...pairs] = a.split(',');
    if (!name) throw new Error(`empty arm in "${armsArg}"`);
    if (/[:=]/.test(name)) throw new Error(`arm name "${name}" contains ':' or '='; arms are name[,controlId=value,...]`);
    const set = pairs.map(p => {
      const eq = p.indexOf('=');
      if (eq < 1) throw new Error(`control "${p}" in arm "${name}" has no '='`);
      return [p.slice(0, eq), p.slice(eq + 1)];
    });
    return { name, set };
  });
}

// Emissive seed coefficient witness (review GR-01): an arm fails unless the
// readback is a complete, finite, nonzero and spatially varying field.
export function emissiveCoefficientsMismatch(sample, { minProducerStep = null } = {}) {
  if (!sample || sample.status !== 'sampled') return `emissive coefficients ${sample?.status ?? 'missing'}${sample?.reason ? ` (${sample.reason})` : ''}`;
  const p = sample.producer;
  if (!p) return 'emissive coefficients have no producer (no seed dispatch recorded)';
  if (String(p.grid) !== String(sample.grid)) return `emissive coefficients produced at grid ${p.grid}, current ${sample.grid}`;
  if (!(p.frameLag <= 2)) return `emissive coefficients stale: produced ${p.frameLag} frames ago`;
  if (minProducerStep !== null && !(p.simStepCount >= minProducerStep)) return `emissive coefficients produced at step ${p.simStepCount}, before the configuration took effect at step ${minProducerStep}`;
  if (sample.finiteCells !== sample.cells) return `emissive coefficients have non-finite cells (${sample.cells - sample.finiteCells})`;
  if (!(sample.nonzeroCells > 0)) return 'emissive coefficients have no nonzero cell';
  if (!(sample.extinctionStdDev > 0)) return 'emissive coefficients are spatially flat';
  return null;
}

// Capture controls that read or frame without changing the simulation; every
// other control, including any other debug control, is configuration
// (post-landing review of 2eef9ccdd: @confinementEpsilon slipped through a
// guard that exempted every debug control).
export const NON_CONFIGURING_CAPTURE_CONTROLS = new Set(['@emissiveCoefficients', '@cameraFrame', '@savePreset', '@simGpuProfile', '@fluidBandStats', '@joinedExteriorProbe']);
export function armSetsConfiguration(set) {
  return set.some(([id]) => !NON_CONFIGURING_CAPTURE_CONTROLS.has(id));
}

// Joined boundary arm (Sexy's stationary candidate): a requested join must be
// admitted with a lower-plane texture of the grid's size and the producer
// handles present; a release must leave the 1x1x3 placeholder.
export function joinedBoundaryMismatch(value, sample) {
  if (!sample?.receipt || !sample?.producer) return 'joined boundary sample missing';
  const want = value === '1';
  const { receipt, producer } = sample;
  if (want && !receipt.admitted) return `joined boundary not admitted (${receipt.reason ?? 'no reason'})`;
  if (!want && receipt.admitted) return 'joined boundary still admitted after release';
  const side = Math.max(...producer.dims);
  const expected = want ? [side, side, 3] : [1, 1, 3];
  if (String(producer.lowerFaceTextureSize) !== String(expected)) return `joined boundary lower-plane texture ${producer.lowerFaceTextureSize}, expected ${expected}`;
  if (want && !(producer.fluidBuffer && producer.burnRateTexture)) return 'joined boundary producer handles missing';
  return null;
}

// '@joinedGhostsSynthetic=<heat>:<upward exterior velocity>' (witness only).
export function parseSyntheticGhosts(value) {
  const parts = String(value ?? '').split(':').map(Number);
  if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
  return { heat: parts[0], velocityY: parts[1] };
}

// At settlement a synthetic-ghost arm must still be consuming the requested
// fill (review JG-02-C): the shader reads the ghosts only while the join is
// admitted, `bound` alone is geometry eligibility, and a rebuild clears the fill.
export function syntheticGhostSettlementMismatch(requestedValue, end) {
  if (requestedValue === undefined) return null;
  const requested = parseSyntheticGhosts(requestedValue);
  if (!requested) return `@joinedGhostsSynthetic needs heat:velocityY, got ${requestedValue}`;
  if (!end?.joinedAdmitted) return 'ended with the joined boundary no longer admitted';
  if (!end.joinedGhostsBound) return 'ended with the synthetic ghosts no longer bound';
  const fill = end.joinedGhostsSynthetic;
  if (!fill) return 'ended with the synthetic fill gone';
  const v = fill.velocityLocal ?? [];
  const matches = fill.heat === requested.heat && v[1] === requested.velocityY && v[0] === 0 && v[2] === 0 && fill.soot === 0 && fill.fuel === 0;
  return matches ? null : `ended with synthetic fill ${JSON.stringify(fill)}, requested heat ${requested.heat}, velocityY ${requested.velocityY}`;
}
