import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertCleanGitCheckout, createSourceByteReceipt } from '../tools/trellis-dinov3-source-attestation.mjs';

const assayRunner = readFileSync(new URL('../tools/trellis-dinov3-prefix-block-parity-assay.mjs', import.meta.url), 'utf8');
const browserRunner = readFileSync(new URL('../tools/trellis-dinov3-prefix-block-browser-parity-smoke.mjs', import.meta.url), 'utf8');
const attestationHelper = readFileSync(new URL('../tools/trellis-dinov3-source-attestation.mjs', import.meta.url), 'utf8');
const phaseProgram = readFileSync(new URL('../src/trellis-dinov3-prefix-block-phase-program.js', import.meta.url), 'utf8');
const browserSmoke = readFileSync(new URL('../smokes/trellis-dinov3-prefix-block-browser.html', import.meta.url), 'utf8');
const mlxReference = readFileSync(new URL('../tools/trellis-dinov3-mlx-reference.py', import.meta.url), 'utf8');

assert.ok(assayRunner.includes('assertCleanGitCheckout'), 'the composite assay must refuse same-HEAD dirty source before running');
assert.ok(attestationHelper.includes("'--untracked-files=all'"), 'the clean check must include untracked files');
assert.ok(browserRunner.includes('servedSourceReceipts'), 'the browser receipt must report source bytes actually served');
assert.ok(browserRunner.includes('createSourceByteReceipt'), 'each served module must be tied to its committed Git blob');
assert.ok(browserRunner.includes('trellis-dinov3-prefix-block-phase-program.js'), 'the live route program must be explicitly among the attested modules');
assert.ok(browserRunner.includes('trellis-dinov3-prefix-block-browser.html'), 'the actual browser smoke document must be explicitly attested');
assert.match(phaseProgram, /export async function runTrellisDinoV3Block1AttentionResident\(/,
  'the next resident consumer must execute block-1 attention on the already-resident LayerNorm tensor');
assert.match(phaseProgram, /inputTensor:norm1Output\.tensor[\s\S]*residualTensor:tensors\.block0HiddenStates/,
  'block-1 attention must consume block-1 LayerNorm output and preserve block-0 as its residual on-device');
assert.match(browserSmoke, /block1Attention/,
  'the browser witness must compare the block-1 attention-residual output');
assert.match(mlxReference, /block1_after_attention_hidden_states\s*=\s*block0_hidden_states\s*\+\s*block1_attention_output\s*\*\s*block1\.layer_scale1/,
  'the MLX comparator must use the native block-1 attention and LayerScale/residual boundary');

const repo = mkdtempSync(join(tmpdir(), 'trellis-dinov3-source-attestation-'));
try {
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Source Attestation Test']);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'source-attestation@example.invalid']);
  mkdirSync(join(repo, 'src'));
  const committedBytes = Buffer.from('export const stage = "committed";\n');
  writeFileSync(join(repo, 'src', 'stage.js'), committedBytes);
  execFileSync('git', ['-C', repo, 'add', 'src/stage.js']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'fixture source']);
  const revision = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

  assert.deepEqual(assertCleanGitCheckout(repo, revision), { head: revision, clean: true, porcelain: '' });
  const receipt = createSourceByteReceipt({ root: repo, sourceRevision: revision, repoPath: 'src/stage.js', servedBytes: committedBytes });
  assert.equal(receipt.sourceRevision, revision);
  assert.equal(receipt.sha256, createHash('sha256').update(committedBytes).digest('hex'));
  assert.equal(receipt.byteLength, committedBytes.byteLength);
  assert.equal(receipt.matchesCommittedBytes, true);
  assert.ok(receipt.gitBlob.length >= 40, 'receipt must name the committed Git blob');
  assert.throws(() => createSourceByteReceipt({ root: repo, sourceRevision: revision, repoPath: 'src/stage.js', servedBytes: Buffer.from('different served bytes') }), /differ from/);
  assert.throws(() => createSourceByteReceipt({ root: repo, sourceRevision: revision, repoPath: '../outside.js', servedBytes: committedBytes }), /repository-relative/);

  writeFileSync(join(repo, 'untracked.js'), 'untracked');
  assert.throws(() => assertCleanGitCheckout(repo, revision), /source checkout is dirty/);
  assert.throws(() => assertCleanGitCheckout(repo, '0'.repeat(revision.length)), /source revision mismatch/);
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log('TRELLIS DINOv3 source-attestation contracts passed');
