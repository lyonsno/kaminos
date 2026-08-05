import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

import {
  LIRM_ARMATURE_PROGRAM_FIXED_PROJECTION_ENVELOPE,
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

function referenceIndexPhrase(indices) {
  if (indices.length === 3) return 'All three reference images repeat';
  if (indices.length === 1) return `Reference image ${indices[0]} is`;
  return `Reference images ${indices.slice(0, -1).join(', ')} and ${indices.at(-1)} are repeated`;
}

function createTargetFirstMultiviewPrompt(authoritativeReferenceIndices) {
  const authority = referenceIndexPhrase(authoritativeReferenceIndices);
  return [
    'Every supplied reference image shows the same authored organism from a different camera unless explicitly described as a repeated view.',
    `${authority} the authoritative target view: preserve that view's exact camera, outer silhouette, body proportions, support placement, and major mass distribution.`,
    'Use every other reference image only to resolve occluded three-dimensional structure belonging to that same organism.',
    'Complete one healthy, aesthetically pleasing living quadruped with coherent anatomical transitions, surface structure, material, and gentle character within the authoritative target-view outline.',
  ].join(' ');
}

const TARGET_FIRST_MULTIVIEW_VIEWS = Object.freeze([
  Object.freeze({ id: 'target-three-quarter', role: 'authoritative-target', cameraYawRadians: 0.42 }),
  Object.freeze({ id: 'front', role: 'supplemental-structure', cameraYawRadians: 0 }),
  Object.freeze({ id: 'side', role: 'supplemental-structure', cameraYawRadians: 1.3 }),
  Object.freeze({ id: 'rear-three-quarter', role: 'supplemental-structure', cameraYawRadians: 2.2 }),
]);

const TARGET_FIRST_MULTIVIEW_CONDITIONS = Object.freeze([
  Object.freeze({
    id: 'target-all-slots',
    distinctViewCount: 1,
    referenceViewIds: Object.freeze([
      'target-three-quarter',
      'target-three-quarter',
      'target-three-quarter',
    ]),
    authoritativeReferenceIndices: Object.freeze([1, 2, 3]),
    probeAxis: 'repeated-target-baseline',
  }),
  Object.freeze({
    id: 'side-last',
    distinctViewCount: 2,
    referenceViewIds: Object.freeze([
      'target-three-quarter',
      'target-three-quarter',
      'side',
    ]),
    authoritativeReferenceIndices: Object.freeze([1, 2]),
    probeAxis: 'supplemental-reference-position',
  }),
  Object.freeze({
    id: 'side-middle',
    distinctViewCount: 2,
    referenceViewIds: Object.freeze([
      'target-three-quarter',
      'side',
      'target-three-quarter',
    ]),
    authoritativeReferenceIndices: Object.freeze([1, 3]),
    probeAxis: 'supplemental-reference-position',
  }),
  Object.freeze({
    id: 'side-first',
    distinctViewCount: 2,
    referenceViewIds: Object.freeze([
      'side',
      'target-three-quarter',
      'target-three-quarter',
    ]),
    authoritativeReferenceIndices: Object.freeze([2, 3]),
    probeAxis: 'supplemental-reference-position',
  }),
  Object.freeze({
    id: 'front-target-rear',
    distinctViewCount: 3,
    referenceViewIds: Object.freeze([
      'front',
      'target-three-quarter',
      'rear-three-quarter',
    ]),
    authoritativeReferenceIndices: Object.freeze([2]),
    probeAxis: 'three-view-completion',
  }),
]);

const REFERENCE_CARDINALITY_CONDITIONS = Object.freeze([
  Object.freeze({
    id: 'target-one',
    referenceViewIds: Object.freeze(['target-three-quarter']),
    authoritativeReferenceIndices: Object.freeze([1]),
    requestedRoute: 'gpu-greenroom/mflux_flux2_edit_promptfile',
    probeAxis: 'reference-cardinality',
  }),
  Object.freeze({
    id: 'target-double',
    referenceViewIds: Object.freeze(['target-three-quarter', 'target-three-quarter']),
    authoritativeReferenceIndices: Object.freeze([1, 2]),
    requestedRoute: 'gpu-greenroom/mflux_flux2_edit_promptfile_2ref',
    probeAxis: 'reference-cardinality',
  }),
  Object.freeze({
    id: 'target-side',
    referenceViewIds: Object.freeze(['target-three-quarter', 'side']),
    authoritativeReferenceIndices: Object.freeze([1]),
    requestedRoute: 'gpu-greenroom/mflux_flux2_edit_promptfile_2ref',
    probeAxis: 'two-reference-order',
  }),
  Object.freeze({
    id: 'side-target',
    referenceViewIds: Object.freeze(['side', 'target-three-quarter']),
    authoritativeReferenceIndices: Object.freeze([2]),
    requestedRoute: 'gpu-greenroom/mflux_flux2_edit_promptfile_2ref',
    probeAxis: 'two-reference-order',
  }),
  Object.freeze({
    id: 'target-triple-control',
    referenceViewIds: Object.freeze([
      'target-three-quarter',
      'target-three-quarter',
      'target-three-quarter',
    ]),
    authoritativeReferenceIndices: Object.freeze([1, 2, 3]),
    requestedRoute: 'gpu-greenroom/mflux_flux2_edit_promptfile_3ref',
    probeAxis: 'reference-cardinality',
    reuseConditionId: 'target-all-slots',
  }),
]);

const MULTIVIEW_TOPOLOGY_CONDITIONS = Object.freeze([
  Object.freeze({ id: 'depth-control', referenceKinds: Object.freeze(['depth', 'depth', 'depth']), reuseConditionId: 'side-middle' }),
  Object.freeze({ id: 'clay-target', referenceKinds: Object.freeze(['clay', 'depth', 'depth']) }),
  Object.freeze({ id: 'normal-target', referenceKinds: Object.freeze(['normal', 'depth', 'depth']) }),
  Object.freeze({ id: 'clay-normal-target', referenceKinds: Object.freeze(['clay', 'depth', 'normal']) }),
]);

const CONTOUR_EMBELLISHMENT_CONDITIONS = Object.freeze([
  Object.freeze({
    id: 'restrained-completion',
    prompt: [
      'Every supplied reference image shows the same authored organism from a different camera, with references 1 and 3 repeating the target view.',
      'Preserve the target camera, outer silhouette, body proportions, support count and placement, and major mass distribution.',
      'Complete one healthy, aesthetically pleasing living quadruped using coherent skin, restrained material variation, gentle facial cues, and smooth anatomical transitions contained within the authored outline.',
    ].join(' '),
  }),
  Object.freeze({
    id: 'organismal-elaboration',
    prompt: [
      'Every supplied reference image shows the same authored organism from a different camera, with references 1 and 3 repeating the target view.',
      'Preserve the target camera, outer silhouette, body proportions, support count and placement, and major mass distribution.',
      'Complete one healthy, aesthetically pleasing living quadruped with legible joints and attachment transitions, a coherent friendly face, weight-bearing support anatomy, regional skin or fur structure, and material differentiation contained within the authored outline.',
    ].join(' '),
  }),
  Object.freeze({
    id: 'maximum-contour-bound-invention',
    prompt: [
      'Every supplied reference image shows the same authored organism from a different camera, with references 1 and 3 repeating the target view.',
      'Preserve the target camera, outer silhouette, body proportions, support count and placement, and major mass distribution.',
      'Complete one healthy, aesthetically pleasing living quadruped with rich species-specific anatomy, an expressive friendly face, articulated support transitions, strongly resolved skin or fur and materials, and abundant coherent regional detail contained within the authored outline.',
    ].join(' '),
  }),
]);

const FIXED_LINEAGE_PROPORTION_VARIANTS = Object.freeze([
  Object.freeze({ id: 'axial-short', parameterId: 'bodyLength', value: 0.78 }),
  Object.freeze({ id: 'baseline', parameterId: null, value: null }),
  Object.freeze({ id: 'axial-long', parameterId: 'bodyLength', value: 1.35 }),
  Object.freeze({ id: 'body-shallow', parameterId: 'bodyDepth', value: 0.26 }),
  Object.freeze({ id: 'body-deep', parameterId: 'bodyDepth', value: 0.56 }),
  Object.freeze({ id: 'supports-short', parameterId: 'supportLength', value: 0.23 }),
  Object.freeze({ id: 'supports-long', parameterId: 'supportLength', value: 0.57 }),
]);

const FIXED_LINEAGE_PROPORTION_VIEWS = Object.freeze([
  Object.freeze({ id: 'target-three-quarter', cameraYawRadians: 0.42 }),
  Object.freeze({ id: 'side', cameraYawRadians: 1.3 }),
]);

function createReferenceCardinalityPrompt(condition) {
  let authority;
  if (condition.referenceViewIds.length === 1) {
    authority = 'The supplied reference image is the authoritative target view.';
  } else if (condition.authoritativeReferenceIndices.length === condition.referenceViewIds.length) {
    authority = 'All supplied reference images repeat the authoritative target view.';
  } else {
    const targetIndex = condition.authoritativeReferenceIndices[0];
    const supplementalIndices = condition.referenceViewIds
      .map((_, index) => index + 1)
      .filter(index => index !== targetIndex);
    authority = [
      `Reference image ${targetIndex} is the authoritative target view.`,
      `Use reference ${supplementalIndices.join(' and ')} only to resolve occluded structure belonging to that same organism.`,
    ].join(' ');
  }
  return [
    'Every supplied reference image shows the same authored organism; repeated images are deliberate controls.',
    authority,
    'Preserve the authoritative target camera, outer silhouette, body proportions, support placement, and major mass distribution.',
    'Complete one healthy, aesthetically pleasing living quadruped with coherent anatomical transitions, surface structure, material, and gentle character within the authoritative target-view outline.',
  ].join(' ');
}

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
      authoritativeReferenceIndices: [...condition.authoritativeReferenceIndices],
      prompt: createTargetFirstMultiviewPrompt(condition.authoritativeReferenceIndices),
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
      provisionalCarrierKind: 'depth',
      carrierDisposition: 'projection-sentinel-depth-selected',
      referenceBudget: 3,
    },
    claimCeiling: [
      'Experimental evidence for target-view retention and supplemental-view structural contribution only.',
      'No authenticated Bowplan transfer, general multiview consistency, reconstructed geometry, or production admission claim.',
    ].join(' '),
  };
}

