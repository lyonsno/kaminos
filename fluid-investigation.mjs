import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {serialize} from 'node:v8';
import assert from 'node:assert/strict';
import {retainInvestigationCapture} from './investigation-capture.mjs';

// The calling Node connection stays alive while the human uses this component.
// Its output directory is caller-owned; the scene and its controls remain owned
// by the mounted workbench. Finish releases recording, not the browser's water.
export async function mountFluidInvestigation({page, out, source, guide}) {
  out = path.resolve(out);
  await fs.mkdir(out, {recursive: true});
  const reportPath = path.join(out, 'investigation.json');
  const file = await fs.open(reportPath, 'wx'); await file.close();
  const id = randomUUID(), binding = `__kaminosInvestigation_${id.replaceAll('-', '')}`;
  const report = {id, source, status: 'starting', captures: [], startedAt: new Date().toISOString()};
  const save = async () => {
    await fs.writeFile(`${reportPath}.next`, JSON.stringify(report, null, 2));
    await fs.rename(`${reportPath}.next`, reportPath);
  };
  await save();
  let resolveFinished, rejectFinished, busy = false;
  const finished = new Promise((resolve, reject) => {resolveFinished = resolve; rejectFinished = reject;});
  // Startup callers may not yet have received the handle when setup fails.
  finished.catch(() => {});
  const read = () => page.evaluate(id => window.__kaminosInvestigations.get(id).read(), id);
  const capture = async note => {
    assert.equal(report.status, 'recording', 'Investigation is not recording');
    assert.equal(busy, false, 'Capture already in progress'); busy = true;
    const captureOut = path.join(out, randomUUID());
    const entry = {out: captureOut, status: 'capturing'};
    report.captures.push(entry);
    try {
      await save();
      const retained = await retainInvestigationCapture({out: captureOut, source, recordingId: id,
        read, capture: () => page.screenshot(), note});
      entry.status = 'retained'; entry.interval = retained.result.interval;
      await save();
      return {message: 'Capture retained', report: path.join(captureOut, 'report.json'), interval: entry.interval};
    } catch (error) {
      entry.status = 'failed'; entry.failure = String(error); await save(); throw error;
    } finally {busy = false;}
  };
  const finish = async note => {
    assert.equal(busy, false, 'Wait for the active capture before finishing');
    assert.equal(report.status, 'recording', 'Investigation is not recording');
    busy = true;
    try {
      const final = await page.evaluate(id => window.__kaminosInvestigations.get(id).finish(), id);
      await fs.writeFile(path.join(out, 'recording.v8'), serialize(final), {flag: 'wx'});
      report.status = 'finished'; report.complete = final.recording.complete;
      report.note = note; report.recording = 'recording.v8'; report.finishedAt = new Date().toISOString();
      await save();
      await page.evaluate(id => window.__kaminosInvestigations.get(id).disconnect('Investigation retained'), id);
      resolveFinished(report);
      return {message: 'Investigation retained', report: reportPath};
    } finally {busy = false;}
  };
  const disconnected = () => {
    if (report.status !== 'recording') return;
    report.status = 'disconnected'; report.failure = 'Owned page closed before recording was finished';
    save().then(() => rejectFinished(Error(report.failure)), rejectFinished);
  };
  try {
    await page.exposeBinding(binding, async ({page: caller, frame}, request) => {
      assert.equal(caller, page, 'Capture caller page differs');
      assert.equal(frame, page.mainFrame(), 'Capture requires the mounted main frame');
      if (request.action === 'capture') return capture(request.note);
      if (request.action === 'finish') return finish(request.note);
      throw Error('Unknown investigation action');
    });
    await page.evaluate(async ({id, binding, source, guide}) => {
      const {createInvestigationRecording} = await import('./investigation-recording.mjs');
      const {createInvestigationGuide} = await import('./investigation-guide.mjs');
      if (!window.kaminosFluidWorkbenchSetInvestigation) throw Error('Fluid investigation mount unavailable');
      window.__kaminosInvestigations ??= new Map();
      if ([...window.__kaminosInvestigations.values()].some(item => item.read().recording.status === 'recording')) {
        throw Error('This page already has an active investigation');
      }
      const context = () => ({clock: window.kaminosFingerFluidBenchSessionState(),
        controls: window.kaminosFingerFluidPressureCockpitState(),
        camera: window.kaminosNavigationState(), scene: window.kaminosSceneAuthoring.read(),
        edits: window.kaminosSceneEdits.state(), viewport: {width: innerWidth, height: innerHeight}});
      const recording = createInvestigationRecording({id, source, initial: context(),
        startingConditions: {kind: 'live-runtime', reconstructAfterRestart: false}});
      const component = createInvestigationGuide({document, ...guide,
        onCapture: note => window[binding]({action: 'capture', note}),
        onFinish: note => window[binding]({action: 'finish', note})});
      const read = () => ({recording: recording.snapshot(), context: context()});
      window.__kaminosInvestigations.set(id, {read, finish: () => {
        recording.finish(); return read();
      }, disconnect: message => component.disconnect(message)});
      try {window.kaminosFluidWorkbenchSetInvestigation(component.node);}
      catch (error) {recording.finish(); component.disconnect(); throw error;}
    }, {id, binding, source, guide});
    report.status = 'recording'; await save();
    page.on('close', disconnected);
    finished.finally(() => page.off('close', disconnected)).catch(() => {});
    return {id, capture, finish, finished, reportPath};
  } catch (error) {
    report.status = 'failed'; report.failure = String(error); await save();
    rejectFinished(error); throw error;
  }
}
