import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

import {
  writeLirmArmatureProgramImplicitBodyWitness,
} from './lirm-speciation-armature-core.js';

export const LIRM_METABALL_SILHOUETTE_AUTHORITY_SCHEMA =
  'kaminos.lirm-metaball-silhouette-authority-tranche.v0';

const PARAMETER_SPECS = Object.freeze([
  Object.freeze({ id: 'bodyLength', semanticRole: 'axialExtent', min: 0.75, max: 1.4 }),
  Object.freeze({ id: 'bodyDepth', semanticRole: 'ventralDorsalMass', min: 0.25, max: 0.62 }),
  Object.freeze({ id: 'dorsalArch', semanticRole: 'dorsalProfile', min: -0.04, max: 0.28 }),
  Object.freeze({ id: 'posteriorMass', semanticRole: 'posteriorMass', min: 0.65, max: 1.45 }),
  Object.freeze({ id: 'supportSpacing', semanticRole: 'contactFootprint', min: 0.38, max: 0.82 }),
  Object.freeze({ id: 'supportLength', semanticRole: 'contactLimb', min: 0.22, max: 0.58 }),
]);

const BASELINE_PARAMETERS = Object.freeze({
  bodyLength: 1.05,
  bodyDepth: 0.36,
  dorsalArch: 0.03,
  posteriorMass: 0.85,
  supportSpacing: 0.52,
  supportLength: 0.32,
});

const PERTURBATIONS = Object.freeze([
  Object.freeze({ id: 'body-long', parameterId: 'bodyLength', value: 1.28 }),
  Object.freeze({ id: 'body-deep', parameterId: 'bodyDepth', value: 0.48 }),
  Object.freeze({ id: 'dorsal-arched', parameterId: 'dorsalArch', value: 0.2 }),
  Object.freeze({ id: 'posterior-heavy', parameterId: 'posteriorMass', value: 1.3 }),
  Object.freeze({ id: 'supports-wide', parameterId: 'supportSpacing', value: 0.72 }),
  Object.freeze({ id: 'supports-long', parameterId: 'supportLength', value: 0.5 }),
]);

const FIXED_PROMPT = [
  'Complete the supplied smooth creature construction as one healthy, aesthetically pleasing living animal.',
  'Keep the exact source camera, outer silhouette, body proportions, support placement, and major mass distribution authoritative.',
  'Elaborate coherent anatomical transitions, surface structure, material, and gentle character within that authored outline.',
  'Present one intact healthy quadruped with a continuous closed outer surface and four load-bearing supports on a clean pale studio background.',
].join(' ');

const TARGET_FIRST_MULTIVIEW_PROMPT = [
  'Every supplied reference image shows the same authored organism from a different camera.',
  'The first reference image is the authoritative target view: preserve its exact camera, outer silhouette, body proportions, support placement, and major mass distribution.',
  'Use later reference images only to resolve occluded three-dimensional structure belonging to that same organism.',
  'Complete one healthy, aesthetically pleasing living quadruped with coherent anatomical transitions, surface structure, material, and gentle character within the first view authored outline.',
].join(' ');

const TARGET_FIRST_MULTIVIEW_VIEWS = Object.freeze([
  Object.freeze({ id: 'target-three-quarter', role: 'authoritative-target', cameraYawRadians: 0.42 }),
  Object.freeze({ id: 'front', role: 'supplemental-structure', cameraYawRadians: 0 }),
  Object.freeze({ id: 'side', role: 'supplemental-structure', cameraYawRadians: 1.3 }),
  Object.freeze({ id: 'rear-three-quarter', role: 'supplemental-structure', cameraYawRadians: 2.2 }),
]);

const TARGET_FIRST_MULTIVIEW_CONDITIONS = Object.freeze([
  Object.freeze({
    id: 'target-only',
    distinctViewCount: 1,
    referenceViewIds: Object.freeze([
      'target-three-quarter',
      'target-three-quarter',
      'target-three-quarter',
    ]),
  }),
  Object.freeze({
    id: 'target-plus-front',
    distinctViewCount: 2,
    referenceViewIds: Object.freeze([
      'target-three-quarter',
      'target-three-quarter',
      'front',
    ]),
  }),
  Object.freeze({
    id: 'target-plus-side',
    distinctViewCount: 2,
    referenceViewIds: Object.freeze([
      'target-three-quarter',
      'target-three-quarter',
      'side',
    ]),
  }),
  Object.freeze({
    id: 'target-plus-side-plus-rear',
    distinctViewCount: 3,
    referenceViewIds: Object.freeze([
      'target-three-quarter',
      'side',
      'rear-three-quarter',
    ]),
  }),
]);

const vec3 = (x, y, z) => ({ x, y, z });

function add(a, b) {
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z);
}

function subtract(a, b) {
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}

function multiply(value, scale) {
  return vec3(value.x * scale, value.y * scale, value.z * scale);
}

function normalize(value) {
  const length = Math.hypot(value.x, value.y, value.z) || 1;
  return multiply(value, 1 / length);
}

