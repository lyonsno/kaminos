import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { decodeScreenshotPngRgb } from './screenshot-png-rgb.mjs';
import { assertCapturePixels } from './visual-work.mjs';

// The caller owns its browser, runtime and source verification. Retention is
// shared even when that runtime has no authored-scene save operation.
export async function observationSession({ out, source, capture, exercise }) {
  await fs.mkdir(out, { recursive: true });
  const reportPath = path.join(out, 'report.json');
  const handle = await fs.open(reportPath, 'wx'); await handle.close();
  const report = { status: 'running', phase: 'setup', source, startedAt: new Date().toISOString(), observations: [] };
  const write = () => fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  const names = new Set();
  let retentionFailure;
  await write();
  try {
    assert.ok(source && typeof source === 'object' && Object.keys(source).length, 'Caller source identity required');
    assert.equal(typeof capture, 'function', 'PNG capture function required');
    const captureOne = async ({ name, observe, verify }) => {
      report.phase = `observe:${name}`; await write();
      assert.ok(/^[a-z0-9][a-z0-9_-]*$/i.test(name), 'Observation name must be a path-safe filename');
      assert.ok(!names.has(name), `Duplicate observation: ${name}`); names.add(name);
      assert.equal(typeof verify, 'function', 'Post-capture verification required');
      const observation = { name, status: 'reading' }; report.observations.push(observation);
      observation.effective = await observe(); observation.status = 'capturing'; await write();
      const bytes = Buffer.from(await capture());
      observation.image = path.join(out, `${name}.png`);
      await fs.writeFile(observation.image, bytes, { flag: 'wx' });
      observation.sha256 = createHash('sha256').update(bytes).digest('hex');
      observation.status = 'unverified'; await write();
      const decoded = decodeScreenshotPngRgb(bytes);
      const dimensions = { width: decoded.width, height: decoded.height };
      assertCapturePixels(decoded, dimensions);
      await verify();
      Object.assign(observation, dimensions, { status: 'verified', savedAt: new Date().toISOString() });
      report.lastTrustworthyObservation = name; await write();
      return observation;
    };
    const retain = async options => {
      if (retentionFailure) throw retentionFailure;
      try { return await captureOne(options); }
      catch (error) { retentionFailure = error; throw error; }
    };
    report.phase = 'exercise'; await write();
    report.result = await exercise({ retain });
    if (retentionFailure) throw retentionFailure;
    report.status = 'passed'; report.phase = 'complete';
    return report;
  } catch (error) {
    report.status = 'failed'; report.failure = error.stack || String(error); throw error;
  } finally {
    report.finishedAt = new Date().toISOString(); await write();
  }
}
