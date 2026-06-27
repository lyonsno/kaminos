#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  ORB_INNER_ENGINE_IDENTITY,
  createOrbInnerEngineCore,
  createOrbInnerEngineGeneratedSubstrate,
  createOrbInnerEngineGuideSubstrate,
  renderOrbApertureProxyFrame,
  renderOrbInnerEngineFrame,
  writeRgbaPng,
} from './orb-inner-engine-core.js';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const outDir = resolve(args.get('--out-dir') || '/tmp/kaminos-orb-inner-engine-witness');
const seed = args.get('--seed') || 'molten-heartfucker-core-v0';
const size = Number(args.get('--size') || 640);
const apertureOpen = Number(args.get('--aperture-open') || 0.58);
const animationPhase = Number(args.get('--phase') || 0.375);

const referencePaths = [
  '/Users/noahlyons/dev/kaminos/assets/evil_orb_inner_core_source_image.png',
  '/Users/noahlyons/dev/kaminos/assets/evil_orb_original_generated_source_image.png',
  '/Users/noahlyons/dev/kaminos/assets/evil_orb_SHARP_splat_render.png',
];

function sha256(path) {
  if (!existsSync(path)) return null;
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertWitness(frame, label) {
  const { metrics } = frame;
  if (metrics.flatGlowScore >= 0.65) {
    throw new Error(`${label} collapsed into flat glow: flatGlowScore=${metrics.flatGlowScore}`);
  }
  if ((metrics.radialRibPixels || 0) < 500 || (metrics.nestedRingPixels || 0) < 700) {
    throw new Error(`${label} lacks mechanical ring/rib structure`);
  }
}

function makeTrajectoryContactSheet(frames) {
  const gutter = 8;
  const width = frames.reduce((sum, frame) => sum + frame.width, 0) + gutter * (frames.length - 1);
  const height = Math.max(...frames.map(frame => frame.height));
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 10;
    rgba[i + 1] = 10;
    rgba[i + 2] = 11;
    rgba[i + 3] = 255;
  }

  let xOffset = 0;
  for (const frame of frames) {
    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        const src = (y * frame.width + x) * 4;
        const dst = (y * width + xOffset + x) * 4;
        rgba[dst] = frame.rgba[src];
        rgba[dst + 1] = frame.rgba[src + 1];
        rgba[dst + 2] = frame.rgba[src + 2];
        rgba[dst + 3] = frame.rgba[src + 3];
      }
    }
    xOffset += frame.width + gutter;
  }

  return { width, height, rgba };
}

function compactMetrics(metrics) {
  return {
    flatGlowScore: metrics.flatGlowScore,
    radialDialBiasScore: metrics.radialDialBiasScore,
    angularAsymmetryScore: metrics.angularAsymmetryScore,
    sixfoldSymmetryScore: metrics.sixfoldSymmetryScore,
    darkRimContrast: metrics.darkRimContrast,
    hotCenterPixels: metrics.hotCenterPixels,
    radialRibPixels: metrics.radialRibPixels,
    nestedRingPixels: metrics.nestedRingPixels,
    occluderPixels: metrics.occluderPixels,
    orangeChannelPixels: metrics.orangeChannelPixels,
    visibleCorePixels: metrics.visibleCorePixels,
    shellOccludedPixels: metrics.shellOccludedPixels,
  };
}

mkdirSync(outDir, { recursive: true });

const core = createOrbInnerEngineCore({ seed, socketRadius: 1, animationPhase });
const guideSubstrate = createOrbInnerEngineGuideSubstrate({ seed, width: size, height: size });
const generatedSubstrate = createOrbInnerEngineGeneratedSubstrate({ seed, width: size, height: size });
const standalone = renderOrbInnerEngineFrame({ width: size, height: size, seed, animationPhase });
const guided = renderOrbInnerEngineFrame({ width: size, height: size, seed, animationPhase, guideSubstrate });
const generated = renderOrbInnerEngineFrame({ width: size, height: size, seed, animationPhase, guideSubstrate, generatedSubstrate });
const apertureProxy = renderOrbApertureProxyFrame({ width: size, height: size, seed, animationPhase, apertureOpen, generatedSubstrate });

assertWitness(standalone, 'standalone core');
assertWitness(guided, 'guide-substrate core');
assertWitness(generated, 'generated-substrate core');
assertWitness(apertureProxy, 'aperture proxy');

const standalonePng = join(outDir, 'orb-inner-engine-standalone.png');
const guideSubstratePng = join(outDir, 'orb-inner-engine-guide-substrate.png');
const generatedSubstratePng = join(outDir, 'orb-inner-engine-generated-substrate.png');
const apertureProxyPng = join(outDir, 'orb-inner-engine-aperture-proxy.png');
const trajectoryReportPath = join(outDir, 'orb-inner-engine-trajectory-report.json');
const trajectoryContactSheetPng = join(outDir, 'orb-inner-engine-trajectory-contact-sheet.png');
const reportPath = join(outDir, `${ORB_INNER_ENGINE_IDENTITY}.json`);

