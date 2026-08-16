import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export const PROCEDURAL_GROOM_TRUTH_SCHEMA = 'kaminos.procedural-groom-truth.v0';
export const PROCEDURAL_GROOM_TRUTH_REPORT_SCHEMA = 'kaminos.procedural-groom-truth-report.v0';

const REQUIRED_SYSTEMS = [
  'short-coat-low-puff',
  'short-coat-high-puff',
  'ruff',
  'mystacial-whiskers',
];

const REQUIRED_DOMAINS = [
  'short-coat',
  'ruff',
  'mystacial-pad-left',
  'mystacial-pad-right',
];

const REQUIRED_PRODUCTS = [
  'blend',
  'glb',
  'sparse-truth-render',
  'neutral-dense-render',
  'deformed-dense-render',
];

const SHA256 = /^[0-9a-f]{64}$/;
const DISPLAY_COLOR = /^#[0-9a-f]{6}$/i;

function report(state, failures, lastTrustworthyEvidence = null) {
  return {
    schema: PROCEDURAL_GROOM_TRUTH_REPORT_SCHEMA,
    state,
    visualAdmission: false,
    scientificAdmission: false,
    failures,
    lastTrustworthyEvidence,
  };
}

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function finiteUnitInterval(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function finiteVector(value, size) {
  return Array.isArray(value) && value.length === size && value.every(Number.isFinite);
}

function vectorLength(value) {
  return Math.sqrt(value.reduce((sum, component) => sum + component * component, 0));
}

function validDirection(value) {
  if (!finiteVector(value, 3)) return false;
  const length = vectorLength(value);
  return length > 0.5 && length < 1.5;
}

function invalidGuideReasons(manifest) {
  const failures = [];
  const triangleCount = manifest.carrier.mesh.triangles;
  const systemIds = new Set(manifest.groom.systems.map(system => system.id));
  const guides = manifest.groom.guides;
  const guideIds = new Set();

  for (const [index, guide] of guides.entries()) {
    const label = guide?.id || `guide[${index}]`;
    if (typeof guide?.id !== 'string' || guide.id.length === 0 || guideIds.has(guide.id)) {
      failures.push(`${label}: guide id must be nonempty and unique`);
    }
    guideIds.add(guide?.id);
    if (!systemIds.has(guide?.systemId)) failures.push(`${label}: unknown systemId ${guide?.systemId}`);

    const triangleIndex = guide?.root?.triangleIndex;
    const barycentric = guide?.root?.barycentric;
    if (!Number.isInteger(triangleIndex) || triangleIndex < 0 || triangleIndex >= triangleCount) {
      failures.push(`${label}: root triangle index is outside the carrier triangle range`);
    }
    if (!finiteVector(barycentric, 3)
      || barycentric.some(component => component < 0 || component > 1)
      || Math.abs(barycentric.reduce((sum, component) => sum + component, 0) - 1) > 1e-6) {
      failures.push(`${label}: root barycentric coordinates must be finite, bounded, and sum to one`);
    }
    const neutralRoot = guide?.root?.neutralPosition;
    const deformedRoot = guide?.root?.deformedPosition;
    if (!finiteVector(neutralRoot, 3) || !finiteVector(deformedRoot, 3)) {
      failures.push(`${label}: root requires explicit finite neutral and deformed positions`);
    } else {
      const displacement = Math.sqrt(neutralRoot.reduce((sum, component, axis) => {
        const delta = component - deformedRoot[axis];
        return sum + delta * delta;
      }, 0));
      if (displacement <= 1e-6) failures.push(`${label}: deformed root does not witness carrier transport`);
    }

    for (const key of ['normal', 'tangent', 'bitangent']) {
      if (!validDirection(guide?.frame?.[key])) failures.push(`${label}: ${key} must be a finite nonzero direction`);
    }
    if (!validDirection(guide?.flow)) failures.push(`${label}: flow must be a finite nonzero direction`);
    if (!finitePositive(guide?.length)) failures.push(`${label}: length must be positive and finite`);
    if (!finitePositive(guide?.density)) failures.push(`${label}: density must be positive and finite`);
    if (!finiteUnitInterval(guide?.lift)) failures.push(`${label}: lift must be in [0, 1]`);
    if (!finiteUnitInterval(guide?.stiffness)) failures.push(`${label}: stiffness must be in [0, 1]`);
    if (!finiteUnitInterval(guide?.confidence)) failures.push(`${label}: confidence must be in [0, 1]`);
    if (!['low', 'high'].includes(guide?.puff) && guide?.systemId?.startsWith('short-coat')) {
      failures.push(`${label}: short-coat guide must name low or high puff`);
    }
    if (guide?.provenance !== 'procedural-authored-truth') {
      failures.push(`${label}: guide provenance must remain procedural-authored-truth`);
    }
    if (!Array.isArray(guide?.points) || guide.points.length < 2
      || guide.points.some(point => !finiteVector(point, 3))) {
      failures.push(`${label}: points must contain at least two finite 3D samples`);
    }
  }

  for (const system of manifest.groom.systems) {
    if (!Array.isArray(system.guideIds) || system.guideIds.length === 0) {
      failures.push(`${system.id}: system must name at least one guide`);
      continue;
    }
    for (const guideId of system.guideIds) {
      const guide = guides.find(candidate => candidate.id === guideId);
      if (!guide) failures.push(`${system.id}: missing guide ${guideId}`);
      else if (guide.systemId !== system.id) failures.push(`${guideId}: guide/system membership mismatch`);
    }
  }
  return failures;
}

export function evaluateProceduralGroomTruth(manifest) {
  if (!manifest || manifest.schema !== PROCEDURAL_GROOM_TRUTH_SCHEMA) {
    return report('invalid_schema', [`expected schema ${PROCEDURAL_GROOM_TRUTH_SCHEMA}`]);
  }

  if (manifest.visualAdmission !== false || manifest.scientificAdmission !== false) {
    return report('invalid_admission_claim', [
      'procedural fixture cannot grant itself visual or scientific admission',
    ]);
  }

  const mesh = manifest.carrier?.mesh;
  const carrierFailures = [];
  if (!mesh || !Number.isInteger(mesh.vertices) || mesh.vertices < 4) carrierFailures.push('carrier requires at least four vertices');
  if (!mesh || !Number.isInteger(mesh.triangles) || mesh.triangles < 4) carrierFailures.push('carrier requires at least four triangles');
  if (mesh?.connectedComponents !== 1) carrierFailures.push('carrier must have exactly one connected component');
  if (!finitePositive(mesh?.byteLength)) carrierFailures.push('carrier mesh product must be nonblank');
  if (!SHA256.test(mesh?.sha256 ?? '')) carrierFailures.push('carrier mesh requires a sha256 digest');
  if (carrierFailures.length) return report('invalid_carrier', carrierFailures);

  const domainIds = new Set((manifest.carrier?.semanticDomains ?? []).map(domain => domain.id));
  const missingDomains = REQUIRED_DOMAINS.filter(id => !domainIds.has(id));
  if (missingDomains.length) {
    return report('incomplete_semantic_domains', missingDomains.map(id => `missing semantic domain ${id}`));
  }

  const systems = manifest.groom?.systems;
  const guides = manifest.groom?.guides;
  if (!Array.isArray(systems) || !Array.isArray(guides)) {
    return report('incomplete_groom_systems', ['groom systems and guides must be arrays']);
  }
  const systemIds = new Set(systems.map(system => system.id));
  const missingSystems = REQUIRED_SYSTEMS.filter(id => !systemIds.has(id));
  if (missingSystems.length) {
    return report('incomplete_groom_systems', missingSystems.map(id => `missing groom system ${id}`));
  }

  const presentationFailures = [];
  const displayColors = new Set();
  for (const system of systems) {
    if (!DISPLAY_COLOR.test(system.displayColor ?? '')) {
      presentationFailures.push(`${system.id}: membership displayColor must be a six-digit hex color`);
    } else if (displayColors.has(system.displayColor.toLowerCase())) {
      presentationFailures.push(`${system.id}: every canonical guide family requires a distinct membership color`);
    }
    displayColors.add(system.displayColor?.toLowerCase());
  }
  if (presentationFailures.length) {
    return report('invalid_groom_presentation', presentationFailures);
  }

  const whiskers = manifest.groom.whiskerPreset;
  const semanticFailures = [];
  if (whiskers?.detectionTarget !== 'whisker-presence') {
    semanticFailures.push('whisker preset detection target must be whisker-presence');
  }
  if (whiskers?.segmentationTarget !== 'mystacial-pad') {
    semanticFailures.push('whisker preset segmentation target must be mystacial-pad, never individual strands');
  }
  if (whiskers?.bilateral !== true) semanticFailures.push('mystacial whisker preset must be bilateral');
  if (!Number.isInteger(whiskers?.countPerSide) || whiskers.countPerSide < 2) semanticFailures.push('whisker countPerSide must be an integer >= 2');
  for (const key of ['lengthToMuzzleWidth', 'angularFanDegrees']) {
    if (!finitePositive(whiskers?.[key])) semanticFailures.push(`whisker ${key} must be positive and finite`);
  }
  for (const key of ['sag', 'taper', 'stiffness', 'sparseness', 'confidence']) {
    if (!finiteUnitInterval(whiskers?.[key])) semanticFailures.push(`whisker ${key} must be in [0, 1]`);
  }
  if (!Number.isFinite(whiskers?.elevationDegrees)) semanticFailures.push('whisker elevationDegrees must be finite');
  if (semanticFailures.length) return report('invalid_semantic_contract', semanticFailures);

  const guideFailures = invalidGuideReasons(manifest);
  if (guideFailures.length) return report('invalid_guide_geometry', guideFailures);

  const deformation = manifest.deformation;
  const deformationFailures = [];
  if (deformation?.method !== 'carrier-bound-bend-v0') deformationFailures.push('unsupported deformation method');
  if (!Number.isInteger(deformation?.neutralFrame) || !Number.isInteger(deformation?.deformedFrame)
    || deformation.neutralFrame === deformation.deformedFrame) {
    deformationFailures.push('deformation requires distinct integer neutral and deformed frames');
  }
  if (deformation?.transportedGuideCount !== guides.length) {
    deformationFailures.push('every canonical guide must be transported by deformation');
  }
  if (deformationFailures.length) return report('invalid_deformation', deformationFailures);

  if (manifest.source?.kind !== 'procedural-authored-truth'
    || !SHA256.test(manifest.source?.generatorSha256 ?? '')
    || typeof manifest.source?.generatorPath !== 'string') {
    return report('invalid_source', ['generator identity and digest must be bound as procedural-authored-truth']);
  }
  if (!manifest.source.requestedRoute || manifest.source.requestedRoute !== manifest.source.effectiveRoute) {
    return report('invalid_route', ['requested and effective authoring route must match']);
  }

  const products = Array.isArray(manifest.products) ? manifest.products : [];
  const productFailures = [];
  const kinds = new Set(products.map(product => product.kind));
  for (const kind of REQUIRED_PRODUCTS) {
    if (!kinds.has(kind)) productFailures.push(`missing product ${kind}`);
  }
  for (const product of products) {
    if (typeof product.path !== 'string' || product.path.length === 0) productFailures.push(`${product.kind}: missing path`);
    if (!SHA256.test(product.sha256 ?? '')) productFailures.push(`${product.kind}: missing sha256`);
    if (!finitePositive(product.byteLength)) productFailures.push(`${product.kind}: product is blank`);
  }
  if (productFailures.length) return report('invalid_products', productFailures);

  return report(
    'representation_ready_for_visual_review',
    [],
    'digest_bound_procedural_representation',
  );
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function resolveContained(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, candidate);
  const relation = relative(resolvedRoot, resolvedPath);
  const separator = process.platform === 'win32' ? '\\' : '/';
  if (isAbsolute(relation) || relation === '..' || relation.startsWith(`..${separator}`)) {
    throw new Error(`path escapes evidence root: ${candidate}`);
  }
  return resolvedPath;
}

async function verifyFile({ label, path, declaredSha256, declaredByteLength, failures }) {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) {
      failures.push(`${label}: artifact is not a regular file`);
      return;
    }
    if (metadata.size <= 0) failures.push(`${label}: artifact is blank`);
    if (metadata.size !== declaredByteLength) {
      failures.push(`${label}: byte length mismatch (declared ${declaredByteLength}, observed ${metadata.size})`);
    }
    const observedSha256 = sha256(await readFile(path));
    if (observedSha256 !== declaredSha256) {
      failures.push(`${label}: digest mismatch (declared ${declaredSha256}, observed ${observedSha256})`);
    }
  } catch (error) {
    failures.push(`${label}: artifact unavailable (${error.code ?? error.message})`);
  }
}

