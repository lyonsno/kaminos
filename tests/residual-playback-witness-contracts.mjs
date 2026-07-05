import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const script = `${root}/volume-residual-playback-witness.mjs`;
const tempRoot = join(tmpdir(), `kaminos-residual-playback-contract-${process.pid}`);
rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(tempRoot, { recursive: true });

function writeImage(path) {
  writeFileSync(path, 'not-a-real-png-but-path-authority-is-tested');
}

function writeReport(name, overrides = {}) {
  const reportDir = join(tempRoot, name);
  mkdirSync(reportDir, { recursive: true });
  const previewA = join(reportDir, 'preview-a.png');
  const previewB = join(reportDir, 'preview-b.png');
  const temporal = join(reportDir, 'temporal.png');
  const diagnostic = join(reportDir, 'diagnostic.png');
  for (const image of [previewA, previewB, temporal, diagnostic]) writeImage(image);
  const report = {
    schema: 'kaminos.volume.residual-upscale-mlx.v0',
    corpusManifest: join(tempRoot, 'corpus-manifest.json'),
    pairAuthority: 'frame-locked-render-scale-set-v0',
    imageAuthority: 'cdp-canvas-clip-capture-after-render-only-frozen-sim-state',
    modelArtifactAuthority: 'offline-mlx-residual-upscaler-weights-v0',
    lowRenderScale: name.includes('018') ? 0.18 : 0.15,
    modelArch: 'hybrid-residual',
    selectedPairCount: 2,
    trainPairCount: 1,
    evalPairCount: 1,
    baselinePsnr: 31.2,
    modelPsnr: 32.7,
    deltaPsnr: 1.5,
    edgeBandDeltaPsnr: 2.5,
    targetEdgeBandDeltaPsnr: 1.6,
    temporalDeltaPsnr: 0.2,
    temporalFlickerAmplification: 1.01,
    previewMode: 'full-frame',
    previewFrameCount: 2,
    preview: previewA,
    diagnosticPreview: diagnostic,
    temporalSequencePreview: temporal,
    temporalSequenceFrames: [
      {
        item: `${name}::frame-001`,
        temporalSequenceId: `${name}-sequence`,
        temporalFrameIndex: 0,
        lowRenderScale: name.includes('018') ? 0.18 : 0.15,
      },
      {
        item: `${name}::frame-002`,
        temporalSequenceId: `${name}-sequence`,
        temporalFrameIndex: 1,
        lowRenderScale: name.includes('018') ? 0.18 : 0.15,
      },
    ],
    previewFrames: [
      {
        item: `${name}::frame-001`,
        preview: previewA,
        diagnosticPreview: diagnostic,
        previewFocus: { mode: 'full-frame', width: 1800, height: 1746 },
      },
      {
        item: `${name}::frame-002`,
        preview: previewB,
        diagnosticPreview: diagnostic,
        previewFocus: { mode: 'full-frame', width: 1800, height: 1746 },
      },
    ],
    ...overrides,
  };
  const reportPath = join(reportDir, 'residual-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return reportPath;
}

writeFileSync(join(tempRoot, 'corpus-manifest.json'), JSON.stringify({
  schema: 'kaminos.volume.frame-locked-pair-corpus.v0',
  status: 'captured',
  pairCount: 2,
  sourceManifests: [],
}, null, 2));

const report015 = writeReport('rs015');
const report018 = writeReport('rs018');
const outDir = join(tempRoot, 'witness');
const result = spawnSync(process.execPath, [
  script,
  '--report',
  report015,
  '--report',
  report018,
  '--out-dir',
  outDir,
  '--title',
  'Contract Playback',
], { encoding: 'utf8' });

assert.equal(result.status, 0, result.stderr || result.stdout);

const html = readFileSync(join(outDir, 'index.html'), 'utf8');
assert.match(html, /Contract Playback/);
assert.match(html, /offline-mlx-residual-upscaler-weights-v0/);
assert.match(html, /frame-locked-render-scale-set-v0/);
assert.match(html, /data-frame-index="1"/);
assert.match(html, /Low \/ Model \/ Target \/ Diff/);
assert.match(html, /playback-manifest.json/);

const manifest = JSON.parse(readFileSync(join(outDir, 'playback-manifest.json'), 'utf8'));
assert.equal(manifest.schema, 'kaminos.volume.residual-playback-witness.v0');
assert.equal(manifest.reportCount, 2);
assert.deepEqual(manifest.renderScales, [0.15, 0.18]);
assert.equal(manifest.reports[0].frameCount, 2);
assert.equal(manifest.reports[0].temporalSequencePreview.endsWith('temporal-sequence.png'), true);
assert.equal(manifest.reports[0].sourceTemporalSequencePreview.endsWith('temporal.png'), true);
assert.equal(manifest.reports[0].frames[0].preview.endsWith('001-preview.png'), true);
assert.equal(manifest.reports[0].frames[0].sourcePreview.endsWith('preview-a.png'), true);

const missingReport = writeReport('missing-path', {
  previewFrames: [
    {
      item: 'missing::frame-001',
      preview: join(tempRoot, 'does-not-exist.png'),
      diagnosticPreview: join(tempRoot, 'diagnostic-missing.png'),
    },
  ],
});
const missing = spawnSync(process.execPath, [
  script,
  '--report',
  missingReport,
  '--out-dir',
  join(tempRoot, 'missing-witness'),
], { encoding: 'utf8' });
assert.notEqual(missing.status, 0, 'witness must fail loud when preview images are missing');
assert.match(missing.stderr, /missing preview image/i);