export function createMetaballReferenceCardinalityTranche() {
  return {
    schema: 'kaminos.lirm-metaball-reference-cardinality.v0',
    status: 'source-contract-frozen',
    conditions: REFERENCE_CARDINALITY_CONDITIONS.map(condition => ({
      ...condition,
      referenceViewIds: [...condition.referenceViewIds],
      authoritativeReferenceIndices: [...condition.authoritativeReferenceIndices],
      prompt: createReferenceCardinalityPrompt(condition),
    })),
    fixedGenerator: {
      model: 'flux2-klein-9b',
      quantize: 4,
      width: 512,
      height: 512,
      steps: 8,
      guidance: 1,
      seeds: [80401],
      provisionalCarrierKind: 'depth',
      carrierDisposition: 'projection-sentinel-depth-selected',
    },
    claimCeiling: [
      'Experimental evidence for reference-cardinality and two-reference-order effects on one square depth Bowplan source.',
      'No exact target-projection preservation, semantic reference obedience, multiview geometric consistency, or reconstructed volume claim.',
    ].join(' '),
  };
}

export function createMetaballMultiviewTopologyTranche() {
  return {
    schema: 'kaminos.lirm-metaball-multiview-topology.v0',
    status: 'source-contract-frozen',
    conditions: MULTIVIEW_TOPOLOGY_CONDITIONS.map(condition => ({
      ...condition,
      referenceKinds: [...condition.referenceKinds],
      referenceViewIds: ['target-three-quarter', 'side', 'target-three-quarter'],
      authoritativeReferenceIndices: [1, 3],
      promptSourceConditionId: 'side-middle',
      requestedRoute: 'gpu-greenroom/mflux_flux2_edit_promptfile_3ref',
    })),
    fixedGenerator: {
      model: 'flux2-klein-9b',
      quantize: 4,
      width: 512,
      height: 512,
      steps: 8,
      guidance: 1,
      seeds: [80401],
    },
    claimCeiling: [
      'Experimental evidence for target-channel modality effects under one fixed target/side/target view topology.',
      'No general modality ranking, exact target projection, multiview geometric consistency, or reconstructed-volume claim.',
    ].join(' '),
  };
}