function createPrimitives(parameters) {
  const bodyWidth = 0.44;
  const primitives = [];
  const stationCount = 6;

  for (let index = 0; index < stationCount; index += 1) {
    const t = index / (stationCount - 1);
    const axialProfile = Math.sin(Math.PI * t);
    const rearWeight = t < 0.42 ? 1 + (parameters.posteriorMass - 1) * (1 - t / 0.42) : 1;
    const frontTaper = t > 0.72 ? 1 - (t - 0.72) * 0.42 : 1;
    const arch = parameters.dorsalArch * Math.sin(Math.PI * t);
    primitives.push({
      kind: 'ellipsoid',
      role: 'bodyMass',
      center: vec3(0, arch, (t - 0.5) * parameters.bodyLength),
      radius: vec3(
        bodyWidth * (0.76 + axialProfile * 0.24) * rearWeight * frontTaper,
        parameters.bodyDepth * (0.78 + axialProfile * 0.22) * rearWeight,
        parameters.bodyLength * 0.19,
      ),
    });
  }

  const headCenter = vec3(0, parameters.dorsalArch * 0.34 + 0.025, parameters.bodyLength * 0.59);
  primitives.push({
    kind: 'ellipsoid',
    role: 'headOrientation',
    center: headCenter,
    radius: vec3(0.31, parameters.bodyDepth * 0.78, 0.27),
  });
  primitives.push({
    kind: 'ellipsoid',
    role: 'facialLandmark',
    center: add(headCenter, vec3(0, -0.025, 0.21)),
    radius: vec3(0.2, parameters.bodyDepth * 0.47, 0.18),
  });

  const supportThickness = 0.09;
  for (const longitudinal of [-0.26, 0.27]) {
    for (const side of [-1, 1]) {
      const shoulder = vec3(
        side * bodyWidth * 0.58,
        -parameters.bodyDepth * 0.25,
        longitudinal * parameters.bodyLength,
      );
      const target = vec3(
        side * parameters.supportSpacing,
        -parameters.bodyDepth - 0.18,
        longitudinal * parameters.bodyLength + (longitudinal > 0 ? 0.045 : -0.035),
      );
      const foot = add(
        shoulder,
        multiply(normalize(subtract(target, shoulder)), parameters.supportLength),
      );
      primitives.push({
        kind: 'capsule',
        role: 'contactLimb',
        a: shoulder,
        b: foot,
        radius: supportThickness,
      });
      primitives.push({
        kind: 'ellipsoid',
        role: 'groundContact',
        center: foot,
        radius: vec3(supportThickness * 1.55, supportThickness * 0.75, supportThickness * 1.72),
      });
    }
  }

  return primitives;
}

export const METABALL_SILHOUETTE_ARMATURE_PROGRAM = Object.freeze({
  id: 'kaminos.lirm-armature-program.metaball-silhouette-authority.v0',
  parameterVocabulary: 'kaminos.lirm-metaball-silhouette.6-low-frequency-parameters.v0',
  parameterSpecs: PARAMETER_SPECS,
  createPrimitives,
});

function createVariant(id, parameterId = null, value = null) {
  const parameters = { ...BASELINE_PARAMETERS };
  if (parameterId) parameters[parameterId] = value;
  return {
    id,
    axis: parameterId
      ? { parameterId, from: BASELINE_PARAMETERS[parameterId], to: value }
      : { parameterId: null, from: null, to: null },
    parameters,
  };
}

export function createMetaballSilhouetteAuthorityTranche() {
  return {
    schema: LIRM_METABALL_SILHOUETTE_AUTHORITY_SCHEMA,
    baselineId: 'baseline',
    armatureProgram: METABALL_SILHOUETTE_ARMATURE_PROGRAM,
    variants: [
      createVariant('baseline'),
      ...PERTURBATIONS.map(item => createVariant(item.id, item.parameterId, item.value)),
    ],
    fixedGenerator: {
      requestedRoute: 'gpu-greenroom/mflux_flux2_edit_promptfile_3ref',
      model: 'flux2-klein-9b',
      quantize: 4,
      width: 512,
      height: 512,
      steps: 8,
      guidance: 1,
      seeds: [80401, 80402, 80403],
      prompt: FIXED_PROMPT,
      sourceImageOrder: ['clay', 'depth', 'normal'],
    },
  };
}

