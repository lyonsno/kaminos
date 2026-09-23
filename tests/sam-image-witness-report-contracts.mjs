import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { persistSamEvidenceArtifact, persistSamFlameCanvasDiagnostic, writeSamTerminalFailure } = await import('../sam-image-witness-report.mjs');
const { createSamImageTools } = await import('../sam-image-tools.js');
const elements = new Map();
globalThis.document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, { dataset: {}, addEventListener() {}, replaceChildren() {}, append() {}, setAttribute() {} });
    return elements.get(id);
  },
  createElement() { return {}; },
  querySelectorAll() { return []; },
};
globalThis.window = { addEventListener() {} };
const tools = createSamImageTools({ inferenceSession: { device: {} }, rendererDevice: {}, config: { mounted: true } });
assert.equal(typeof tools.progress, 'function', 'busy polling needs a progress accessor that does not clone runtime evidence');
assert.deepEqual(tools.progress(), { busy: false, source: null });
assert.equal(typeof tools.interactionEvidence, 'function', 'interaction witness needs evidence without the runtime history clone');
assert.equal(Object.hasOwn(tools.interactionEvidence(), 'runtime'), false);

const directory = mkdtempSync(join(tmpdir(), 'sam-image-witness-report-'));
try {
  const source = JSON.stringify({ rows: Array.from({ length: 3000 }, (_, index) => ({ index, label: '窗🔥'.repeat(3) })) });
  const transferId = 'transfer-1';
  const reference = await persistSamEvidenceArtifact({ outDir: directory, label: 'cold-wheel', transferId,
    totalLength: source.length, chunkSize: 127, readChunk({ offset, totalLength, length }) {
      let end = Math.min(offset + length, totalLength);
      if (end < totalLength && source.charCodeAt(end - 1) >= 0xd800 && source.charCodeAt(end - 1) <= 0xdbff) end -= 1;
      return { transferId, offset, totalLength, text: source.slice(offset, end) };
    },
  });
  assert.equal(reference.complete, true);
  assert.equal(reference.characters, source.length);
  assert.equal(reference.bytes, Buffer.byteLength(source));
  assert.equal(reference.sha256, `sha256:${createHash('sha256').update(source).digest('hex')}`);
  assert.equal(readFileSync(reference.path, 'utf8'), source, 'persisted evidence changed during chunk transfer');
  assert.equal(Object.hasOwn(reference, 'evidence'), false, 'aggregate report should carry a reference, not the full evidence object');

  const flamePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64');
  const flameReference = persistSamFlameCanvasDiagnostic({ outDir: directory,
    dataUrl: `data:image/png;base64,${flamePng.toString('base64')}`, width: 1, height: 1,
    diagnostics: { brightSamplesInMaskForeground: 0, brightSamplesInMaskBackground: 0 } });
  assert.equal(flameReference.width, 1);
  assert.equal(flameReference.height, 1);
  assert.equal(flameReference.bytes, flamePng.length);
  assert.equal(flameReference.sha256, `sha256:${createHash('sha256').update(flamePng).digest('hex')}`);
  assert.deepEqual(readFileSync(flameReference.path), flamePng, 'native flame pixels were not preserved exactly');
  assert.deepEqual(flameReference.diagnostics, { brightSamplesInMaskForeground: 0, brightSamplesInMaskBackground: 0 });
  assert.throws(() => persistSamFlameCanvasDiagnostic({ outDir: directory,
    dataUrl: 'data:image/jpeg;base64,AA==', width: 1, height: 1, diagnostics: {} }), /PNG data URL/);

  await assert.rejects(persistSamEvidenceArtifact({ outDir: directory, label: 'misrouted', transferId: 'expected',
    totalLength: source.length, readChunk({ offset, totalLength }) {
      return { transferId: 'stale-transfer', offset, totalLength, text: source.slice(offset, offset + 8) };
    },
  }), error => {
    assert.match(error.message, /another transfer/);
    assert.equal(error.evidenceTransport.completedCharacters, 0);
    assert.equal(error.evidenceTransport.complete, false);
    assert.equal(readFileSync(error.evidenceTransport.path, 'utf8'), '');
    return true;
  });

  const interruptedId = 'transfer-2';
  await assert.rejects(persistSamEvidenceArtifact({ outDir: directory, label: 'interrupted', transferId: interruptedId,
    totalLength: source.length, chunkSize: 64, async readChunk({ offset, totalLength, length }) {
      if (offset >= 64) throw new Error('CDP disconnected');
      return { transferId: interruptedId, offset, totalLength, text: source.slice(offset, offset + Math.min(length, totalLength - offset)) };
    },
  }), error => {
    assert.equal(error.message, 'CDP disconnected');
    assert.equal(error.evidenceTransport.completedCharacters, 64);
    assert.equal(error.evidenceTransport.complete, false);
    assert.equal(readFileSync(error.evidenceTransport.path, 'utf8'), source.slice(0, 64));
    return true;
  });

  const failurePath = writeSamTerminalFailure({ outDir: directory, phase: 'read_browser_evidence',
    error: new Error('CDP disconnected'), lastTrustedEvidence: reference, startedAt: '2026-09-22T00:00:00.000Z' });
  const failure = JSON.parse(readFileSync(failurePath, 'utf8'));
  assert.equal(failure.schema, 'kaminos.sam-image-consumer-failure.v0');
  assert.equal(failure.failurePhase, 'read_browser_evidence');
  assert.equal(failure.lastTrustedEvidence.sha256, reference.sha256);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
