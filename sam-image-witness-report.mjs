import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, renameSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';

export function persistSamCaptureObservation({ report, name, path, pixels, saveReport }) {
  assert.ok(Array.isArray(report?.captures), 'capture report is required');
  assert.ok(typeof name === 'string' && name.length, 'capture name is required');
  assert.ok(typeof path === 'string' && path.length, 'capture path is required');
  assert.ok(pixels && typeof pixels === 'object', 'capture diagnostics are required');
  assert.equal(typeof saveReport, 'function', 'capture report writer is required');
  const capture = { name, path, pixels, validation: 'pending', screenshotCaptured: false };
  report.captures.push(capture);
  saveReport();
  return capture;
}

export function persistSamFlameCanvasDiagnostic({ outDir, dataUrl, width, height, diagnostics }) {
  assert.ok(typeof outDir === 'string' && outDir.length, 'flame diagnostic output directory is required');
  assert.ok(Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0,
    'flame diagnostic dimensions must be positive integers');
  assert.ok(diagnostics && typeof diagnostics === 'object', 'flame diagnostic metrics are required');
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl || '');
  assert.ok(match, 'flame diagnostic must be a PNG data URL');
  const bytes = Buffer.from(match[1], 'base64');
  assert.ok(bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'flame diagnostic PNG signature is invalid');
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, 'native-flame-canvas.png');
  writeFileSync(path, bytes, { flag: 'wx' });
  return { path, width, height, bytes: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, diagnostics };
}

export async function persistSamEvidenceArtifact({ outDir, label, transferId, totalLength, readChunk, chunkSize = 262144 }) {
  assert.ok(typeof outDir === 'string' && outDir.length, 'evidence output directory is required');
  assert.match(label, /^[a-z0-9-]+$/, 'evidence label must be filesystem-safe');
  assert.ok(typeof transferId === 'string' && transferId.length, 'evidence transfer identity is required');
  assert.ok(Number.isSafeInteger(totalLength) && totalLength >= 0, 'invalid evidence character count');
  assert.ok(Number.isSafeInteger(chunkSize) && chunkSize > 0, 'invalid evidence chunk size');
  assert.equal(typeof readChunk, 'function', 'evidence chunk reader is required');

  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `${label}-evidence.json`);
  const fd = openSync(path, 'wx');
  const hash = createHash('sha256');
  let offset = 0;
  let byteLength = 0;
  try {
    while (offset < totalLength) {
      const chunk = await readChunk({ transferId, offset, totalLength, length: chunkSize });
      assert.equal(chunk?.transferId, transferId, 'evidence chunk belongs to another transfer');
      assert.equal(chunk?.offset, offset, 'evidence chunk offset mismatch');
      assert.equal(chunk?.totalLength, totalLength, 'evidence chunk total changed');
      assert.equal(typeof chunk?.text, 'string', 'evidence chunk text missing');
      assert.ok(chunk.text.length > 0 && chunk.text.length <= chunkSize, 'evidence chunk has invalid length');
      assert.ok(offset + chunk.text.length <= totalLength, 'evidence chunk exceeds declared total');
      const first = chunk.text.charCodeAt(0);
      const last = chunk.text.charCodeAt(chunk.text.length - 1);
      assert.ok(!(offset > 0 && first >= 0xdc00 && first <= 0xdfff), 'evidence chunk starts inside a surrogate pair');
      assert.ok(!(offset + chunk.text.length < totalLength && last >= 0xd800 && last <= 0xdbff), 'evidence chunk ends inside a surrogate pair');

      const bytes = Buffer.from(chunk.text, 'utf8');
      let written = 0;
      while (written < bytes.length) {
        const count = writeSync(fd, bytes, written, bytes.length - written);
        assert.ok(count > 0, 'evidence artifact write made no progress');
        written += count;
      }
      hash.update(bytes);
      byteLength += bytes.length;
      offset += chunk.text.length;
    }
    return {
      schema: 'kaminos.sam-image-evidence-artifact.v0',
      path,
      characters: totalLength,
      bytes: byteLength,
      sha256: `sha256:${hash.digest('hex')}`,
      complete: true,
    };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    failure.evidenceTransport = { path, transferId, completedCharacters: offset, totalCharacters: totalLength, complete: false };
    throw failure;
  } finally {
    closeSync(fd);
  }
}

export function writeSamTerminalFailure({ outDir, phase, error, lastTrustedEvidence = null, startedAt = null }) {
  const path = join(outDir, 'failure.json');
  const temporary = `${path}.tmp`;
  const receipt = {
    schema: 'kaminos.sam-image-consumer-failure.v0',
    status: 'failed',
    failurePhase: phase || 'unknown',
    error: String(error?.stack || error || 'unknown failure'),
    lastTrustedEvidence,
    startedAt,
    completedAt: new Date().toISOString(),
  };
  writeFileSync(temporary, JSON.stringify(receipt, null, 2));
  renameSync(temporary, path);
  return path;
}
