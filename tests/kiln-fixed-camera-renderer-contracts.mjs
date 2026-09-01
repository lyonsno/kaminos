import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const core = readFileSync(new URL('volume-core.js', root), 'utf8');
const index = readFileSync(new URL('index.html', root), 'utf8');
const browserWitness = readFileSync(new URL('tests/kiln-fixed-camera-browser-alias-witness.mjs', root), 'utf8');

assert.match(
  core,
  /override KILN_SOURCE_OVERSCAN: f32 = 1\.0;/,
  'kiln source framing is an explicit pipeline override',
);

function assertKilnVisibleSourceCoverageContract(source) {
  const coverageBody = source.match(
    /fn kilnVisibleSourceCoverage\(displayRadiance: vec3<f32>\) -> f32 \{([\s\S]*?)\n\}/,
  )?.[1];
  assert.ok(coverageBody, 'kiln visible-source coverage helper is missing');
  assert.match(
    coverageBody,
    /let radiancePeak = max\(displayRadiance\.r, max\(displayRadiance\.g, displayRadiance\.b\)\);/,
    'coverage derives peak support from displayed radiance',
  );
  assert.match(
    coverageBody,
    /let radianceLuma = dot\(displayRadiance, vec3<f32>\(0\.2126, 0\.7152, 0\.0722\)\);/,
    'coverage derives perceptual support from displayed radiance',
  );
  assert.match(
    coverageBody,
    /let visibleRadiance = max\(radianceLuma, radiancePeak \* 0\.55\);/,
    'coverage preserves narrow hot color even when luminance is lower',
  );
  assert.match(
    coverageBody,
    /return smoothstep\(0\.035, 0\.18, visibleRadiance\);/,
    'coverage rejects the dim evolved carrier and admits displayed flame radiance',
  );
  assert.doesNotMatch(
    coverageBody,
    /result\.|residualFeature|transmittance|boundary_fire_display/,
    'smoke-off kiln opacity cannot be reopened by broad simulation support or extinction',
  );

  const sourceBody = source.match(
    /fn fsKilnCompositeSource\(in: VSOut\) -> @location\(0\) vec4<f32> \{([\s\S]*?)\n\}/,
  )?.[1];
  assert.ok(sourceBody, 'kiln composite source entry point is missing');
  assert.match(
    sourceBody,
    /var framedIn = in;\s+framedIn\.uv = \(in\.uv - vec2<f32>\(0\.5\)\) \* KILN_SOURCE_OVERSCAN \+ vec2<f32>\(0\.5\);\s+let result = raymarchVolume\(framedIn, 1\.0e6\);/,
    'kiln source widens its NDC before raymarching to create optical margin',
  );
  assert.match(
    sourceBody,
    /let coverage = kilnVisibleSourceCoverage\(displayRadiance\);/,
    'kiln source obtains coverage from the admitted helper',
  );
  assert.match(
    sourceBody,
    /return vec4<f32>\(displayRadiance \* coverage, coverage\);/,
    'one radiance-derived coverage owns both premultiplication and source opacity',
  );
  assert.doesNotMatch(
    sourceBody,
    /rawAlpha|result\.transmittance|residualFeature/,
    'smoke-off kiln source cannot derive opacity from broad extinction or simulation support',
  );
}

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function kilnCoverage(displayRadiance = [0, 0, 0]) {
  const radiancePeak = Math.max(...displayRadiance);
  const radianceLuma = displayRadiance[0] * 0.2126 + displayRadiance[1] * 0.7152 + displayRadiance[2] * 0.0722;
  return smoothstep(0.035, 0.18, Math.max(radianceLuma, radiancePeak * 0.55));
}

