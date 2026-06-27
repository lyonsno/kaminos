import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = new URL('..', import.meta.url).pathname;
const corePath = join(root, 'orb-inner-engine-core.js');
const witnessPath = join(root, 'orb-inner-engine-witness.mjs');

assert.ok(existsSync(corePath), 'orb-inner-engine-core.js must define the standalone contained core module');
assert.ok(existsSync(witnessPath), 'orb-inner-engine-witness.mjs must render the standalone and aperture-proxy witness');

const coreSource = readFileSync(corePath, 'utf8');
assert.match(coreSource, /orb-inner-engine-witness-v0/, 'core module names the witness identity');
assert.match(coreSource, /createOrbInnerEngineCore/, 'core module exports deterministic core construction');
assert.match(coreSource, /renderOrbInnerEngineFrame/, 'core module renders the standalone core frame');
assert.match(coreSource, /renderOrbApertureProxyFrame/, 'core module renders a masked aperture proxy frame');
assert.match(coreSource, /createOrbInnerEngineGuideSubstrate/, 'core module exposes the radial guide as procedural substrate input');
assert.match(coreSource, /createOrbInnerEngineGeneratedSubstrate/, 'core module exposes generated-asset campaign substrate input');
assert.match(coreSource, /dirtyPlate/, 'generated substrate carries dirty black plate material fields');
assert.match(coreSource, /underlightChannel/, 'generated substrate carries bounded underlight channel fields');
assert.match(coreSource, /apertureWindow/, 'generated substrate carries aperture-window composition fields');
assert.match(coreSource, /occlusionIsland/, 'generated substrate carries staggered non-dial occlusion islands');
assert.match(coreSource, /apertureShapedSpill/, 'aperture proxy records opening-shaped light spill');
assert.match(coreSource, /radialRib/, 'core renderer has explicit radial rib structure');
assert.match(coreSource, /nestedRing/, 'core renderer has explicit nested ring structure');
assert.match(coreSource, /occluder/, 'core renderer has explicit inner occluders');
assert.match(coreSource, /lightSpill/, 'core module exposes aperture/rim light-spill affordances');
assert.match(coreSource, /shellOcclusion/, 'core module exposes shell occlusion/falloff fields');

const {
  ORB_INNER_ENGINE_IDENTITY,
  createOrbInnerEngineCore,
  createOrbInnerEngineGeneratedSubstrate,
  createOrbInnerEngineGuideSubstrate,
  renderOrbInnerEngineFrame,
  renderOrbApertureProxyFrame,
} = await import(`${corePath}?contract=${Date.now()}`);

assert.equal(ORB_INNER_ENGINE_IDENTITY, 'orb-inner-engine-witness-v0');

const core = createOrbInnerEngineCore({
  seed: 'molten-heartfucker-core-contract',
  socketRadius: 1.25,
  animationPhase: 0.375,
});

assert.equal(core.identity, 'orb-inner-engine-witness-v0');
assert.equal(core.seed, 'molten-heartfucker-core-contract');
assert.equal(core.socket.radius, 1.25);
assert.equal(core.socket.transform.space, 'lamellar-core-socket-local');
assert.ok(core.material.emissiveField.hotCenterGain > core.material.emissiveField.channelGain, 'hot center must dominate bounded channels');
assert.ok(core.material.emissiveField.channelGain > 0, 'orange channel gain must be explicit');
assert.ok(core.material.occlusion.shellOcclusion > 0.3, 'shell occlusion must darken the contained rim');
assert.ok(core.material.occlusion.darkRimFalloff > 1, 'dark rim falloff must be nonlinear');
assert.ok(core.lightSpill.rimCatch > 0, 'rim light-spill affordance must be present');
assert.ok(core.lightSpill.apertureTransmission > 0, 'aperture light-spill affordance must be present');
assert.ok(core.volumetric.heatCadenceHz > 0, 'heat cadence must be explicit even if v0 is software-rendered');