export function createMetaballTargetFirstMultiviewTranche() {
  return {
    schema: 'kaminos.lirm-metaball-target-first-multiview.v0',
    status: 'source-contract-frozen',
    armatureProgram: METABALL_SILHOUETTE_ARMATURE_PROGRAM,
    parameters: { ...BASELINE_PARAMETERS },
    views: TARGET_FIRST_MULTIVIEW_VIEWS.map(view => ({ ...view })),
    conditions: TARGET_FIRST_MULTIVIEW_CONDITIONS.map(condition => ({
      ...condition,
      referenceViewIds: [...condition.referenceViewIds],
    })),
    fixedGenerator: {
      requestedRoute: 'gpu-greenroom/mflux_flux2_edit_promptfile_3ref',
      model: 'flux2-klein-9b',
      quantize: 4,
      width: 512,
      height: 512,
      steps: 8,
      guidance: 1,
      seeds: [80401],
      prompt: TARGET_FIRST_MULTIVIEW_PROMPT,
      provisionalCarrierKind: 'clay',
      carrierDisposition: 'pending-projection-sentinel',
      referenceBudget: 3,
    },
    claimCeiling: [
      'Experimental evidence for target-view retention and supplemental-view structural contribution only.',
      'No authenticated Bowplan transfer, general multiview consistency, reconstructed geometry, or production admission claim.',
    ].join(' '),
  };
}

async function sha256(path) {
  const bytes = await readFile(path);
  return {
    path,
    byteSize: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

export async function writeMetaballSilhouetteAuthoritySources({
  outDir = join(process.cwd(), 'artifacts', 'lirm-metaball-silhouette-authority-v0'),
  pixelWidth = 256,
  pixelHeight = 192,
} = {}) {
  const tranche = createMetaballSilhouetteAuthorityTranche();
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'prompt.txt'), `${tranche.fixedGenerator.prompt}\n`);

  const rows = [];
  for (const variant of tranche.variants) {
    const variantOutDir = join(outDir, 'controls', variant.id);
    const result = await writeLirmArmatureProgramImplicitBodyWitness({
      outDir: variantOutDir,
      armatureProgram: tranche.armatureProgram,
      parameters: variant.parameters,
      candidateId: variant.id,
      pixelWidth,
      pixelHeight,
    });
    const sourceRoot = join(variantOutDir, variant.id);
    const sourceImages = {};
    for (const kind of tranche.fixedGenerator.sourceImageOrder) {
      const path = join(sourceRoot, `${kind}-implicit.png`);
      sourceImages[kind] = {
        ...(await sha256(path)),
        relativePath: relative(outDir, path),
      };
    }
    const trellisPath = join(sourceRoot, 'trellis-source.png');
    rows.push({
      id: variant.id,
      axis: variant.axis,
      parameters: variant.parameters,
      witnessReceiptPath: relative(outDir, result.receiptPath),
      sourceImages,
      trellisSource: {
        ...(await sha256(trellisPath)),
        relativePath: relative(outDir, trellisPath),
      },
    });
  }

  const manifest = {
    schema: tranche.schema,
    status: 'sources-complete',
    baselineId: tranche.baselineId,
    armatureProgram: {
      id: tranche.armatureProgram.id,
      parameterVocabulary: tranche.armatureProgram.parameterVocabulary,
      parameterSpecs: tranche.armatureProgram.parameterSpecs,
    },
    effectiveConfig: { pixelWidth, pixelHeight, projection: 'orthographic' },
    fixedGenerator: tranche.fixedGenerator,
    rows,
  };
  const manifestPath = join(outDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath, manifest };
}

export async function writeMetaballTargetFirstMultiviewSources({
  outDir = join(process.cwd(), 'artifacts', 'lirm-metaball-target-first-multiview-v0'),
  pixelWidth = 256,
  pixelHeight = 192,
} = {}) {
  const tranche = createMetaballTargetFirstMultiviewTranche();
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'prompt.txt'), `${tranche.fixedGenerator.prompt}\n`);

  const views = [];
  for (const view of tranche.views) {
    const viewOutDir = join(outDir, 'views', view.id);
    const result = await writeLirmArmatureProgramImplicitBodyWitness({
      outDir: viewOutDir,
      armatureProgram: tranche.armatureProgram,
      parameters: tranche.parameters,
      candidateId: view.id,
      pixelWidth,
      pixelHeight,
      cameraYawRadians: view.cameraYawRadians,
    });
    const sourceRoot = join(viewOutDir, view.id);
    const sourceImages = {};
    for (const kind of ['clay', 'depth', 'normal']) {
      const path = join(sourceRoot, `${kind}-implicit.png`);
      sourceImages[kind] = {
        ...(await sha256(path)),
        relativePath: relative(outDir, path),
      };
    }
    views.push({
      ...view,
      witnessReceiptPath: relative(outDir, result.receiptPath),
      sourceImages,
    });
  }

  const manifest = {
    schema: tranche.schema,
    status: 'sources-complete',
    armatureProgram: {
      id: tranche.armatureProgram.id,
      parameterVocabulary: tranche.armatureProgram.parameterVocabulary,
    },
    parameters: tranche.parameters,
    effectiveConfig: {
      pixelWidth,
      pixelHeight,
      projection: 'orthographic',
      cameraControl: 'explicit-yaw-radians',
    },
    views,
    conditions: tranche.conditions,
    fixedGenerator: tranche.fixedGenerator,
    claimCeiling: tranche.claimCeiling,
  };
  const manifestPath = join(outDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath, manifest };
}
