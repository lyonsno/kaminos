#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  ORB_INNER_ENGINE_IDENTITY,
  createOrbInnerEngineCore,
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

mkdirSync(outDir, { recursive: true });

const core = createOrbInnerEngineCore({ seed, socketRadius: 1, animationPhase });
const standalone = renderOrbInnerEngineFrame({ width: size, height: size, seed, animationPhase });
const apertureProxy = renderOrbApertureProxyFrame({ width: size, height: size, seed, animationPhase, apertureOpen });

assertWitness(standalone, 'standalone core');
assertWitness(apertureProxy, 'aperture proxy');

const standalonePng = join(outDir, 'orb-inner-engine-standalone.png');
const apertureProxyPng = join(outDir, 'orb-inner-engine-aperture-proxy.png');
const reportPath = join(outDir, `${ORB_INNER_ENGINE_IDENTITY}.json`);

mkdirSync(dirname(standalonePng), { recursive: true });
writeRgbaPng(standalonePng, standalone);
writeRgbaPng(apertureProxyPng, apertureProxy);

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
        maskModel: 'six-slot-radial-aperture-proxy-v0',
        shellOcclusion: core.material.occlusion.shellOcclusion,
      },
    },
  },
  materialParams: {
    emissiveField: core.material.emissiveField,
    volumetric: core.volumetric,
    occlusion: core.material.occlusion,
    lightSpill: core.lightSpill,
  },
  outputs: {
    standalonePng,
    apertureProxyPng,
  },
  metrics: {
    standalone: standalone.metrics,
    apertureProxy: apertureProxy.metrics,
  },
  visualVerdict: 'Contained radial engine core: hot center, darker machinery rim, nested rings, radial ribs, occluders, bounded orange channels, and shell-masked aperture proxy.',
};

writeFileSync(reportPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  coreIdentity: ORB_INNER_ENGINE_IDENTITY,
  reportPath,
  standalonePng,
  apertureProxyPng,
}, null, 2));