const guideSubstrate = createOrbInnerEngineGuideSubstrate({
  seed: 'molten-heartfucker-core-contract',
  width: 256,
  height: 256,
});

assert.equal(guideSubstrate.identity, 'orb-inner-engine-guide-substrate-v0');
assert.equal(guideSubstrate.seed, 'molten-heartfucker-core-contract');
assert.equal(guideSubstrate.width, 256);
assert.equal(guideSubstrate.height, 256);
assert.equal(typeof guideSubstrate.sample, 'function', 'guide substrate exposes a shader-like sampler');
assert.ok(guideSubstrate.metrics.guideRingPixels > 1200, 'guide substrate has nested ring fields');
assert.ok(guideSubstrate.metrics.guideRibPixels > 900, 'guide substrate has radial rib fields');
assert.ok(guideSubstrate.metrics.guideOccluderPixels > 700, 'guide substrate has occluder fields');
assert.ok(guideSubstrate.metrics.guideChannelPixels > 1000, 'guide substrate has bounded channel fields');
assert.ok(guideSubstrate.sample(0, 0).hotCenter > 0.8, 'guide substrate marks the hot center');

const generatedSubstrate = createOrbInnerEngineGeneratedSubstrate({
  seed: 'molten-heartfucker-core-contract',
  width: 256,
  height: 256,
});

assert.equal(generatedSubstrate.identity, 'orb-inner-engine-generated-substrate-v1');
assert.equal(generatedSubstrate.profile, 'molten-flux-crop-v1');
assert.equal(generatedSubstrate.width, 256);
assert.equal(generatedSubstrate.height, 256);
assert.equal(typeof generatedSubstrate.sample, 'function', 'generated substrate exposes a shader-like sampler');
assert.ok(generatedSubstrate.references.some(reference => reference.role === 'best composition substrate'), 'generated substrate records v1 composition source');
assert.ok(generatedSubstrate.references.some(reference => reference.role === 'best dirty black-plate / underlight material substrate'), 'generated substrate records v1 material source');
assert.ok(generatedSubstrate.metrics.dirtyPlatePixels > 2500, 'generated substrate has dirty black plate fields');
assert.ok(generatedSubstrate.metrics.underlightChannelPixels > 900, 'generated substrate has bounded underlight channel fields');
assert.ok(generatedSubstrate.metrics.apertureWindowPixels > 5000, 'generated substrate has aperture-window composition fields');
assert.ok(generatedSubstrate.metrics.occlusionIslandPixels > 2200, 'generated substrate has staggered occlusion-island fields');
assert.ok(generatedSubstrate.sample(0.52, -0.12).underlightChannel > 0.12, 'generated substrate exposes off-axis underlight channel samples');

const standalone = renderOrbInnerEngineFrame({
  width: 256,
  height: 256,
  seed: 'molten-heartfucker-core-contract',
  animationPhase: 0.375,
});

assert.equal(standalone.identity, 'orb-inner-engine-witness-v0');
assert.equal(standalone.width, 256);
assert.equal(standalone.height, 256);
assert.ok(standalone.rgba instanceof Uint8ClampedArray, 'standalone renderer returns RGBA pixels');
assert.equal(standalone.rgba.length, 256 * 256 * 4);
assert.ok(standalone.metrics.hotCenterPixels > 450, 'standalone core must contain a hot radial center');
assert.ok(standalone.metrics.radialRibPixels > 900, 'standalone core must contain visible radial ribs');
assert.ok(standalone.metrics.nestedRingPixels > 1200, 'standalone core must contain visible nested rings');
assert.ok(standalone.metrics.occluderPixels > 700, 'standalone core must contain dark mechanical occluders');
assert.ok(standalone.metrics.orangeChannelPixels > 1600, 'standalone core must contain bounded orange emissive channels');
assert.ok(standalone.metrics.darkRimContrast > 0.16, 'standalone core must have a darker occluded outer rim');
assert.ok(standalone.metrics.flatGlowScore < 0.58, 'standalone core must not collapse into a flat glow disk');
assert.ok(Number.isFinite(standalone.metrics.radialDialBiasScore), 'standalone metrics must record radial/dial bias score');
assert.ok(Number.isFinite(standalone.metrics.angularAsymmetryScore), 'standalone metrics must record angular asymmetry score');

