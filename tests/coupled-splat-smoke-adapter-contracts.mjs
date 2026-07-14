import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const domainModuleUrl = new URL('../coupled-smoke-domain.mjs', import.meta.url);
const domainSource = await readFile(domainModuleUrl, 'utf8').catch(() => '');
const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const witness = await readFile(new URL('../volume-witness.mjs', import.meta.url), 'utf8');
const runtimeAndDomainSource = `${core}\n${domainSource}`;

assert.match(
  domainSource,
  /export function smokeDomainWorldContract/,
  'coupled smoke adapter must define a reusable world-space domain contract',
);

const {
  COUPLED_SMOKE_ATTACHMENT_IDENTITY,
  COUPLED_SMOKE_DEPTH_CONTRACT,
  COUPLED_SMOKE_FAR_RETENTION_THRESHOLD,
  COUPLED_SMOKE_OVERLAP_AUTHORITY,
  retainFarSmokeCandidate,
  smokeDomainMetricVelocityScale,
  smokeDomainWorldContract,
} = await import(domainModuleUrl);

assert.equal(COUPLED_SMOKE_ATTACHMENT_IDENTITY, 'coupled-near-far-raymarched-smoke-attachment-v0');
assert.equal(COUPLED_SMOKE_OVERLAP_AUTHORITY, 'near-authoritative-overlap-far-residual-v0');
assert.equal(COUPLED_SMOKE_DEPTH_CONTRACT, 'splat-depth-conditioned-front-back-near-far-smoke-intervals-v1');
assert.equal(COUPLED_SMOKE_FAR_RETENTION_THRESHOLD, 0.0005);
assert.equal(retainFarSmokeCandidate(0.006), 0.006, 'sub-cell interpolated smoke survives far transport');
assert.equal(retainFarSmokeCandidate(0.0001), 0, 'the named floor still rejects numerical residue');
assert.match(
  domainSource,
  /smokeCandidate\s*>\s*FAR_SMOKE_RETENTION_THRESHOLD/,
  'far WGSL uses the same named retention boundary as the executable contract',
);
assert.match(
  domainSource,
  /if\s*\(smoke\s*>\s*FAR_SMOKE_RETENTION_THRESHOLD\)\s*\{\s*atomicAdd\(&transferCounters\[1\]/,
  'far-support diagnostics count every retained and renderable smoke cell',
);
const farInputShaderSource = domainSource.match(/fn csSmokeDomainFarInput[\s\S]*?\n}\n\nstruct SmokeDomainVSOut/)?.[0] || '';
assert.doesNotMatch(
  farInputShaderSource,
  /if\s*\(smoke\s*>\s*0\.01\)/,
  'far diagnostics cannot silently apply a stronger threshold than transport and rendering',
);

assert.deepEqual(smokeDomainWorldContract(), {
  identity: 'explicit-2x-world-bounds-upper-quarter-overlap-v0',
  near: { min: [-1, -1, -1], max: [1, 1, 1] },
  far: { min: [-2, 0.5, -2], max: [2, 4.5, 2] },
  overlap: { min: [-1, 0.5, -1], max: [1, 1, 1] },
  farLinearExtentRatio: 2,
  farVolumeRatio: 8,
});

assert.equal(smokeDomainMetricVelocityScale(64, 24), 0.1875);
assert.equal(smokeDomainMetricVelocityScale(96, 48), 0.25);
assert.equal(smokeDomainMetricVelocityScale(160, 96), 0.3);
assert.throws(() => smokeDomainMetricVelocityScale(0, 24), /nearGrid/);
assert.throws(() => smokeDomainMetricVelocityScale(64, 0), /farGrid/);

assert.match(page, /volume_smoke_domain_mode/, 'route can opt into the coupled near/far smoke attachment');
assert.match(page, /coupled-near-fire-far-smoke-v0/, 'route names the coupled near/far strategy');
assert.match(core, /COUPLED_SMOKE_ATTACHMENT_IDENTITY/, 'runtime exposes the coupled smoke attachment identity');
assert.match(core, /COUPLED_SMOKE_OVERLAP_AUTHORITY/, 'runtime exposes one near/far overlap authority');
assert.match(core, /COUPLED_SMOKE_DEPTH_CONTRACT/, 'runtime refuses to present representative depth as final overlap truth');
assert.match(runtimeAndDomainSource, /METRIC_VELOCITY_SCALE/, 'far advection converts near-cell velocity into far-cell units');
assert.match(runtimeAndDomainSource, /nearAuthoritativeOverlap/, 'far smoke is suppressed where the near volume owns extinction');
assert.match(domainSource, /struct SmokeDomainLayerOutput[\s\S]*frontColor[\s\S]*frontInterval[\s\S]*backColor[\s\S]*backInterval/, 'far smoke emits the same four front/back interval products as the v1 near-smoke producer');
assert.match(domainSource, /hybridSplatDepth/, 'far smoke splits samples against transformed splat depth instead of a whole-layer centroid');
assert.match(core, /splatDepthConditionedSmokeSplit/, 'runtime preserves the effective v1 split identity');
assert.match(core, /hybridSmokePhaseAuthority/, 'runtime preserves shared-simulator smoke phase authority');
assert.doesNotMatch(core, /hybridSmokeFrontOpacityCeiling/, 'v1 coupled composition must not retain the legacy front-smoke opacity ceiling');
assert.match(core, /smokeDomainFarTopActiveCells/, 'runtime reports fresh top-layer support');
assert.match(core, /smokeDomainFarOutflowCells/, 'runtime reports active upward outflow at the far ceiling');
assert.match(core, /smokeDomainFarSupportLifetimeFrames/, 'runtime reports the observed far-support lifetime window');
assert.match(core, /smokeDomainFarActiveCells/, 'runtime names total active far-state support without calling it inlet activity');
assert.doesNotMatch(core, /smokeDomainFarInputActiveCells/, 'total far-state activity must not masquerade as transfer input activity');
assert.match(core, /hybridSmokeLayer:[\s\S]*coupledDomain/, 'hybrid smoke attachment debug state carries coupled-domain identity');
assert.match(witness, /smokeDomainFarTopActiveCells/, 'witness preserves top support telemetry');
assert.match(witness, /smokeDomainFarOutflowCells/, 'witness preserves top outflow telemetry');
assert.match(witness, /coupledSmokeAttachmentIdentity/, 'witness preserves effective coupled smoke attachment identity');
assert.match(witness, /smoke-domain-coupling/, 'witness exposes a narrow coupled smoke evidence mode');
assert.match(
  witness,
  /assert\.equal\(state\.smokeDomainMode, expectedSmokeDomainMode/,
  'coupled smoke witness rejects a stale or substituted smoke-domain route',
);
assert.match(
  witness,
  /assert\.equal\(state\.coupledSmokeAttachmentIdentity, 'coupled-near-far-raymarched-smoke-attachment-v0'/,
  'coupled smoke witness verifies the accepted attachment ABI',
);
assert.match(
  witness,
  /assert\.ok\(state\.smokeDomainTransferActiveCells > 0/,
  'coupled smoke witness rejects a routed but inactive transfer adapter',
);
assert.match(
  witness,
  /assert\.ok\(state\.smokeDomainFarAdvectedActiveCells > 0/,
  'coupled smoke witness rejects a transfer buffer that never reaches persistent far advection',
);
assert.match(
  witness,
  /coupled smoke screenshot missing visible output/,
  'coupled smoke witness rejects blank visual output',
);

console.log('coupled splat smoke adapter contracts passed');
