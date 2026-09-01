import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

const raymarch = sourceBetween(
  core,
  'fn raymarchVolume(in: VSOut, sceneDepthEndT: f32) -> RaymarchResult {',
  'fn fs(in: VSOut) -> @location(0) vec4<f32> {',
);

assert.doesNotMatch(
  raymarch,
  /\b(?:sin|cos)\s*\(/,
  'production raymarch appearance must not contain direct explicit periodic modulation',
);
assert.doesNotMatch(
  raymarch,
  /verticalPhaseBreak|verticalPuffBreak/,
  'vertical phase/puff waves must not directly regularize smoke, fire, or vapor appearance',
);
assert.match(
  raymarch,
  /let\s+transportedPyroStructure\s*=\s*clamp\(/,
  'pyro appearance must derive structure from transported fields rather than a synthetic CPU atlas',
);
assert.doesNotMatch(
  raymarch,
  /pyroMemoryPattern|pyroMemoryCell|pyroSpatialEnergy|pyroMemoryStructure|samplePyroMaterialMemoryCell/,
  'the retired periodic pyro-memory atlas must not remain in production raymarch through an alias or sampler',
);
assert.doesNotMatch(
  raymarch,
  /microDetailDomainWarp|microFilamentNoise|filamentNoise|shredNoise|fireNoise|curtainNoise/,
  'production raymarch appearance must not call indirect periodic filament or domain-warp painters',
);
assert.doesNotMatch(
  core,
  /fn\s+microDetailDomainWarp\b|fn\s+microFilamentNoise\b/,
  'presentation-only periodic helper functions must be removed rather than left as dormant authority',
);
assert.match(
  raymarch,
  /let\s+transportedCurtainStructure\s*=\s*clamp\(/,
  'smoke curtain variation must derive from transported microdetail and material structure',
);
assert.match(
  raymarch,
  /let\s+transportedFireStructure\s*=\s*clamp\(/,
  'fire variation must derive from transported reaction and interface structure',
);
assert.match(
  raymarch,
  /let\s+visibleDetailOverlayGain\s*=\s*mix\(1\.0, 0\.35, detailScaleArtifactQuarantine\);/,
  'transported detail must preserve the inherited tall-plume amplitude quarantine',
);
assert.match(
  raymarch,
  /let\s+materialStructure\s*=\s*smoothstep\([^;]+\)\s*\*\s*visibleDetailOverlayGain;/,
  'transported material structure must respect the visible-detail amplitude quarantine',
);
assert.match(
  raymarch,
  /let\s+shredStructure\s*=\s*smoothstep\([^;]+\)\s*\*\s*visibleDetailOverlayGain;/,
  'transported shred structure must respect the visible-detail amplitude quarantine',
);
assert.match(
  raymarch,
  /let\s+fireStructure\s*=\s*smoothstep\([^;]+\)\s*\*\s*visibleDetailOverlayGain;/,
  'transported fire structure must respect the visible-detail amplitude quarantine',
);

const pyroStateUpdate = sourceBetween(
  core,
  'function updatePyroDynamicDetailState({ simReadback = null, inputKind = \'control-proxy\' } = {}) {',
  '\n  let adapter = null;',
);

assert.doesNotMatch(
  pyroStateUpdate,
  /Math\.(?:sin|cos)\s*\(/,
  'renderer-adjacent Pyro state must not synthesize a self-advancing periodic atlas',
);
assert.doesNotMatch(
  core,
  /fn\s+samplePyroMaterialMemoryCell\b/,
  'the synthetic Pyro atlas sampler must be removed from shader authority',
);
assert.match(
  core,
  /materialShaderReadiness:\s*'retired-synthetic-atlas'/,
  'runtime receipts must state that synthetic atlas sampling is retired',
);
assert.match(
  core,
  /uploadedCells:\s*0/,
  'runtime receipts must fail closed on synthetic atlas uploads',
);

console.log('volume raymarch periodicity contracts passed');