const guideDriven = renderOrbInnerEngineFrame({
  width: 256,
  height: 256,
  seed: 'molten-heartfucker-core-contract',
  animationPhase: 0.375,
  guideSubstrate,
});

assert.ok(guideDriven.metrics.guideSubstratePixels > 2200, 'guided frame consumes guide substrate fields');
assert.ok(guideDriven.metrics.guideChannelPixels > 900, 'guided frame carries bounded guide channels into the render');
assert.ok(guideDriven.metrics.guideOccluderPixels > 650, 'guided frame carries occluder fields into the render');
assert.ok(guideDriven.metrics.radialRibPixels >= standalone.metrics.radialRibPixels, 'guide substrate must not weaken radial ribs');
assert.ok(guideDriven.metrics.flatGlowScore <= standalone.metrics.flatGlowScore, 'guide substrate must not increase flat-glow risk');

const generatedDriven = renderOrbInnerEngineFrame({
  width: 256,
  height: 256,
  seed: 'molten-heartfucker-core-contract',
  animationPhase: 0.375,
  guideSubstrate,
  generatedSubstrate,
});

assert.ok(generatedDriven.metrics.generatedSubstratePixels > 2600, 'generated frame consumes generated substrate fields');
assert.ok(generatedDriven.metrics.dirtyPlatePixels > 1800, 'generated frame carries dirty plate occluders into the render');
assert.ok(generatedDriven.metrics.underlightChannelPixels > 700, 'generated frame carries bounded underlight channels into the render');
assert.ok(generatedDriven.metrics.occluderPixels > guideDriven.metrics.occluderPixels * 1.4, 'generated substrate must materially increase occluding machinery');
assert.ok(generatedDriven.metrics.flatGlowScore <= guideDriven.metrics.flatGlowScore, 'generated substrate must not increase flat-glow risk versus guide-only render');
assert.ok(generatedDriven.metrics.darkRimContrast >= guideDriven.metrics.darkRimContrast, 'generated substrate must preserve or improve dark rim contrast');
assert.ok(generatedDriven.metrics.angularAsymmetryScore > guideDriven.metrics.angularAsymmetryScore, 'generated substrate must move the core away from rotational dial symmetry');
assert.ok(generatedDriven.metrics.radialDialBiasScore < guideDriven.metrics.radialDialBiasScore, 'generated substrate must reduce radial/dial bias versus guide-only render');
assert.ok(generatedDriven.metrics.occlusionIslandPixels > 1000, 'generated frame must render staggered occlusion islands');
assert.ok(generatedDriven.metrics.occlusionIslandSpreadScore > 0.18, 'occlusion islands must be angularly staggered rather than a single broad mud patch');
assert.ok(generatedDriven.metrics.radialDialBiasScore < standalone.metrics.radialDialBiasScore * 0.72, 'generated islands must materially reduce dial bias versus standalone');

const aperture = renderOrbApertureProxyFrame({
  width: 256,
  height: 256,
  seed: 'molten-heartfucker-core-contract',
  animationPhase: 0.375,
  apertureOpen: 0.62,
  generatedSubstrate,
});