export function createMetaballContourEmbellishmentTranche() {
  return {
    schema: 'kaminos.lirm-metaball-contour-embellishment.v0',
    status: 'source-contract-frozen',
    conditions: CONTOUR_EMBELLISHMENT_CONDITIONS.map(condition => ({
      ...condition,
      referenceKinds: ['depth', 'depth', 'depth'],
      referenceViewIds: ['target-three-quarter', 'side', 'target-three-quarter'],
      authoritativeReferenceIndices: [1, 3],
      requestedRoute: 'gpu-greenroom/mflux_flux2_edit_promptfile_3ref',
    })),
    fixedGenerator: {
      model: 'flux2-klein-9b',
      quantize: 4,
      width: 512,
      height: 512,
      steps: 8,
      guidance: 1,
      seeds: [80411, 80412, 80413],
    },
    claimCeiling: [
      'Experimental evidence for prompt-conditioned elaboration under one fixed all-depth target/side/target Bowplan carrier.',
      'No exact contour preservation, directional anatomy, multiview geometric consistency, reconstructed-volume, or production-admission claim.',
    ].join(' '),
  };
}

export function createMetaballFixedLineageProportionTranche() {
  const lineageAnchor = CONTOUR_EMBELLISHMENT_CONDITIONS.find(
    condition => condition.id === 'maximum-contour-bound-invention',
  );
  if (!lineageAnchor) throw new Error('missing fixed-lineage prompt anchor');
  return {
    schema: 'kaminos.lirm-metaball-fixed-lineage-proportion.v0',
    status: 'source-contract-frozen',
    lineageAnchor: {
      conditionId: lineageAnchor.id,
      seed: 80413,
      sourceArtifact: 'artifacts/lirm-metaball-contour-embellishment-v0',
      outputPath: 'artifacts/lirm-metaball-contour-embellishment-v0/generated/maximum-contour-bound-invention/seed-80413/output.png',
      receiptPath: 'artifacts/lirm-metaball-contour-embellishment-v0/receipts/maximum-contour-bound-invention-seed-80413.json',
    },
    armatureProgram: METABALL_SILHOUETTE_ARMATURE_PROGRAM,
    variants: FIXED_LINEAGE_PROPORTION_VARIANTS.map(item => (
      item.parameterId
        ? createVariant(item.id, item.parameterId, item.value)
        : createVariant(item.id)
    )),
    views: FIXED_LINEAGE_PROPORTION_VIEWS.map(view => ({ ...view })),
    referenceViewIds: ['target-three-quarter', 'side', 'target-three-quarter'],
    referenceKinds: ['depth', 'depth', 'depth'],
    fixedGenerator: {
      requestedRoute: 'gpu-greenroom/mflux_flux2_edit_promptfile_3ref',
      model: 'flux2-klein-9b',
      quantize: 4,
      width: 512,
      height: 512,
      steps: 8,
      guidance: 1,
      seeds: [80413],
      prompt: lineageAnchor.prompt,
    },
    claimCeiling: [
      'Experimental evidence for continuity of one matched generator basin and directional inheritance of three low-frequency bauplan axes.',
      'No general morphology controllability, exact silhouette preservation, multiview geometric consistency, reconstructed volume, or production-admission claim.',
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

export async function writeMetaballFixedLineageProportionSources({
  outDir = join(process.cwd(), 'artifacts', 'lirm-metaball-fixed-lineage-proportion-v0'),
  pixelWidth = 256,
  pixelHeight = 256,
} = {}) {
  const tranche = createMetaballFixedLineageProportionTranche();
  await mkdir(outDir, { recursive: true });
  const promptPath = join(outDir, 'prompt.txt');
  await writeFile(promptPath, `${tranche.fixedGenerator.prompt}\n`);
  const promptIdentity = await sha256(promptPath);
  const rows = [];

  for (const variant of tranche.variants) {
    const views = [];
    const byViewId = new Map();
    for (const view of tranche.views) {
      const candidateId = `${variant.id}-${view.id}`;
      const viewOutDir = join(outDir, 'variants', variant.id, 'views', view.id);
      const result = await writeLirmArmatureProgramImplicitBodyWitness({
        outDir: viewOutDir,
        armatureProgram: tranche.armatureProgram,
        parameters: variant.parameters,
        candidateId,
        pixelWidth,
        pixelHeight,
        cameraYawRadians: view.cameraYawRadians,
      });
      const sourcePath = join(viewOutDir, candidateId, 'depth-implicit.png');
      const sourceImage = {
        kind: 'depth',
        ...(await sha256(sourcePath)),
        relativePath: relative(outDir, sourcePath),
      };
      const persistedView = {
        ...view,
        witnessReceiptPath: relative(outDir, result.receiptPath),
        sourceImage,
      };
      views.push(persistedView);
      byViewId.set(view.id, persistedView);
    }

    const references = tranche.referenceViewIds.map((viewId, index) => {
      const source = byViewId.get(viewId)?.sourceImage;
      if (!source) throw new Error(`missing ${viewId} depth source for ${variant.id}`);
      return {
        slot: index + 1,
        viewId,
        kind: tranche.referenceKinds[index],
        path: relative(process.cwd(), join(outDir, source.relativePath)),
        sha256: source.sha256,
      };
    });
    rows.push({
      id: variant.id,
      axis: variant.axis,
      parameters: variant.parameters,
      views,
      references,
    });
  }

  const manifest = {
    schema: tranche.schema,
    status: 'sources-complete',
    lineageAnchor: tranche.lineageAnchor,
    armatureProgram: {
      id: tranche.armatureProgram.id,
      parameterVocabulary: tranche.armatureProgram.parameterVocabulary,
    },
    effectiveConfig: {
      pixelWidth,
      pixelHeight,
      projection: 'orthographic',
      fixedProjectionEnvelope: { ...LIRM_ARMATURE_PROGRAM_FIXED_PROJECTION_ENVELOPE },
      sourceRasterPolicy: 'historical-fixed-display-raster',
    },
    promptPath: relative(outDir, promptPath),
    promptSha256: promptIdentity.sha256,
    rows,
    fixedGenerator: tranche.fixedGenerator,
    claimCeiling: tranche.claimCeiling,
  };
  const manifestPath = join(outDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath, manifest };
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
  pixelHeight = 256,
} = {}) {
  if (pixelWidth !== pixelHeight) {
    throw new Error(
      `target-first multiview requires generator-native square source rasters; received ${pixelWidth}x${pixelHeight}`,
    );
  }
  const tranche = createMetaballTargetFirstMultiviewTranche();
  await mkdir(outDir, { recursive: true });
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

  const promptDir = join(outDir, 'prompts');
  await mkdir(promptDir, { recursive: true });
  const conditions = [];
  for (const condition of tranche.conditions) {
    const promptPath = join(promptDir, `${condition.id}.txt`);
    await writeFile(promptPath, `${condition.prompt}\n`);
    const promptIdentity = await sha256(promptPath);
    conditions.push({
      ...condition,
      promptPath: relative(outDir, promptPath),
      promptSha256: promptIdentity.sha256,
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
      sourceRasterPolicy: 'generator-native-square',
      downstreamResize: `${tranche.fixedGenerator.width}x${tranche.fixedGenerator.height}`,
    },
    views,
    conditions,
    fixedGenerator: tranche.fixedGenerator,
    claimCeiling: tranche.claimCeiling,
  };
  const manifestPath = join(outDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath, manifest };
}

export async function writeMetaballReferenceCardinalitySources({
  outDir = join(process.cwd(), 'artifacts', 'lirm-metaball-reference-cardinality-v0'),
  sourceArtifactRoot = join(
    process.cwd(),
    'artifacts',
    'lirm-metaball-target-first-multiview-v0',
  ),
} = {}) {
  const tranche = createMetaballReferenceCardinalityTranche();
  const sourceManifest = JSON.parse(await readFile(join(sourceArtifactRoot, 'manifest.json'), 'utf8'));
  const sourceJobs = JSON.parse(await readFile(join(sourceArtifactRoot, 'greenroom-jobs.json'), 'utf8'));
  const viewsById = new Map(sourceManifest.views.map(view => [view.id, view]));
  const jobsByCondition = new Map(sourceJobs.jobs.map(job => [job.conditionId, job]));
  await mkdir(outDir, { recursive: true });
  const promptDir = join(outDir, 'prompts');
  await mkdir(promptDir, { recursive: true });

  const conditions = [];
  for (const condition of tranche.conditions) {
    const promptPath = join(promptDir, `${condition.id}.txt`);
    await writeFile(promptPath, `${condition.prompt}\n`);
    const promptIdentity = await sha256(promptPath);
    const references = condition.referenceViewIds.map(viewId => {
      const source = viewsById.get(viewId)?.sourceImages?.depth;
      if (!source?.relativePath || !source?.sha256) {
        throw new Error(`missing square depth source for view ${viewId}`);
      }
      return {
        viewId,
        path: relative(process.cwd(), join(sourceArtifactRoot, source.relativePath)),
        sha256: source.sha256,
      };
    });
    const persisted = {
      ...condition,
      references,
      promptPath: relative(outDir, promptPath),
      promptSha256: promptIdentity.sha256,
    };
    if (condition.reuseConditionId) {
      const reused = jobsByCondition.get(condition.reuseConditionId);
      if (!reused?.jobId) {
        throw new Error(`missing reusable job for ${condition.reuseConditionId}`);
      }
      persisted.reuseJobId = reused.jobId;
      persisted.reuseOutputPath = relative(
        process.cwd(),
        join(sourceArtifactRoot, 'generated', condition.reuseConditionId, 'seed-80401', 'output.png'),
      );
      persisted.reuseReceiptPath = relative(
        process.cwd(),
        join(sourceArtifactRoot, 'receipts', `${condition.reuseConditionId}.json`),
      );
    }
    conditions.push(persisted);
  }

  const manifest = {
    schema: tranche.schema,
    status: 'sources-complete',
    sourceArtifact: relative(process.cwd(), sourceArtifactRoot),
    sourceSchema: sourceManifest.schema,
    sourceRasterPolicy: sourceManifest.effectiveConfig.sourceRasterPolicy,
    conditions,
    fixedGenerator: tranche.fixedGenerator,
    claimCeiling: tranche.claimCeiling,
  };
  const manifestPath = join(outDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath, manifest };
}

export async function writeMetaballMultiviewTopologySources({
  outDir = join(process.cwd(), 'artifacts', 'lirm-metaball-multiview-topology-v0'),
  sourceArtifactRoot = join(
    process.cwd(),
    'artifacts',
    'lirm-metaball-target-first-multiview-v0',
  ),
} = {}) {
  const tranche = createMetaballMultiviewTopologyTranche();
  const sourceManifest = JSON.parse(await readFile(join(sourceArtifactRoot, 'manifest.json'), 'utf8'));
  const sourceJobs = JSON.parse(await readFile(join(sourceArtifactRoot, 'greenroom-jobs.json'), 'utf8'));
  const viewsById = new Map(sourceManifest.views.map(view => [view.id, view]));
  const jobsByCondition = new Map(sourceJobs.jobs.map(job => [job.conditionId, job]));
  const promptSource = sourceManifest.conditions.find(condition => condition.id === 'side-middle');
  if (!promptSource?.promptPath || !promptSource?.promptSha256) {
    throw new Error('missing frozen side-middle prompt source');
  }
  await mkdir(outDir, { recursive: true });
  const promptDir = join(outDir, 'prompts');
  await mkdir(promptDir, { recursive: true });
  const prompt = await readFile(join(sourceArtifactRoot, promptSource.promptPath), 'utf8');
  const promptPath = join(promptDir, 'target-side-target.txt');
  await writeFile(promptPath, prompt);
  const promptIdentity = await sha256(promptPath);
  if (promptIdentity.sha256 !== promptSource.promptSha256) {
    throw new Error('frozen topology prompt identity changed during copy');
  }

  const conditions = tranche.conditions.map(condition => {
    const references = condition.referenceViewIds.map((viewId, index) => {
      const kind = condition.referenceKinds[index];
      const source = viewsById.get(viewId)?.sourceImages?.[kind];
      if (!source?.relativePath || !source?.sha256) {
        throw new Error(`missing ${kind} source for view ${viewId}`);
      }
      return {
        viewId,
        kind,
        path: relative(process.cwd(), join(sourceArtifactRoot, source.relativePath)),
        sha256: source.sha256,
      };
    });
    const persisted = {
      ...condition,
      references,
      prompt: prompt.trim(),
      promptPath: relative(outDir, promptPath),
      promptSha256: promptIdentity.sha256,
    };
    if (condition.reuseConditionId) {
      const reused = jobsByCondition.get(condition.reuseConditionId);
      if (!reused?.jobId) throw new Error(`missing reusable job for ${condition.reuseConditionId}`);
      persisted.reuseJobId = reused.jobId;
      persisted.reuseOutputPath = relative(
        process.cwd(),
        join(sourceArtifactRoot, 'generated', condition.reuseConditionId, 'seed-80401', 'output.png'),
      );
      persisted.reuseReceiptPath = relative(
        process.cwd(),
        join(sourceArtifactRoot, 'receipts', `${condition.reuseConditionId}.json`),
      );
    }
    return persisted;
  });

  const manifest = {
    schema: tranche.schema,
    status: 'sources-complete',
    sourceArtifact: relative(process.cwd(), sourceArtifactRoot),
    sourceSchema: sourceManifest.schema,
    conditions,
    fixedGenerator: tranche.fixedGenerator,
    claimCeiling: tranche.claimCeiling,
  };
  const manifestPath = join(outDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath, manifest };
}

export async function writeMetaballContourEmbellishmentSources({
  outDir = join(process.cwd(), 'artifacts', 'lirm-metaball-contour-embellishment-v0'),
  sourceArtifactRoot = join(
    process.cwd(),
    'artifacts',
    'lirm-metaball-target-first-multiview-v0',
  ),
} = {}) {
  const tranche = createMetaballContourEmbellishmentTranche();
  const sourceManifest = JSON.parse(await readFile(join(sourceArtifactRoot, 'manifest.json'), 'utf8'));
  const sourceJobs = JSON.parse(await readFile(join(sourceArtifactRoot, 'greenroom-jobs.json'), 'utf8'));
  const viewsById = new Map(sourceManifest.views.map(view => [view.id, view]));
  const baselineJob = sourceJobs.jobs.find(job => job.conditionId === 'side-middle');
  const baselineCondition = sourceManifest.conditions.find(condition => condition.id === 'side-middle');
  if (!baselineJob?.jobId) throw new Error('missing reusable all-depth side-middle baseline job');
  if (!baselineCondition?.prompt || !baselineCondition?.promptSha256) {
    throw new Error('missing reusable all-depth side-middle baseline prompt');
  }

  await mkdir(outDir, { recursive: true });
  const promptDir = join(outDir, 'prompts');
  await mkdir(promptDir, { recursive: true });

  const conditions = [];
  for (const condition of tranche.conditions) {
    const promptPath = join(promptDir, `${condition.id}.txt`);
    await writeFile(promptPath, `${condition.prompt}\n`);
    const promptIdentity = await sha256(promptPath);
    const references = condition.referenceViewIds.map(viewId => {
      const source = viewsById.get(viewId)?.sourceImages?.depth;
      if (!source?.relativePath || !source?.sha256) {
        throw new Error(`missing depth source for view ${viewId}`);
      }
      return {
        viewId,
        kind: 'depth',
        path: relative(process.cwd(), join(sourceArtifactRoot, source.relativePath)),
        sha256: source.sha256,
      };
    });
    conditions.push({
      ...condition,
      references,
      promptPath: relative(outDir, promptPath),
      promptSha256: promptIdentity.sha256,
    });
  }

  const manifest = {
    schema: tranche.schema,
    status: 'sources-complete',
    sourceArtifact: relative(process.cwd(), sourceArtifactRoot),
    sourceSchema: sourceManifest.schema,
    baseline: {
      label: 'prior-all-depth-furred-organismal-completion',
      reuseJobId: baselineJob.jobId,
      seed: 80401,
      references: conditions[0].references,
      prompt: baselineCondition.prompt,
      promptSha256: baselineCondition.promptSha256,
      outputPath: relative(
        process.cwd(),
        join(sourceArtifactRoot, 'generated', 'side-middle', 'seed-80401', 'output.png'),
      ),
      receiptPath: relative(
        process.cwd(),
        join(sourceArtifactRoot, 'receipts', 'side-middle.json'),
      ),
      fixedGenerator: sourceManifest.fixedGenerator,
    },
    conditions,
    fixedGenerator: tranche.fixedGenerator,
    claimCeiling: tranche.claimCeiling,
  };
  const manifestPath = join(outDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath, manifest };
}
