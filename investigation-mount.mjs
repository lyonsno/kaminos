import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {serialize} from 'node:v8';
import assert from 'node:assert/strict';
import {retainInvestigationCapture} from './investigation-capture.mjs';

// The installer binds owner context to this page. Retention and page lifetime
// stay shared; an explicit owner transaction may bracket capture.
export async function mountInvestigation({page, out, source, install,
  captureKind = 'passive-display', aroundCapture = retain => retain()}) {
  out = path.resolve(out);
  await fs.mkdir(out, {recursive: true});
  const reportPath = path.join(out, 'investigation.json');
  const file = await fs.open(reportPath, 'wx'); await file.close();
  const id = randomUUID(), binding = `__kaminosInvestigation_${id.replaceAll('-', '')}`;
  const report = {id, source, status: 'starting', phase: 'install', captures: [], startedAt: new Date().toISOString()};
  let writing = Promise.resolve();
  const save = () => {
    const content = JSON.stringify(report, null, 2);
    writing = writing.catch(() => {}).then(async () => {
      await fs.writeFile(`${reportPath}.next`, content);
      await fs.rename(`${reportPath}.next`, reportPath);
    });
    return writing;
  };
  await save();
  let adapter, resolveFinished, rejectFinished, busy = false, frozen = null, lost = null, completed = false;
  const finished = new Promise((resolve, reject) => {resolveFinished = resolve; rejectFinished = reject;});
  // Startup callers may not yet have received the handle when setup fails.
  finished.catch(() => {});
  const read = () => adapter.read();
  const capture = async note => {
    assert.equal(report.status, 'recording', 'Investigation is not recording');
    assert.equal(busy, false, 'Capture already in progress'); busy = true;
    const captureOut = path.join(out, randomUUID());
    const entry = {out: captureOut, kind: captureKind, status: 'capturing'};
    report.captures.push(entry);
    let retention, calls = 0, accepting = true;
    const retain = () => {
      assert.ok(accepting && ++calls === 1, 'Capture transaction must retain exactly once');
      retention = retainInvestigationCapture({out: captureOut, source, recordingId: id,
        read, capture: () => page.screenshot(), note});
      retention.catch(() => {});
      return retention;
    };
    try {
      await save();
      await aroundCapture(retain, {note, id, source});
      accepting = false;
      assert.equal(calls, 1, 'Capture transaction must retain exactly once');
      const retained = await retention;
      if (lost) throw lost;
      entry.status = 'retained'; entry.interval = retained.result.interval;
      await save();
      return {message: 'Capture retained', report: path.join(captureOut, 'report.json'), interval: entry.interval};
    } catch (error) {
      accepting = false;
      await retention?.catch(() => {});
      entry.status = 'failed'; entry.failure = String(error); await save(); throw error;
    } finally {busy = false;}
  };
  const finish = async note => {
    assert.equal(busy, false, 'Wait for the active capture before finishing');
    assert.ok(['recording', 'finish-failed'].includes(report.status), 'Investigation cannot finish in this state');
    busy = true;
    try {
      report.status = 'finishing';
      frozen ??= await adapter.finish();
      assert.equal(frozen?.recording?.id, id, 'Recording identity changed');
      assert.deepEqual(frozen.recording.source, source, 'Recording source changed');
      await save();
      const payload = serialize(frozen), destination = path.join(out, 'recording.v8');
      try {await fs.writeFile(destination, payload, {flag: 'wx'});}
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        // Retrying a metadata failure may find the exact payload already written.
        const stat = await fs.stat(destination);
        if (!stat.isFile() || !(await fs.readFile(destination)).equals(payload)) throw error;
      }
      if (lost) throw lost;
      report.status = 'finished'; report.complete = frozen.recording.complete;
      report.note = note; report.recording = 'recording.v8'; report.finishedAt = new Date().toISOString();
      delete report.failure;
      await save();
      if (lost) throw lost;
      completed = true;
      resolveFinished(report);
      await Promise.resolve().then(() => adapter.disconnect('Investigation retained')).catch(() => {});
      return {message: 'Investigation retained', report: reportPath};
    } catch (error) {
      if (!lost) {
        report.status = 'finish-failed'; report.failure = String(error); await save();
        await adapter.saveFailed(`Recording stopped; save failed: ${error.message}`);
      }
      throw error;
    } finally {busy = false;}
  };
  const terminate = reason => {
    if (completed || ['disconnected', 'failed'].includes(report.status)) return;
    lost = Error(reason);
    report.status = 'disconnected'; report.failure = reason;
    save().then(() => rejectFinished(lost), rejectFinished);
  };
  const disconnected = () => terminate('Owned page lost before recording was retained');
  const navigated = frame => {
    if (frame !== page.mainFrame()) return;
    Promise.resolve().then(() => adapter.isPresent())
      .then(present => {if (!present) terminate('Owned main-frame investigation was replaced');})
      .catch(() => terminate('Owned main-frame investigation was lost during navigation'));
  };
  try {
    assert.equal(typeof install, 'function', 'Investigation installer required');
    assert.ok(typeof captureKind === 'string' && captureKind, 'Capture kind required');
    assert.equal(typeof aroundCapture, 'function', 'Capture transaction required');
    await page.exposeBinding(binding, async ({page: caller, frame}, request) => {
      assert.equal(caller, page, 'Capture caller page differs');
      assert.equal(frame, page.mainFrame(), 'Capture requires the mounted main frame');
      if (request.action === 'capture') return capture(request.note);
      if (request.action === 'finish') return finish(request.note);
      throw Error('Unknown investigation action');
    });
    adapter = await install({id, binding, source});
    for (const name of ['read', 'finish', 'disconnect', 'saveFailed', 'isPresent'])
      assert.equal(typeof adapter?.[name], 'function', `Investigation adapter requires ${name}`);
    assert.equal(page.isClosed(), false, 'Owned page lost during investigation installation');
    assert.equal(await adapter.isPresent(), true, 'Installed investigation is missing');
    report.status = 'recording'; report.phase = 'recording'; await save();
    page.on('close', disconnected);
    page.on('crash', disconnected);
    page.on('framenavigated', navigated);
    const browser = page.context().browser();
    browser?.on('disconnected', disconnected);
    finished.finally(() => {
      page.off('close', disconnected); page.off('crash', disconnected); page.off('framenavigated', navigated);
      browser?.off('disconnected', disconnected);
    }).catch(() => {});
    return {id, capture, finish, finished, reportPath};
  } catch (error) {
    report.status = 'failed'; report.failure = String(error);
    try {await adapter?.disconnect?.('Investigation setup failed');}
    catch (cleanup) {report.cleanupFailure = String(cleanup);}
    await save();
    rejectFinished(error); throw error;
  }
}