export async function runProceduralGroomTruthPreflight({
  manifest,
  manifestDirectory,
  repoRoot,
  reportPath,
}) {
  const declared = evaluateProceduralGroomTruth(manifest);
  if (declared.state !== 'representation_ready_for_visual_review') {
    await writeFile(reportPath, `${JSON.stringify(declared, null, 2)}\n`);
    return declared;
  }

  const failures = [];
  try {
    const generatorPath = resolveContained(repoRoot, manifest.source.generatorPath);
    const generatorMetadata = await stat(generatorPath);
    await verifyFile({
      label: 'generator',
      path: generatorPath,
      declaredSha256: manifest.source.generatorSha256,
      declaredByteLength: generatorMetadata.size,
      failures,
    });
  } catch (error) {
    failures.push(`generator: ${error.message}`);
  }

  for (const item of manifest.products) {
    try {
      const artifactPath = resolveContained(manifestDirectory, item.path);
      await verifyFile({
        label: item.kind,
        path: artifactPath,
        declaredSha256: item.sha256,
        declaredByteLength: item.byteLength,
        failures,
      });
    } catch (error) {
      failures.push(`${item.kind}: ${error.message}`);
    }
  }

  const glb = manifest.products.find(item => item.kind === 'glb');
  if (!glb
    || manifest.carrier.mesh.path !== glb.path
    || manifest.carrier.mesh.sha256 !== glb.sha256
    || manifest.carrier.mesh.byteLength !== glb.byteLength) {
    failures.push('carrier mesh identity must match the portable GLB product');
  }

  const result = failures.length
    ? report('invalid_artifact_evidence', failures, 'declared_representation_contract_only')
    : declared;
  await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
