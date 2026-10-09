import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { serialize, deserialize } from 'node:v8';
import { decodeScreenshotPngRgb } from './screenshot-png-rgb.mjs';
import { assertCapturePixels } from './visual-work.mjs';

const storageFormat = 'observation-session-v2';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// These callers already use structured-clone state. V8 keeps its types and
// graph intact without materializing one JSON string for a dense observation.
async function writePayload(out, file, value) {
  const bytes = serialize(value);
  await fs.writeFile(path.join(out, file), bytes, { flag: 'wx' });
  return { file, encoding: 'node-v8', bytes: bytes.length, sha256: digest(bytes) };
}

async function readPayload(out, ref) {
  assert.ok(ref?.encoding === 'node-v8' && typeof ref.file === 'string'
    && /^[a-z0-9][a-z0-9_.-]*$/i.test(ref.file), 'Invalid observation payload reference');
  const bytes = await fs.readFile(path.join(out, ref.file));
  assert.equal(bytes.length, ref.bytes, 'Observation payload size differs');
  assert.equal(digest(bytes), ref.sha256, 'Observation payload checksum differs');
  return deserialize(bytes);
}

// Disk consumers migrate to this reader; old inline reports remain readable.
// Missing/corrupt sidecars fail rather than masquerading as complete evidence.
export async function readObservationSession(reportPath) {
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  if (report.storageFormat === undefined) return report;
  assert.equal(report.storageFormat, storageFormat, 'Unsupported observation storage format');
  const out = path.dirname(reportPath);
  for (const observation of report.observations) {
    if (observation.state) observation.effective = await readPayload(out, observation.state);
    else assert.equal(observation.status, 'reading', 'Observation state reference missing');
  }
  if (report.resultRef) report.result = await readPayload(out, report.resultRef);
  else assert.notEqual(report.status, 'passed', 'Passed observation result reference missing');
  return report;
}

// The caller owns its browser, runtime and source verification. Retention is
// shared even when that runtime has no authored-scene save operation.
export async function observationSession({ out, source, capture, exercise }) {
  await fs.mkdir(out, { recursive: true });
  const reportPath = path.join(out, 'report.json');
  const handle = await fs.open(reportPath, 'wx'); await handle.close();
  const report = { storageFormat, storageRuntime: { node: process.version, v8: process.versions.v8 },
    status: 'running', phase: 'setup', source,
    startedAt: new Date().toISOString(), observations: [] };
  const write = async () => {
    const { result, observations, ...metadata } = report;
    const index = { ...metadata, observations: observations.map(({ effective, ...entry }) => entry) };
    await fs.writeFile(`${reportPath}.next`, JSON.stringify(index, null, 2));
    await fs.rename(`${reportPath}.next`, reportPath);
  };
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
      observation.effective = await observe();
      report.phase = `observe:${name}:state`;
      observation.state = await writePayload(out, `${name}.state.v8`, observation.effective);
      observation.status = 'capturing'; report.phase = `observe:${name}:capture`; await write();
      const bytes = Buffer.from(await capture());
      observation.image = path.join(out, `${name}.png`);
      await fs.writeFile(observation.image, bytes, { flag: 'wx' });
      observation.sha256 = digest(bytes);
      observation.status = 'unverified'; await write();
      report.phase = `observe:${name}:pixels`; await write();
      const decoded = decodeScreenshotPngRgb(bytes);
      const dimensions = { width: decoded.width, height: decoded.height };
      assertCapturePixels(decoded, dimensions);
      report.phase = `observe:${name}:verify`; await write(); await verify();
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
    if (!retentionFailure) report.phase = 'retain-result';
    await write();
    try { report.resultRef = await writePayload(out, 'result.v8', report.result); }
    catch (error) {
      if (!retentionFailure) throw error;
      report.resultRetentionFailure = error.stack || String(error);
    }
    if (retentionFailure) throw retentionFailure;
    report.status = 'passed'; report.phase = 'complete';
    return report;
  } catch (error) {
    report.status = 'failed'; report.failure = error.stack || String(error); throw error;
  } finally {
    report.finishedAt = new Date().toISOString(); await write();
  }
}