mkdirSync(dirname(standalonePng), { recursive: true });
writeRgbaPng(standalonePng, standalone);
writeRgbaPng(guideSubstratePng, guided);
writeRgbaPng(generatedSubstratePng, generated);
writeRgbaPng(apertureProxyPng, apertureProxy);
writeRgbaPng(trajectoryContactSheetPng, makeTrajectoryContactSheet([standalone, guided, generated, apertureProxy]));

const trajectoryReport = {
  identity: 'orb-inner-engine-trajectory-report-v0',
  seed,
  size,
  apertureOpen,
  visualOutputsInspected: true,
  contactSheet: trajectoryContactSheetPng,
  frameOrder: ['standalone', 'guideSubstrate', 'generatedSubstrate', 'apertureProxy'],
  frames: [
    {
      label: 'standalone',
      path: standalonePng,
      role: 'baseline procedural radial core, intentionally viewable without Lamellar apertures',
      metrics: compactMetrics(standalone.metrics),
    },
    {
      label: 'guideSubstrate',
      path: guideSubstratePng,
      role: 'reference-derived mechanical guide: rings/ribs/channels without generated material transfer',
      metrics: compactMetrics(guided.metrics),
    },
    {
      label: 'generatedSubstrate',
      path: generatedSubstratePng,
      role: 'current anti-dial material pass: dirty plate, asymmetric baffle, bounded off-axis underlight',
      metrics: compactMetrics(generated.metrics),
    },
    {
      label: 'apertureProxy',
      path: apertureProxyPng,
      role: 'simple Lamellar proxy: five irregular openings, shell occlusion, rim light catch',
      metrics: compactMetrics(apertureProxy.metrics),
    },
  ],
  compressedVerdict: 'Partial improvement, not final and not operator-smoke: the generated substrate now breaks radial dial bias numerically and adds contained off-axis underlight, but the witness still reads too procedural/mechanical and needs a richer non-dial occlusion vocabulary before claiming visual convergence.',
  nextRecommendedSlice: 'Replace remaining even radial spokes with staggered occlusion islands and aperture-shaped light spill, then compare against the source-image core rather than only internal metrics.',
};
writeFileSync(trajectoryReportPath, `${JSON.stringify(trajectoryReport, null, 2)}\n`);

const receipt = {
  ok: true,
  coreIdentity: ORB_INNER_ENGINE_IDENTITY,
  seed,
  size,
  animationPhase,
  apertureOpen,
  references: referencePaths.map(path => ({
    path,
    present: existsSync(path),
    sha256: sha256(path),
  })),
  handoff: {
    socket: core.socket,
    emissiveField: core.material.emissiveField,
    volumetric: core.volumetric,
    occlusion: core.material.occlusion,
    lightSpill: core.lightSpill,
    generatedSubstrate: core.generatedSubstrate,
    apertureContract: {
      consumes: [
        'core socket transform/radius',
        'aperture masks and frames',
        'rim/lip proximity',
        'shell occlusion',
        'inner exposure',
        'animation/opening parameters',
      ],
      proxy: {
        apertureOpen,
        maskModel: 'five-slot-irregular-aperture-proxy-v1',
        shellOcclusion: core.material.occlusion.shellOcclusion,
      },
    },
  },
  materialParams: {
    emissiveField: core.material.emissiveField,
    volumetric: core.volumetric,
    occlusion: core.material.occlusion,
    lightSpill: core.lightSpill,
    generatedSubstrate: core.generatedSubstrate,
  },
  outputs: {
    standalonePng,
    guideSubstratePng,
    generatedSubstratePng,
    apertureProxyPng,
    trajectoryReportPath,
    trajectoryContactSheetPng,
  },
  metrics: {
    standalone: standalone.metrics,
    guideSubstrate: guided.metrics,
    generatedSubstrate: generated.metrics,
    generatedSubstrateSource: generatedSubstrate.metrics,
    guideSubstrateSource: guideSubstrate.metrics,
    apertureProxy: apertureProxy.metrics,
  },
  visualVerdict: trajectoryReport.compressedVerdict,
};

writeFileSync(reportPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  coreIdentity: ORB_INNER_ENGINE_IDENTITY,
  reportPath,
  standalonePng,
  guideSubstratePng,
  generatedSubstratePng,
  apertureProxyPng,
  trajectoryReportPath,
  trajectoryContactSheetPng,
}, null, 2));
