import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readRawEvidence } from './witness-raw.mjs';

export function renderingAdvanced({ before, counter, stopOnTerminal = false }) {
  return Boolean((stopOnTerminal && window.__photoLifecycle.terminal) || window.__materialPhoto.gpuErrors?.length ||
    window.__materialPhotoActions.presentation().renderCallbacks[counter] > before);
}

export function validateCancellation(row) {
  if (row.paused?.status !== 'paused' || !(row.frames > 0) || row.terminal?.status !== 'rejected' ||
      row.terminal.name !== 'AbortError' || !row.displayedBefore || row.displayedBefore !== row.displayedAfter ||
      row.operation?.stage !== null || row.operation.phase !== null || row.model?.loaded !== true ||
      row.model.phase !== 'idle' || row.model.error) throw Error(`Invalid ${row.stage} cancellation or retained display`);
}

export function validateRetry(before, after) {
  if (!before?.bytes?.length || !after?.bytes?.length ||
      !['width', 'height', 'type'].every(key => before[key] === after[key]) || !before.bytes.equals(after.bytes)) {
    throw Error('Retry changed raw output bytes or layout');
  }
}

// Runs inside the existing native generation browser, after its fresh result is displayed.
// No model substitute, private runtime, or extra browser/weight load is introduced.
export async function exercisePhotoApplications(page, out, report, save) {
  const state = report.application = { phase: 'baseline', raw: {}, cancellations: [], retries: [] };
  const channels = ['geometry-depth', 'geometry-normals', 'geometry-points', 'geometry-colors',
    'image', 'albedo', 'roughness', 'metallic', 'orm', 'plane-albedo', 'plane-orm'];
  const capture = async (name, sourceName = name) => {
    const result = {}, manifest = state.raw[name] = {};
    for (const channel of channels) {
      const raw = await readRawEvidence(expression => page.evaluate(expression), channel, `window.__photoLifecycle.${sourceName}`);
      const file = path.join(out, `${name}-${channel}.bin`);
      await fs.writeFile(file, raw.bytes);
      const { bytes, ...layout } = raw;
      manifest[channel] = { ...layout, file, sha256: createHash('sha256').update(bytes).digest('hex') };
      result[channel] = raw;
    }
    await save(); return result;
  };
  await page.evaluate(async () => {
    const actions = window.__materialPhotoActions, apps = actions.inferenceApps();
    const { createMaterialPhotoOperation } = await import('../../models/material-photo/material-photo-operation.js');
    const baseline = { ...actions.materialEvidence(), geometry: actions.exampleEvidence().geometry };
    if (!baseline.geometry || !baseline.output || !apps.geometry.model?.useRealWeights) throw Error('Fresh native models and result required');
    window.__photoLifecycle = { apps, operation: createMaterialPhotoOperation(apps), baseline };
  });
  const baseline = await capture('baseline');
  const start = async retained => page.evaluate(retained => {
    const test = window.__photoLifecycle;
    test.terminal = null; test.progress = []; test.current = null;
    test.pending = test.operation.infer({ image: test.baseline.image, size: test.baseline.output.width,
      ...(retained ? { depth: test.baseline.geometry } : {}),
      onProgress: event => test.progress.push(event),
    }).then(result => {
      test.current = { image: test.baseline.image, geometry: result.depth, output: result.maps };
      test.terminal = { status: 'resolved' };
    }, error => { test.terminal = { status: 'rejected', name: error.name, message: error.message }; });
  }, retained);

  for (const stage of ['geometry', 'materials']) {
    state.phase = `${stage}-cancellation`; await save();
    const displayedBefore = await page.evaluate(() => window.__materialPhotoActions.presentation().physicalbaseline.activeMaterial.mapUUID);
    await start(stage === 'materials');
    // For materials require an actual retired producer duty. Geometry exposes the
    // control's active work boundary, which can include CPU preparation/yield work.
    await page.waitForFunction(stage => {
      const t = window.__photoLifecycle;
      return t.terminal || (t.apps[stage].snapshot().control?.activeDutyCount > 0 &&
        (stage === 'geometry' || t.progress.some(e => e.stage === 'materials' && e.detail?.duties > 0)));
    }, stage);
    const paused = await page.evaluate(async stage => {
      const t = window.__photoLifecycle;
      if (t.terminal) throw Error('Inference terminated before the requested interruption');
      await t.apps[stage].pause();
      return t.apps[stage].snapshot().control;
    }, stage);
    const framesBefore = await page.evaluate(() => window.__materialPhotoActions.presentation().renderCallbacks.duringModel);
    await page.waitForFunction(renderingAdvanced, { before: framesBefore, counter: 'duringModel', stopOnTerminal: true });
    const frames = await page.evaluate(before => window.__materialPhotoActions.presentation().renderCallbacks.duringModel - before, framesBefore);
    await page.evaluate(() => { window.__photoLifecycle.operation.stop('native application witness'); });
    await page.waitForFunction(() => Boolean(window.__photoLifecycle.terminal));
    const row = await page.evaluate(stage => {
      const t = window.__photoLifecycle;
      return { stage, terminal: t.terminal, progress: t.progress, operation: t.operation.snapshot(),
        model: t.apps[stage].snapshot(), displayedAfter: window.__materialPhotoActions.presentation().physicalbaseline.activeMaterial.mapUUID };
    }, stage);
    Object.assign(row, { paused, frames, displayedBefore }); state.cancellations.push(row); await save();
    validateCancellation(row);
    const cancelledRetained = await capture(`${stage}CancelledRetained`, 'baseline');
    for (const channel of channels) validateRetry(baseline[channel], cancelledRetained[channel]);
    if (stage === 'geometry' && row.progress.some(e => e.stage === 'materials')) throw Error('Cancelled geometry started materials');

    state.phase = `${stage}-retry`; await save();
    await start(stage === 'materials');
    await page.waitForFunction(() => Boolean(window.__photoLifecycle.terminal));
    const retry = await page.evaluate(stage => {
      const t = window.__photoLifecycle;
      if (t.terminal.status !== 'resolved') throw Error(`Native retry failed: ${JSON.stringify(t.terminal)}`);
      t[`${stage}Retry`] = t.current;
      return { stage, terminal: t.terminal, progress: t.progress,
        retainedDepth: t.current.geometry === t.baseline.geometry,
        geometry: t.apps.geometry.snapshot(), materials: t.apps.materials.snapshot() };
    }, stage);
    state.retries.push(retry); await save();
    if (stage === 'materials' && (!retry.retainedDepth || retry.progress.some(e => e.stage === 'geometry' && e.phase !== 'retained'))) {
      throw Error('Retained depth retry reran geometry');
    }
    const current = await capture(`${stage}Retry`);
    for (const channel of channels) validateRetry(baseline[channel], current[channel]);
    const retriedRetained = await capture(`${stage}RetriedRetained`, 'baseline');
    for (const channel of channels) validateRetry(baseline[channel], retriedRetained[channel]);
  }
  state.phase = 'borrowed-app-cleanup'; await save();
  state.cleanup = await page.evaluate(async () => {
    const { apps } = window.__photoLifecycle;
    await apps.geometry.destroy(); await apps.materials.destroy();
    return { session: apps.session.snapshot().status, geometry: apps.geometry.snapshot(), materials: apps.materials.snapshot(),
      framesBefore: window.__materialPhotoActions.presentation().renderCallbacks.rendered };
  });
  await page.waitForFunction(renderingAdvanced, { before: state.cleanup.framesBefore, counter: 'rendered' });
  state.cleanup.frames = await page.evaluate(before => window.__materialPhotoActions.presentation().renderCallbacks.rendered - before, state.cleanup.framesBefore);
  if (state.cleanup.session !== 'active' || !(state.cleanup.frames > 0) ||
      !['geometry', 'materials'].every(name => state.cleanup[name].destroyed && !state.cleanup[name].loaded)) {
    throw Error('Borrowed app cleanup did not preserve the rendering host');
  }
  state.phase = 'passed'; await save();
}