assert.match(
  core,
  /onKilnFixedCameraCompositionReceipt/,
  'renderer exposes exact kiln receipt transitions to the cockpit instead of retaining private effective state',
);
assert.match(
  index,
  /onKilnFixedCameraCompositionReceipt:\s*receipt\s*=>/,
  'cockpit consumes renderer-owned effective and failed kiln receipts',
);
assert.match(
  core,
  /kiln-composition-initialization-failed/,
  'asset or GPU initialization failure publishes a durable failed receipt phase',
);
for (const failurePhase of ['asset-fetch', 'asset-sha256', 'asset-decode', 'asset-dimensions']) {
  assert.match(
    core,
    new RegExp(`kilnFailurePhase = '${failurePhase}'`),
    `asset initialization preserves a distinct ${failurePhase} failure phase`,
  );
}
assert.match(
  core,
  /kiln-composition-activation-failed/,
  'failure after verified assets but before the first frame replaces the public effective receipt',
);
assert.match(
  core,
  /kiln-composition-render-failed/,
  'failure after asset initialization cannot leave the public receipt effective',
);
assert.doesNotMatch(
  core,
  /return vec4<f32>\(displayRadiance \* alpha, alpha\)/,
  'already accumulated front-to-back radiance is not multiplied by alpha a second time',
);
assertKilnVisibleSourceCoverageContract(core);
assert.throws(
  () => assertKilnVisibleSourceCoverageContract(core.replace(
    'let coverage = kilnVisibleSourceCoverage(displayRadiance);',
    'let coverage = 1.0;',
  )),
  /obtains coverage from the admitted helper/,
  'contract rejects a disconnected coverage helper',
);
assert.throws(
  () => assertKilnVisibleSourceCoverageContract(core.replace(
    'return smoothstep(0.035, 0.18, visibleRadiance);',
    'return smoothstep(0.0, 0.001, visibleRadiance);',
  )),
  /rejects the dim evolved carrier/,
  'contract rejects a nearly always-on radiance matte',
);
assert.throws(
  () => assertKilnVisibleSourceCoverageContract(core.replace(
    'let coverage = kilnVisibleSourceCoverage(displayRadiance);',
    'let coverage = kilnVisibleSourceCoverage(displayRadiance) + result.residualFeature.y;',
  )),
  /obtains coverage from the admitted helper/,
  'contract rejects residual simulation support reconnected at the source entry point',
);
assert.equal(kilnCoverage(), 0, 'zero displayed radiance contributes zero source coverage');
assert.equal(kilnCoverage([0.01, 0.01, 0.01]), 0, 'dim evolved carrier remains transparent');
assert.equal(kilnCoverage([1.0, 0.5, 0.1]), 1, 'bright displayed flame owns full source coverage');
const partialCoverage = kilnCoverage([0.12, 0.06, 0.02]);
assert.ok(partialCoverage > 0 && partialCoverage < 1, 'test fixture exercises partial coverage');
assert.deepEqual(
  [...[0.3, 0.2, 0.1].map(channel => channel * partialCoverage), 0.5 * partialCoverage],
  [0.3 * partialCoverage, 0.2 * partialCoverage, 0.1 * partialCoverage, 0.5 * partialCoverage],
  'the same partial coverage scales premultiplied radiance and alpha',
);
assert.doesNotMatch(
  core,
  /fn fsKilnCompositeSource[\s\S]*?return vec4<f32>\(displayRadiance, alpha\)/,
  'kiln source cannot retain invisible extinction outside its visible optical support',
);
assert.match(
  core,
  /const kilnSourcePipelineConstants = \{ \.\.\.renderPipelineConstants, KILN_SOURCE_OVERSCAN: kilnFixedCameraComposition\.fire\.sourceOverscan \};/,
  'kiln source pipeline receives exact caller-addressed overscan',
);
assert.match(
  core,
  /makeKilnFireSourcePipeline\([\s\S]*?kilnSourcePipelineConstants,[\s\S]*?makeKilnFireSourcePipeline\([\s\S]*?\{ \.\.\.leanStockRenderPipelineConstants, KILN_SOURCE_OVERSCAN: kilnFixedCameraComposition\.fire\.sourceOverscan \},/,
  'full and lean kiln source pipelines share the exact framing authority',
);
assert.match(
  core,
  /const captureSurface = \['kiln-source', 'kiln-source-baseline'\]\.includes\(requestedCaptureSurface\)[\s\S]*?kilnSourceCaptureRequested/,
  'frame sampling admits explicit effective and pre-overscan kiln source evidence surfaces',
);
assert.match(
  core,
  /kilnSourceCaptureRequested && \([\s\S]*?!kilnFixedCameraComposition[\s\S]*?!kilnFireSourcePipeline[\s\S]*?!kilnFireSourceBaselinePipeline[\s\S]*?reason: 'kiln-composition-source-capture-unavailable'/,
  'kiln source evidence fails loud when the exact composition pipeline is unavailable',
);
assert.match(
  core,
  /else if \(kilnSourceCaptureRequested\) \{[\s\S]*?const sourcePipeline = baseline \? kilnFireSourceBaselinePipeline : kilnFireSourcePipeline;[\s\S]*?encodeDraw\([\s\S]*?sourcePipeline,[\s\S]*?\);/,
  'kiln source evidence renders through the selected source pipeline rather than ordinary readback',
);
assert.match(
  core,
  /const terminalComposition = detachedKilnFixedCameraCompositionReceipt\(state\.kilnFixedCameraComposition\);[\s\S]*?captureSurfaceReceipt = \{[\s\S]*?identity: 'kiln-transparent-premultiplied-source-pass-v1'[\s\S]*?entryPoint: 'fsKilnCompositeSource'[\s\S]*?pipeline: state\.raymarchShaderSpecialization\.effective[\s\S]*?sourceOverscan,[\s\S]*?sourceFraming: baseline \?/,
  'source readback binds the exact entry point, effective specialization, overscan, and terminal framing receipt',
);
assert.match(
  core,
  /captureSurface,\s+captureSurfaceReceipt: captureSurfaceReceipt \? \{ \.\.\.captureSurfaceReceipt \} : null,/,
  'sample result publishes the requested surface and effective source-pass receipt',
);
assert.match(
  core,
  /kilnFireSourceBaselinePipeline = makeKilnFireSourcePipeline\([\s\S]*?KILN_SOURCE_OVERSCAN: 1\.0[\s\S]*?leanStockKilnFireSourceBaselinePipeline = makeKilnFireSourcePipeline\([\s\S]*?KILN_SOURCE_OVERSCAN: 1\.0/,
  'the pre-overscan comparator uses dedicated full and lean source pipelines',
);
assert.match(
  core,
  /async function sampleKilnSourceFramingPair\([\s\S]*?cancelAnimationFrame\(raf\)[\s\S]*?await device\.queue\.onSubmittedWorkDone\(\)[\s\S]*?captureSurface: 'kiln-source-baseline'[\s\S]*?captureSurface: 'kiln-source'[\s\S]*?baseline\.frameCount !== effective\.frameCount[\s\S]*?baseline\.simStepCount !== effective\.simStepCount/,
  'paired source capture drains prior work and proves baseline/effective frame-state equality',
);
assert.match(
  core,
  /usage: GPUTextureUsage\.TEXTURE_BINDING \| GPUTextureUsage\.COPY_DST \| GPUTextureUsage\.RENDER_ATTACHMENT/,
  'external-image upload textures include Dawn-required render-attachment usage',
);
assert.match(
  core,
  /createImmutableKilnFixedCameraComposition\(kilnFixedCameraComposition\)/,
  'prototype construction takes private immutable composition custody before asynchronous GPU work',
);
assert.match(
  core,
  /detachedKilnFixedCameraCompositionReceipt\(state\.kilnFixedCameraComposition\)/,
  'renderer callbacks detach nested receipt state from private composition custody',
);
assert.match(
  core,
  /validateKilnFixedCameraCanonicalAssets\(kilnFixedCameraComposition\)/,
  'the asynchronous fetch boundary reasserts exact canonical asset tuples',
);
assert.match(
  core,
  /uniformUpload:\s*\{[\s\S]*identity:\s*'kiln-fixed-camera-uniform-upload-v0'[\s\S]*values:\s*Array\.from\(uniformData\)[\s\S]*byteLength:\s*uniformData\.byteLength/,
  'effective receipt records the exact uploaded kiln uniform array',
);
assert.match(
  index,
  /window\.__kaminosVolumeStatusReceipt\s*=\s*\{[\s\S]*kilnFixedCameraComposition:\s*detachedKilnFixedCameraCompositionReceipt/,
  'status callback publishes a detached kiln projection for behavioral alias probing',
);
assert.match(
  browserWitness,
  /sampleKilnSourceFramingPair\(\{ includeRgba: true \}\)/,
  'browser witness captures both actual kiln source passes rather than generic readback',
);
assert.match(
  browserWitness,
  /sampleKilnSourceFramingPair\(\{ includeRgba: true \}\)[\s\S]*?sourceBaselineCapture[\s\S]*?sourceEffectiveCapture/,
  'browser witness publishes the frame-locked baseline and effective source pair',
);
assert.match(
  browserWitness,
  /assert\.equal\(sourceBaselineCapture\.captureSurface, 'kiln-source-baseline'[\s\S]*?assert\.equal\(sourceEffectiveCapture\.captureSurface, 'kiln-source'[\s\S]*?sourceBaselineCapture\.captureSurfaceReceipt\?\.entryPoint[\s\S]*?sourceEffectiveCapture\.captureSurfaceReceipt\?\.entryPoint[\s\S]*?sourceEffectiveCapture\.captureSurfaceReceipt\?\.sourceOverscan, expectedSourceOverscan/,
  'browser witness fails if the captured surface, source entry point, or overscan drifts',
);
assert.match(
  browserWitness,
  /report\.runtime\.source\?\.commit[\s\S]*?report\.terminal = terminal[\s\S]*?const effective = terminal\.freshDebugProjection[\s\S]*?report\.sourceBaselineCapture[\s\S]*?report\.sourceEffectiveCapture[\s\S]*?report\.fullCompositionCapture/,
  'one report binds runtime source, terminal receipt, both source-pass images, and full composition pixels',
);
assert.match(
  browserWitness,
  /sourceBaselineImageSha256[\s\S]*?sourceImageSha256[\s\S]*?fullImageSha256[\s\S]*?assert\.equal\(report\.browserErrors\.length, 0/,
  'published image hashes and browser errors participate in the pass predicate',
);
assert.match(
  browserWitness,
  /function setPhase\(phase\) \{[\s\S]*?report\.phase = phase;[\s\S]*?writeReport\(\);[\s\S]*?\}[\s\S]*?writeReport\(\);\s*try \{/,
  'the witness writes an initial report before browser work and persists every phase transition',
);
assert.match(
  browserWitness,
  /async function waitUntil\(predicate, description\)[\s\S]*?const remainingMs = deadlineMs - \(Date\.now\(\) - startedAt\)[\s\S]*?predicate\(remainingMs\)[\s\S]*?async function withinCallerDeadline\([\s\S]*?Promise\.race\([\s\S]*?caller deadline elapsed during/,
  'each wait passes its caller-provided remaining deadline into awaited browser operations rather than a hidden cap',
);
assert.match(
  browserWitness,
  /const call = \(method, params = \{\}, budgetMs = deadlineMs\) => withinCallerDeadline\([\s\S]*?cdp\.call\(method, params\)[\s\S]*?await call\('Page\.enable'\)[\s\S]*?evaluate\(call,/,
  'CDP setup and Runtime.evaluate calls use the bounded caller-deadline wrapper',
);
assert.doesNotMatch(
  browserWitness,
  /await cdp\.call\(/,
  'no direct awaited CDP call may bypass the caller deadline',
);
assert.match(
  browserWitness,
  /catch \(error\) \{[\s\S]*?report\.status = 'failed';[\s\S]*?report\.failurePhase = report\.phase;[\s\S]*?writeReport\(\);/,
  'failure reports retain the exact last persisted phase',
);

console.log('kiln fixed-camera renderer contracts passed');