assert.equal(aperture.identity, 'orb-inner-engine-witness-v0');
assert.ok(aperture.metrics.visibleCorePixels > 1200, 'aperture proxy must reveal core through openings');
assert.ok(aperture.metrics.shellOccludedPixels > 8000, 'aperture proxy must hide core behind shell matter');
assert.ok(aperture.metrics.rimLightCatchPixels > 600, 'aperture proxy must expose rim light-spill affordance');
assert.ok(aperture.metrics.flatGlowScore < 0.62, 'aperture proxy must preserve structure rather than pasted glow');
assert.ok(aperture.metrics.angularAsymmetryScore > standalone.metrics.angularAsymmetryScore, 'aperture proxy must introduce asymmetric containment rather than a centered dial view');
assert.ok(aperture.metrics.radialDialBiasScore < standalone.metrics.radialDialBiasScore, 'aperture proxy must reduce radial/dial bias versus standalone core');
assert.ok(aperture.metrics.apertureShapedSpillPixels > 700, 'aperture proxy must expose light spill shaped by apertures');
assert.ok(aperture.metrics.apertureSpillContainmentScore > 0.12, 'aperture spill must be concentrated on openings/rims rather than a uniform orange wash');

const witnessSource = readFileSync(witnessPath, 'utf8');
assert.match(witnessSource, /coreIdentity/, 'witness receipt records core identity');
assert.match(witnessSource, /emissiveField/, 'witness receipt records emissive material parameters');
assert.match(witnessSource, /volumetric/, 'witness receipt records volumetric/fire/heat parameters');
assert.match(witnessSource, /occlusion/, 'witness receipt records occlusion/falloff model');
assert.match(witnessSource, /lightSpill/, 'witness receipt records aperture/rim light-spill affordances');
assert.match(witnessSource, /standalonePng/, 'witness receipt records standalone witness image');
assert.match(witnessSource, /apertureProxyPng/, 'witness receipt records aperture-proxy witness image');
assert.match(witnessSource, /guideSubstratePng/, 'witness receipt records guide-substrate witness image');
assert.match(witnessSource, /generatedSubstratePng/, 'witness receipt records generated-substrate witness image');
assert.match(witnessSource, /trajectoryReportPath/, 'witness receipt records compressed visual trajectory report');
assert.match(witnessSource, /trajectoryContactSheetPng/, 'witness receipt records visual trajectory contact sheet');
assert.match(witnessSource, /sourceReferenceComparison/, 'witness trajectory records source-reference comparison pointers');

