// Checks shared by the transport arm capture and its contract: which requested
// controls took effect in the renderer receipt, and which headless browser the
// capture may launch. Pure functions, no browser, so the negative paths (a
// missing receipt field, no independent browser) can be exercised by a test.
import { accessSync, constants, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const solverExpectation = { legacy: { solver: 'legacy' }, converged: { solver: 'converged', openTop: false }, 'converged-open-top': { solver: 'converged', openTop: true } };
// `expectedMode` is the last requested confinement mode (or the admitted one), so
// an arm that only changes the override cannot complete in a different mode.
// `fault` is the capture's injected fault name (or ''), which perturbs the
// observation for the epsilon and null-mode-drift faults.
export function effectiveMismatches(arm, end, expectedMode, fault = '') {
  const mismatches = [];
  for (const [cid, value] of arm.set) {
    if (cid === 'volume-advection-scheme' && end.transport?.scheme !== value) mismatches.push(`scheme requested ${value}, effective ${end.transport?.scheme}`);
    if (cid === 'volume-emitter-aperture-pattern' && end.inflowBoundary?.effective?.pattern?.kind !== value) mismatches.push(`aperture pattern requested ${value}, effective ${end.inflowBoundary?.effective?.pattern?.kind}`);
    if (cid === 'volume-emitter-swirl') {
      // An absent or nonfinite effective swirl can never satisfy a requested one.
      const effective = end.inflowBoundary?.effective?.swirl;
      if (!Number.isFinite(effective) || Math.abs(effective - Number(value)) > 1e-6) mismatches.push(`swirl requested ${value}, effective ${effective}`);
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
      const effective = end.inflowBoundary?.effective?.[inletField[0]]?.[inletField[1]];
      if (!Number.isFinite(effective) || Math.abs(effective - Number(value)) > 1e-6) mismatches.push(`${cid} requested ${value}, effective ${effective}`);
    }
    if (cid === 'volume-emitter-source-law') {
      if (end.emitterSourceLaw !== value) mismatches.push(`emitter source law requested ${value}, effective ${end.emitterSourceLaw}`);
      if (value === 'inflow-boundary' && end.inflowBoundary?.effective?.admitted !== true) mismatches.push(`inflow-boundary requested but not admitted${end.inflowBoundary?.effective?.reason ? ` (${end.inflowBoundary.effective.reason})` : ''}`);
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