const outDir = mkdtempSync(join(tmpdir(), 'kaminos-orb-inner-engine-contract-'));
try {
  execFileSync('node', [
    witnessPath,
    '--out-dir', outDir,
    '--seed', 'molten-heartfucker-core-contract',
    '--size', '256',
    '--aperture-open', '0.62',
  ], { cwd: root, stdio: 'pipe' });

  const reportPath = join(outDir, 'orb-inner-engine-witness-v0.json');
  const standalonePng = join(outDir, 'orb-inner-engine-standalone.png');
  const aperturePng = join(outDir, 'orb-inner-engine-aperture-proxy.png');
  const guideSubstratePng = join(outDir, 'orb-inner-engine-guide-substrate.png');
  const generatedSubstratePng = join(outDir, 'orb-inner-engine-generated-substrate.png');
  const trajectoryReportPath = join(outDir, 'orb-inner-engine-trajectory-report.json');
  const trajectoryContactSheetPng = join(outDir, 'orb-inner-engine-trajectory-contact-sheet.png');
  assert.ok(existsSync(reportPath), 'witness writes a JSON receipt');
  assert.ok(existsSync(standalonePng), 'witness writes standalone PNG');
  assert.ok(existsSync(aperturePng), 'witness writes aperture-proxy PNG');
  assert.ok(existsSync(guideSubstratePng), 'witness writes guide-substrate PNG');
  assert.ok(existsSync(generatedSubstratePng), 'witness writes generated-substrate PNG');
  assert.ok(existsSync(trajectoryReportPath), 'witness writes compressed visual trajectory report');
  assert.ok(existsSync(trajectoryContactSheetPng), 'witness writes visual trajectory contact sheet');
  assert.equal(readFileSync(standalonePng).subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'standalone image is a PNG');
  assert.equal(readFileSync(aperturePng).subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'aperture proxy image is a PNG');
  assert.equal(readFileSync(guideSubstratePng).subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'guide-substrate image is a PNG');
  assert.equal(readFileSync(generatedSubstratePng).subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'generated-substrate image is a PNG');
  assert.equal(readFileSync(trajectoryContactSheetPng).subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'trajectory contact sheet is a PNG');

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.ok, true);
  assert.equal(report.coreIdentity, 'orb-inner-engine-witness-v0');
  assert.equal(report.seed, 'molten-heartfucker-core-contract');
  assert.equal(report.outputs.standalonePng, standalonePng);
  assert.equal(report.outputs.apertureProxyPng, aperturePng);
  assert.equal(report.outputs.guideSubstratePng, guideSubstratePng);
  assert.equal(report.outputs.generatedSubstratePng, generatedSubstratePng);
  assert.equal(report.outputs.trajectoryReportPath, trajectoryReportPath);
  assert.equal(report.outputs.trajectoryContactSheetPng, trajectoryContactSheetPng);
  assert.ok(report.metrics.standalone.radialRibPixels > 900);
  assert.ok(report.metrics.standalone.nestedRingPixels > 1200);
  assert.ok(report.metrics.guideSubstrate.guideSubstratePixels > 2200);
  assert.ok(report.metrics.generatedSubstrate.generatedSubstratePixels > 2600);
  assert.ok(report.metrics.generatedSubstrate.occluderPixels > report.metrics.guideSubstrate.occluderPixels * 1.4);
  assert.ok(report.metrics.generatedSubstrate.flatGlowScore <= report.metrics.guideSubstrate.flatGlowScore);
  assert.ok(report.metrics.generatedSubstrate.radialDialBiasScore < report.metrics.guideSubstrate.radialDialBiasScore);
  assert.ok(report.metrics.generatedSubstrate.occlusionIslandPixels > 1000);
  assert.ok(report.metrics.generatedSubstrate.occlusionIslandSpreadScore > 0.18);
  assert.ok(report.metrics.guideSubstrate.guideChannelPixels > 900);
  assert.ok(report.metrics.apertureProxy.shellOccludedPixels > 8000);
  assert.ok(report.metrics.apertureProxy.radialDialBiasScore < report.metrics.standalone.radialDialBiasScore);
  assert.ok(report.metrics.apertureProxy.apertureShapedSpillPixels > 700);
  assert.ok(report.metrics.apertureProxy.apertureSpillContainmentScore > 0.12);
  assert.ok(report.handoff.socket.radius > 0);
  assert.ok(report.handoff.emissiveField.hotCenterGain > 0);
  assert.ok(report.handoff.occlusion.shellOcclusion > 0);
  assert.ok(report.handoff.lightSpill.apertureTransmission > 0);

  const trajectoryReport = JSON.parse(readFileSync(trajectoryReportPath, 'utf8'));
  assert.equal(trajectoryReport.identity, 'orb-inner-engine-trajectory-report-v0');
  assert.equal(trajectoryReport.visualOutputsInspected, true);
  assert.ok(trajectoryReport.frames.length >= 4, 'trajectory report records the witness frame sequence');
  assert.ok(trajectoryReport.compressedVerdict, 'trajectory report carries a compressed verdict');
  assert.match(trajectoryReport.compressedVerdict, /not final|not operator-smoke|partial/i, 'trajectory report must not overclaim final convergence');
  assert.ok(trajectoryReport.sourceReferenceComparison, 'trajectory report carries source-reference comparison data');
  assert.ok(trajectoryReport.sourceReferenceComparison.references.some(reference => reference.role === 'inner-core-target'), 'trajectory report names the inner-core source target');
  assert.ok(trajectoryReport.sourceReferenceComparison.remainingGaps.some(gap => /dial|spoke|fan|procedural/i.test(gap)), 'trajectory report names remaining visual gaps against source references');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
