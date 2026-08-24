import { createHash } from 'node:crypto';

import {
  hashMuscleCompartmentRingCageCanonicalJson,
} from './muscle-compartment-ring-cage-core.mjs';
import {
  measureMuscleCompartmentRingCageContactResidualLedger,
  measureMuscleCompartmentRingCageContactState,
  solveMuscleCompartmentRingCageContact,
} from './muscle-compartment-ring-cage-contact-core.mjs';
import {
  MUSCLE_COMPARTMENT_PACKING_SOURCE_SCHEMA,
  hashMusclePackingCanonicalJson,
} from './muscle-compartment-packing-core.mjs';

export const AUTHORED_PACKING_SWEEP_MANIFEST_SCHEMA =
  'kaminos.authored-packing-sweep-manifest.v0';
export const AUTHORED_PACKING_AUTHORITY_PROFILE_SCHEMA =
  'kaminos.authored-packing-authority-profile.v0';
export const AUTHORED_PACKING_CONTACT_MEASUREMENT_SCHEMA =
  'kaminos.authored-packing-contact-measurement.v0';
export const AUTHORED_PACKING_RING_CAGE_BRIDGE_SCHEMA =
  'kaminos.authored-packing-ring-cage-bridge.v0';
export const AUTHORED_PACKING_ONE_STEP_ASSAY_SCHEMA =
  'kaminos.authored-packing-one-step-assay.v0';
export const AUTHORED_PACKING_TRAJECTORY_ASSAY_SCHEMA =
  'kaminos.authored-packing-trajectory-assay.v0';
export const AUTHORED_PACKING_COLLECTIVE_TRAJECTORY_ASSAY_SCHEMA =
  'kaminos.authored-packing-collective-trajectory-assay.v0';
export const AUTHORED_PACKING_REALIZATION_ORIGIN_SCHEMA =
  'kaminos.authored-packing-realization-origin.v0';
export const AUTHORED_PACKING_COLLECTIVE_ORIGIN_FAMILY_SCHEMA =
  'kaminos.authored-packing-collective-origin-family.v0';

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const IDENTITY_QUANTIZATION = 1_000_000_000;
const VARIANT_ROLES = Object.freeze(['clean-reference', 'mild-interpenetration', 'severe-interpenetration']);
const POLICIES = Object.freeze({
  'restoration-to-reference': {
    requiredIntentRole:'clean-reference',
    endpointAuthority:'intent-variant-hard-target',
    volumeAuthority:'intent-variant-world-mesh-volume-hard-target',
  },
  'sculpt-continuation': {
    requiredIntentRole:null,
    endpointAuthority:'current-authored-state-hard-target',
    volumeAuthority:'current-authored-world-mesh-volume-hard-target',
  },
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  if (typeof value === 'number' && Object.is(value, -0)) return 0;
  return value;
}

function identityBasis(value) {
  if (typeof value === 'number') {
    return ['$number-q9', String(identityQuantizedInteger(value))];
  }
  if (Array.isArray(value)) return value.map(identityBasis);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, identityBasis(value[key])]));
  }
  return value;
}

function identityQuantizedInteger(value) {
  if (!Number.isFinite(value)) throw new Error('identity basis cannot contain a non-finite number');
  const quantized = Math.sign(value) * Math.floor(Math.abs(value) * IDENTITY_QUANTIZATION + 0.5);
  if (!Number.isSafeInteger(quantized)) {
    throw new Error(`identity basis number exceeds safe quantization range: ${value}`);
  }
  return Object.is(quantized, -0) ? 0 : quantized;
}

function q9Displacement(displacement) {
  const integers = displacement.map(identityQuantizedInteger);
  return {
    integers,
    values:integers.map(value => value / IDENTITY_QUANTIZATION),
    isZero:integers.every(value => value === 0),
  };
}

export function hashAuthoredPackingCanonicalJson(value) {
  return createHash('sha256').update(JSON.stringify(identityBasis(canonical(value)))).digest('hex');
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a nonempty string`);
}

function requirePoint(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new Error(`${label} must be a finite 3D point`);
  }
}

function requireHash(value, label) {
  if (!HASH_PATTERN.test(value || '')) throw new Error(`${label} must be a SHA-256 identity`);
}

function coreWithoutIdentity(value) {
  const core = structuredClone(value);
  delete core.identity;
  return core;
}

function validateSweepCarrier(carrier, expectedRole, expectedMemberId = null) {
  requireString(carrier?.id, `${expectedRole} carrier id`);
  if (carrier.role !== expectedRole) {
    throw new Error(`${carrier?.id || expectedRole} carrier role mismatch`);
  }
  if (expectedMemberId !== null && carrier.memberId !== expectedMemberId) {
    throw new Error(`${carrier.id} member identity mismatch`);
  }
  requireString(carrier.objectName, `${carrier.id} objectName`);
  requireHash(carrier.meshGeometrySha256, `${carrier.id} meshGeometrySha256`);
  if (!Number.isFinite(carrier.meshVolume) || carrier.meshVolume <= 0) {
    throw new Error(`${carrier.id} meshVolume must be positive and finite`);
  }
  if (!Array.isArray(carrier.centerline) || carrier.centerline.length < 4) {
    throw new Error(`${carrier.id} centerline requires at least four sections`);
  }
  if (!Array.isArray(carrier.rings) || carrier.rings.length !== carrier.centerline.length) {
    throw new Error(`${carrier.id} ring count must equal centerline section count`);
  }
  if (!Array.isArray(carrier.mesh?.vertices) || !Array.isArray(carrier.mesh?.polygons)) {
    throw new Error(`${carrier.id} mesh topology is missing`);
  }
  for (const [index, point] of carrier.mesh.vertices.entries()) {
    requirePoint(point, `${carrier.id} mesh vertex ${index}`);
  }
  const vertexCount = carrier.mesh.vertices.length;
  for (const [index, polygon] of carrier.mesh.polygons.entries()) {
    if (
      !Array.isArray(polygon) || polygon.length < 3 ||
      polygon.some(vertex => !Number.isInteger(vertex) || vertex < 0 || vertex >= vertexCount)
    ) {
      throw new Error(`${carrier.id} mesh polygon ${index} is invalid`);
    }
  }
  const ringVertexSets = [];
  for (const [index, ring] of carrier.rings.entries()) {
    requirePoint(carrier.centerline[index].position, `${carrier.id} centerline ${index}`);
    requirePoint(carrier.centerline[index].tangent, `${carrier.id} tangent ${index}`);
    if (
      !Array.isArray(ring.vertexIndices) || ring.vertexIndices.length < 3 ||
      ring.vertexIndices.some(vertex => !Number.isInteger(vertex) || vertex < 0 || vertex >= vertexCount)
    ) {
      throw new Error(`${carrier.id} ring ${index} vertex indices are invalid`);
    }
    if (new Set(ring.vertexIndices).size !== ring.vertexIndices.length) {
      throw new Error(`${carrier.id} ring ${index} repeats a vertex`);
    }
    ringVertexSets.push(new Set(ring.vertexIndices));
  }
  if (new Set(ringVertexSets.flatMap(set => [...set])).size !== vertexCount) {
    throw new Error(`${carrier.id} rings do not partition the mesh vertices`);
  }
}

export function validateAuthoredPackingSweepManifest(manifest) {
  if (manifest?.schema !== AUTHORED_PACKING_SWEEP_MANIFEST_SCHEMA) {
    throw new Error(`authored packing sweep manifest schema mismatch: ${manifest?.schema || 'missing'}`);
  }
  requireString(manifest.id, 'authored packing sweep manifest id');
  for (const route of ['requested', 'effective']) {
    requireString(manifest.source?.input?.[route]?.kind, `source ${route} kind`);
    requireString(manifest.source?.input?.[route]?.id, `source ${route} id`);
    requireHash(manifest.source?.input?.[route]?.sha256, `source ${route}`);
  }
  if (JSON.stringify(manifest.source.input.requested) !== JSON.stringify(manifest.source.input.effective)) {
    throw new Error('authored packing requested/effective source identities disagree');
  }
  requireString(manifest.source.blenderVersion, 'Blender version');
  if (
    !Array.isArray(manifest.memberOrder) || manifest.memberOrder.length < 2 ||
    manifest.memberOrder.length > 8 || new Set(manifest.memberOrder).size !== manifest.memberOrder.length
  ) {
    throw new Error('authored packing memberOrder requires two to eight unique ids');
  }
  const variants = Object.values(manifest.variants || {});
  if (
    variants.length !== VARIANT_ROLES.length ||
    JSON.stringify(variants.map(row => row.role).sort()) !== JSON.stringify([...VARIANT_ROLES].sort())
  ) {
    throw new Error('authored packing manifest requires one clean, mild, and severe variant role');
  }
  for (const variant of variants) {
    requireString(variant.id, 'variant id');
    requireString(variant.collectionName, `${variant.id} collectionName`);
    requireHash(variant.identity?.sha256, `${variant.id} identity`);
    if (variant.identity.sha256 !== hashAuthoredPackingCanonicalJson(coreWithoutIdentity(variant))) {
      throw new Error(`${variant.id} identity does not match effective geometry`);
    }
    validateSweepCarrier(variant.bone, 'bone');
    if (
      !Array.isArray(variant.members) ||
      JSON.stringify(variant.members.map(row => row.memberId)) !== JSON.stringify(manifest.memberOrder)
    ) {
      throw new Error(`${variant.id} member set does not match memberOrder`);
    }
    variant.members.forEach((carrier, index) =>
      validateSweepCarrier(carrier, 'packable-body', manifest.memberOrder[index]));
    if (!Array.isArray(variant.meshContactTruth?.surfaceOverlapRows)) {
      throw new Error(`${variant.id} mesh contact truth is missing`);
    }
  }
  requireHash(manifest.identity?.sha256, 'manifest identity');
  if (manifest.identity.sha256 !== hashAuthoredPackingCanonicalJson(coreWithoutIdentity(manifest))) {
    throw new Error('authored packing manifest identity does not match effective payload');
  }
  return manifest;
}

function variantByRole(manifest, role) {
  const rows = Object.values(manifest.variants).filter(row => row.role === role);
  if (rows.length !== 1) throw new Error(`authored packing variant role ${role} resolved to ${rows.length} rows`);
  return rows[0];
}

function variantById(manifest, id) {
  const variant = Object.values(manifest.variants).find(row => row.id === id);
  if (!variant) throw new Error(`authored packing variant not found: ${id}`);
  return variant;
}

export function createAuthoredPackingAuthorityProfile({
  manifest,
  observedVariantId,
  intentVariantId,
  policy,
} = {}) {
  validateAuthoredPackingSweepManifest(manifest);
  const policyContract = POLICIES[policy];
  if (!policyContract) throw new Error(`unsupported authored packing authority policy: ${policy}`);
  const observed = variantById(manifest, observedVariantId);
  const intent = variantById(manifest, intentVariantId);
  if (policy === 'sculpt-continuation' && observed.id !== intent.id) {
    throw new Error('sculpt-continuation requires the current authored state to own both observation and intent');
  }
  if (
    policyContract.requiredIntentRole !== null &&
    intent.role !== policyContract.requiredIntentRole
  ) {
    throw new Error(`${policy} requires intent role ${policyContract.requiredIntentRole}`);
  }
  const members = manifest.memberOrder.map((memberId, index) => {
    const observedCarrier = observed.members[index];
    const intentCarrier = intent.members[index];
    return {
      memberId,
      observed: {
        variantId:observed.id,
        geometrySha256:observedCarrier.meshGeometrySha256,
        centerline:structuredClone(observedCarrier.centerline),
        rings:structuredClone(observedCarrier.rings),
        mesh:structuredClone(observedCarrier.mesh),
        meshVolume:observedCarrier.meshVolume,
      },
      intent: {
        variantId:intent.id,
        geometrySha256:intentCarrier.meshGeometrySha256,
        origin:structuredClone(intentCarrier.centerline[0].position),
        insertion:structuredClone(intentCarrier.centerline.at(-1).position),
        targetVolume:intentCarrier.meshVolume,
      },
    };
  });
  const core = {
    schema:AUTHORED_PACKING_AUTHORITY_PROFILE_SCHEMA,
    id:`${manifest.id}:${observed.id}:${policy}:${intent.id}`,
    source: {
      manifestSha256:manifest.identity.sha256,
      input:structuredClone(manifest.source.input),
    },
    observedState: {
      variantId:observed.id,
      role:observed.role,
      geometrySha256:observed.identity.sha256,
      authority:'operator-authored-observation',
    },
    intentState: {
      variantId:intent.id,
      role:intent.role,
      geometrySha256:intent.identity.sha256,
      authority:policy === 'sculpt-continuation'
        ? 'operator-authored-current-sculpt-intent'
        : 'operator-authored-clean-reference-intent',
    },
    packingLaw: {
      policy,
      memberIdentity:'fixed-by-manifest-member-order',
      endpoints:policyContract.endpointAuthority,
      volume:policyContract.volumeAuthority,
      contact:'topology-preserving-swept-body-exclusion',
      skeletalClearance:'topology-preserving-swept-bone-exclusion',
      centerlinePreference:'minimum-displacement-from-observed-state',
      unconsumedIntentFields:[],
    },
    members,
  };
  return { ...core, identity:{ sha256:hashAuthoredPackingCanonicalJson(core) } };
}

function validateCanonicalAuthoredPackingAuthorityProfile({ manifest, authorityProfile } = {}) {
  validateAuthoredPackingSweepManifest(manifest);
  if (authorityProfile?.schema !== AUTHORED_PACKING_AUTHORITY_PROFILE_SCHEMA) {
    throw new Error('authored packing authority profile does not match canonical manifest-derived profile');
  }
  let canonicalProfile;
  try {
    canonicalProfile = createAuthoredPackingAuthorityProfile({
      manifest,
      observedVariantId:authorityProfile.observedState?.variantId,
      intentVariantId:authorityProfile.intentState?.variantId,
      policy:authorityProfile.packingLaw?.policy,
    });
  } catch (error) {
    throw new Error(
      `authored packing authority profile does not match canonical manifest-derived profile: ${error.message}`,
    );
  }
  if (JSON.stringify(authorityProfile) !== JSON.stringify(canonicalProfile)) {
    throw new Error('authored packing authority profile does not match canonical manifest-derived profile');
  }
  return canonicalProfile;
}

function signedTetrahedronVolume(points) {
  const [a, b, c, d] = points;
  return dot(subtract(b, a), cross(subtract(c, a), subtract(d, a))) / 6;
}

function sameTopology(left, right) {
  return JSON.stringify(left.rings.map(row => row.vertexIndices)) ===
      JSON.stringify(right.rings.map(row => row.vertexIndices)) &&
    JSON.stringify(left.mesh.polygons) === JSON.stringify(right.mesh.polygons) &&
    left.mesh.vertices.length === right.mesh.vertices.length;
}

function sectionNodeId(memberId, sectionIndex, suffix) {
  return `${memberId}:section:${String(sectionIndex).padStart(4, '0')}:${suffix}`;
}

function bridgeCage({ memberId, observed, intent, sourceIdentity, currentPolicy }) {
  if (!sameTopology(observed, intent)) {
    throw new Error(`${memberId} observed and intent variants do not share exact sweep topology`);
  }
  const nodeById = new Map();
  const nodes = [];
  const boundaryMasks = [];
  const sectionCount = intent.rings.length;
  if (!['exact-observed', 'intent-endpoints-observed-interior'].includes(currentPolicy)) {
    throw new Error(`unsupported authored bridge current policy ${currentPolicy}`);
  }
  const currentCarrierForSection = sectionIndex => currentPolicy === 'exact-observed'
    ? observed
    : sectionIndex === 0 || sectionIndex === sectionCount - 1 ? intent : observed;
  for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
    const fixed = sectionIndex === 0 || sectionIndex === sectionCount - 1;
    const attachmentFrameId = fixed
      ? `${memberId}:${sectionIndex === 0 ? 'origin' : 'insertion'}-attachment`
      : null;
    const axisId = sectionNodeId(memberId, sectionIndex, 'axis');
    const axisNode = {
      id:axisId,
      restPosition:structuredClone(intent.centerline[sectionIndex].position),
      currentPosition:structuredClone(
        currentCarrierForSection(sectionIndex).centerline[sectionIndex].position,
      ),
      materialRegionId:null,
      attachmentFrameId,
      forceApplicationHandle:null,
    };
    nodes.push(axisNode);
    nodeById.set(axisId, axisNode);
    boundaryMasks.push({
      nodeId:axisId,
      fixed,
      roles:fixed ? ['fixed-attachment-boundary'] : [],
      attachmentFrameId,
      targetTransform:null,
    });
    for (const [radialIndex, vertexIndex] of intent.rings[sectionIndex].vertexIndices.entries()) {
      const vertexId = sectionNodeId(
        memberId,
        sectionIndex,
        `vertex:${String(radialIndex).padStart(2, '0')}`,
      );
      const currentCarrier = currentCarrierForSection(sectionIndex);
      const node = {
        id:vertexId,
        restPosition:structuredClone(intent.mesh.vertices[vertexIndex]),
        currentPosition:structuredClone(currentCarrier.mesh.vertices[vertexIndex]),
        materialRegionId:null,
        attachmentFrameId,
        forceApplicationHandle:null,
      };
      nodes.push(node);
      nodeById.set(vertexId, node);
      boundaryMasks.push({
        nodeId:vertexId,
        fixed,
        roles:fixed ? ['fixed-attachment-boundary'] : [],
        attachmentFrameId,
        targetTransform:null,
      });
    }
  }

  const cells = [];
  for (let segmentIndex = 0; segmentIndex < sectionCount - 1; segmentIndex += 1) {
    const leftIndices = new Set(intent.rings[segmentIndex].vertexIndices);
    const rightIndices = new Set(intent.rings[segmentIndex + 1].vertexIndices);
    const sideFaces = intent.mesh.polygons.filter(face =>
      face.length === 4 &&
      face.filter(index => leftIndices.has(index)).length === 2 &&
      face.filter(index => rightIndices.has(index)).length === 2);
    if (sideFaces.length !== intent.rings[segmentIndex].vertexIndices.length) {
      throw new Error(`${memberId} segment ${segmentIndex} does not form a closed swept section`);
    }
    const radialIndexByVertex = new Map(
      intent.rings[segmentIndex].vertexIndices.map((vertexIndex, radialIndex) =>
        [vertexIndex, radialIndex]),
    );
    for (const face of sideFaces) {
      const leftVertexIndices = face.filter(index => leftIndices.has(index));
      const pairedRightIndex = leftVertexIndex => {
        const position = face.indexOf(leftVertexIndex);
        const match = [
          face[(position + face.length - 1) % face.length],
          face[(position + 1) % face.length],
        ].find(index => rightIndices.has(index));
        if (match === undefined) throw new Error(`${memberId} side face lacks longitudinal correspondence`);
        return match;
      };
      const leftRadialIndices = leftVertexIndices.map(index => radialIndexByVertex.get(index));
      const rightRadialIndices = leftVertexIndices.map(pairedRightIndex).map(index =>
        intent.rings[segmentIndex + 1].vertexIndices.indexOf(index));
      if ([...leftRadialIndices, ...rightRadialIndices].some(index => index < 0)) {
        throw new Error(`${memberId} side face references a vertex outside its ordered rings`);
      }
      const prism = [
        sectionNodeId(memberId, segmentIndex, 'axis'),
        ...leftRadialIndices.map(index => sectionNodeId(
          memberId, segmentIndex, `vertex:${String(index).padStart(2, '0')}`,
        )),
        sectionNodeId(memberId, segmentIndex + 1, 'axis'),
        ...rightRadialIndices.map(index => sectionNodeId(
          memberId, segmentIndex + 1, `vertex:${String(index).padStart(2, '0')}`,
        )),
      ];
      const tetrahedra = [
        [prism[0], prism[1], prism[2], prism[3]],
        [prism[1], prism[4], prism[2], prism[3]],
        [prism[2], prism[4], prism[5], prism[3]],
      ];
      for (const [tetrahedronIndex, nodeIds] of tetrahedra.entries()) {
        const rawSignedVolume = signedTetrahedronVolume(
          nodeIds.map(nodeId => nodeById.get(nodeId).restPosition),
        );
        if (!Number.isFinite(rawSignedVolume) || Math.abs(rawSignedVolume) <= 1e-12) {
          throw new Error(`${memberId} segment ${segmentIndex} contains a degenerate rest cell`);
        }
        cells.push({
          id:`${memberId}:cell:${String(cells.length).padStart(5, '0')}`,
          kind:'tetrahedron',
          nodeIds,
          restRawSignedVolume:rawSignedVolume,
          restOrientationParity:Math.sign(rawSignedVolume),
          sectionSpan:[segmentIndex, segmentIndex + 1],
          sourceTetrahedronIndex:tetrahedronIndex,
        });
      }
    }
  }
  return {
    cageId:`${memberId}:authored-cage`,
    constructionId:memberId,
    sourceIdentity:structuredClone(sourceIdentity),
    manifest: {
      schema:'kaminos.positive-volume-cage-manifest-projection.v0',
      fixtureScope:'operator-authored-packing-sweep',
      sourceIdentity:structuredClone(sourceIdentity),
      sourceGeometry: {
        schema:'kaminos.operator-authored-sweep-geometry.v0',
        authority:'operator-authored-observed-and-intent-separated',
        currentPolicy,
        observedGeometrySha256:observed.meshGeometrySha256,
        intentGeometrySha256:intent.meshGeometrySha256,
      },
      nodes,
      cells,
      constraints:{ boundaryMasks },
    },
  };
}

function bridgeCompartment(cages) {
  const points = cages.flatMap(cage => cage.manifest.nodes.flatMap(node => [
    node.restPosition,
    node.currentPosition,
  ]));
  const minimum = [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis])));
  const maximum = [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis])));
  const span = maximum.map((value, axis) => value - minimum[axis]);
  const margin = span.map(value => Math.max(1, value * 0.15));
  return {
    kind:'box',
    minimum:minimum.map((value, axis) => value - margin[axis]),
    maximum:maximum.map((value, axis) => value + margin[axis]),
    clearance:0,
    authority:'derived-observed-and-intent-envelope-not-authored-compartment',
  };
}

export function createAuthoredPackingRingCageBridge({ manifest, authorityProfile } = {}) {
  validateCanonicalAuthoredPackingAuthorityProfile({ manifest, authorityProfile });
  const observedVariant = variantById(manifest, authorityProfile.observedState.variantId);
  const intentVariant = variantById(manifest, authorityProfile.intentState.variantId);
  const identities = new Map(manifest.memberOrder.map(memberId => [memberId, {
    sourceId:`${manifest.identity.sha256}:${memberId}`,
    constructionId:memberId,
    lineageId:`${manifest.id}:${memberId}`,
    instanceId:`${observedVariant.id}:${memberId}`,
  }]));
  const observedCages = manifest.memberOrder.map((memberId, index) => bridgeCage({
    memberId,
    observed:observedVariant.members[index],
    intent:intentVariant.members[index],
    sourceIdentity:identities.get(memberId),
    currentPolicy:'exact-observed',
  }));
  const cages = manifest.memberOrder.map((memberId, index) => bridgeCage({
    memberId,
    observed:observedVariant.members[index],
    intent:intentVariant.members[index],
    sourceIdentity:identities.get(memberId),
    currentPolicy:'intent-endpoints-observed-interior',
  }));
  const carrier = cagesForCarrier => {
    const core = {
      schema:'kaminos.muscle-compartment-ring-cage-solver-carrier.v0',
      sourceDocument: {
        schema:AUTHORED_PACKING_RING_CAGE_BRIDGE_SCHEMA,
        sha256:authorityProfile.identity.sha256,
      },
      orderedConstructionIds:[...manifest.memberOrder],
      cages:cagesForCarrier,
    };
    return {
      ...core,
      identity: {
        domain:'canonical-json-self-excluding-top-level-identity',
        sha256:hashMuscleCompartmentRingCageCanonicalJson(core),
      },
    };
  };
  const observedCarrier = carrier(observedCages);
  const solverCarrier = carrier(cages);
  const initializationCore = canonicalInitializationReceipt({
    observedCarrier,
    solverCarrier,
  });
  const initialization = {
    ...initializationCore,
    identity: {
      domain:'canonical-json-self-excluding-top-level-identity',
      sha256:hashAuthoredPackingCanonicalJson(initializationCore),
    },
  };
  const sourceCore = {
    schema:MUSCLE_COMPARTMENT_PACKING_SOURCE_SCHEMA,
    id:`${authorityProfile.id}:solver-source`,
    dimension:3,
    authority: {
      kind:'operator-authored',
      anatomicalAdmission:'operator-authored-packing-fixture-not-anatomical-admission',
    },
    formation:{ centerlineSmoothingReference:'source-displacement' },
    compartment:bridgeCompartment(cages),
    obstacles:[],
    fixedAttachmentContacts:[],
    muscles:manifest.memberOrder.map((memberId, index) => {
      const cage = cages[index];
      const nodes = new Map(cage.manifest.nodes.map(node => [node.id, node]));
      const centerline = observedVariant.members[index].rings.map((ring, sectionIndex) => {
        const axis = nodes.get(sectionNodeId(memberId, sectionIndex, 'axis'));
        const areaCarrier = sectionIndex === 0 || sectionIndex === observedVariant.members[index].rings.length - 1
          ? intentVariant.members[index]
          : observedVariant.members[index];
        return {
          position:structuredClone(axis.currentPosition),
          radius:Math.sqrt(areaCarrier.rings[sectionIndex].area / Math.PI),
        };
      });
      return {
        id:memberId,
        identity:structuredClone(identities.get(memberId)),
        authority: {
          kind:'operator-authored',
          anatomicalAdmission:'operator-authored-packing-fixture-not-anatomical-admission',
        },
        attachments: {
          origin: {
            id:`${memberId}:origin-attachment`,
            sourceAuthority:authorityProfile.packingLaw.endpoints,
            position:structuredClone(centerline[0].position),
          },
          insertion: {
            id:`${memberId}:insertion-attachment`,
            sourceAuthority:authorityProfile.packingLaw.endpoints,
            position:structuredClone(centerline.at(-1).position),
          },
        },
        centerline,
        targetVolume:authorityProfile.members[index].intent.targetVolume,
      };
    }),
    authoredPacking: {
      manifestSha256:manifest.identity.sha256,
      authorityProfileSha256:authorityProfile.identity.sha256,
      observedVariantId:observedVariant.id,
      intentVariantId:intentVariant.id,
      observedCarrierSha256:observedCarrier.identity.sha256,
      initializedCarrierSha256:solverCarrier.identity.sha256,
      initializationSchema:initialization.schema,
      initializationSha256:initialization.identity.sha256,
      boneResponse:'not-yet-applied-pairwise-first-slice',
    },
  };
  const sourceSha256 = hashMusclePackingCanonicalJson(sourceCore);
  const sourceIdentity = {
    kind:'operator-authored-fixture',
    id:sourceCore.id,
    sha256:sourceSha256,
  };
  const source = {
    ...sourceCore,
    input:{ requested:structuredClone(sourceIdentity), effective:structuredClone(sourceIdentity) },
  };
  const bridgeCore = {
    schema:AUTHORED_PACKING_RING_CAGE_BRIDGE_SCHEMA,
    source,
    observedCarrier,
    solverCarrier,
    initialization,
    authorityProfile: {
      id:authorityProfile.id,
      sha256:authorityProfile.identity.sha256,
    },
    route: {
      requested:'exact-authored-sweep-to-positive-volume-ring-cage-v0',
      effective:'exact-authored-sweep-to-positive-volume-ring-cage-v0',
      fallbackUsed:false,
    },
  };
  return {
    ...bridgeCore,
    identity: {
      domain:'canonical-json-self-excluding-top-level-identity',
      sha256:hashAuthoredPackingCanonicalJson(bridgeCore),
    },
  };
}

function canonicalInitializationReceipt({ observedCarrier, solverCarrier }) {
  const observedCages = new Map(observedCarrier.cages.map(cage => [cage.constructionId, cage]));
  const endpointDisplacements = solverCarrier.orderedConstructionIds.map(constructionId => {
    const observedCage = observedCages.get(constructionId);
    const solverCage = solverCarrier.cages.find(cage => cage.constructionId === constructionId);
    if (!observedCage || !solverCage) {
      throw new Error(`initialization carrier construction mismatch: ${constructionId}`);
    }
    const observedNodes = new Map(observedCage.manifest.nodes.map(node => [node.id, node]));
    const solverNodes = new Map(solverCage.manifest.nodes.map(node => [node.id, node]));
    const displacements = solverCage.manifest.constraints.boundaryMasks
      .filter(mask => mask.fixed)
      .map(mask => {
        const observedNode = observedNodes.get(mask.nodeId);
        const solverNode = solverNodes.get(mask.nodeId);
        if (!observedNode || !solverNode) {
          throw new Error(`initialization fixed node mismatch: ${mask.nodeId}`);
        }
        return length(subtract(observedNode.currentPosition, solverNode.currentPosition));
      });
    return {
      constructionId,
      maximumDisplacement:Math.max(0, ...displacements),
    };
  });
  return {
    schema:'kaminos.authored-packing-solver-initialization.v0',
    observedCarrierSha256:observedCarrier.identity.sha256,
    initializedCarrierSha256:solverCarrier.identity.sha256,
    endpointPolicy:'intent-endpoints-observed-interior',
    endpointDisplacements,
  };
}

function ringCageCarrierIdentity(carrier) {
  return hashMuscleCompartmentRingCageCanonicalJson(coreWithoutIdentity(carrier));
}

function carrierSourceIdentityRows(carrier) {
  return carrier.cages.map(cage => ({
    constructionId:cage.constructionId,
    cageSourceIdentity:cage.sourceIdentity,
    manifestSourceIdentity:cage.manifest?.sourceIdentity,
  }));
}

function carrierLawBearingDomain(carrier) {
  const domain = coreWithoutIdentity(carrier);
  for (const cage of domain.cages || []) {
    const fixedNodeIds = new Set((cage.manifest?.constraints?.boundaryMasks || [])
      .filter(row => row.fixed)
      .map(row => row.nodeId));
    for (const node of cage.manifest?.nodes || []) {
      if (!fixedNodeIds.has(node.id)) delete node.currentPosition;
    }
  }
  return domain;
}

function ringCageBridgeIdentity(bridge) {
  return hashAuthoredPackingCanonicalJson(coreWithoutIdentity(bridge));
}

function realizationOriginParentEnvelope(bridge) {
  return {
    bridgeSha256:bridge.identity.sha256,
    observedCarrierSha256:bridge.observedCarrier.identity.sha256,
    initializedCarrierSha256:bridge.solverCarrier.identity.sha256,
    authorityProfile:structuredClone(bridge.authorityProfile),
    sourceInput:structuredClone(bridge.source.input),
    initializationSha256:bridge.initialization.identity.sha256,
  };
}

export function createAuthoredPackingRealizationOriginParentEnvelope({ bridge } = {}) {
  requireRealizationOriginBridge(bridge);
  return realizationOriginParentEnvelope(bridge);
}

function sourceManifestShaFromCarrier(carrier) {
  const manifestShas = new Set();
  for (const cage of carrier.cages) {
    if (JSON.stringify(cage.sourceIdentity) !== JSON.stringify(cage.manifest?.sourceIdentity)) {
      throw new Error(`realization origin carrier source identity mismatch: ${cage.constructionId}`);
    }
    const suffix = `:${cage.constructionId}`;
    const sourceId = cage.sourceIdentity?.sourceId;
    if (typeof sourceId !== 'string' || !sourceId.endsWith(suffix)) {
      throw new Error(`realization origin carrier manifest lineage mismatch: ${cage.constructionId}`);
    }
    manifestShas.add(sourceId.slice(0, -suffix.length));
  }
  if (manifestShas.size !== 1) {
    throw new Error('realization origin carriers do not share one manifest lineage');
  }
  const [manifestSha256] = manifestShas;
  requireHash(manifestSha256, 'realization origin carrier manifest lineage');
  return manifestSha256;
}

function requireSourceCarrierProjection(bridge) {
  const manifestSha256 = sourceManifestShaFromCarrier(bridge.solverCarrier);
  if (sourceManifestShaFromCarrier(bridge.observedCarrier) !== manifestSha256) {
    throw new Error('realization origin observed/initialized manifest lineage mismatch');
  }
  if (bridge.source.authoredPacking?.manifestSha256 !== manifestSha256) {
    throw new Error('realization origin source manifest and carrier lineage mismatch');
  }
  if (bridge.source.id !== `${bridge.authorityProfile.id}:solver-source`) {
    throw new Error('realization origin source authority profile id mismatch');
  }
  const constructionIds = bridge.solverCarrier.orderedConstructionIds;
  if (
    JSON.stringify(bridge.observedCarrier.orderedConstructionIds) !== JSON.stringify(constructionIds) ||
    JSON.stringify(bridge.source.muscles?.map(muscle => muscle.id)) !== JSON.stringify(constructionIds)
  ) {
    throw new Error('realization origin source construction order mismatch');
  }
  const cages = new Map(bridge.solverCarrier.cages.map(cage => [cage.constructionId, cage]));
  for (const muscle of bridge.source.muscles) {
    const cage = cages.get(muscle.id);
    if (!cage || JSON.stringify(muscle.identity) !== JSON.stringify(cage.sourceIdentity)) {
      throw new Error(`realization origin source construction identity mismatch: ${muscle.id}`);
    }
    if (cage.sourceIdentity.instanceId !== `${bridge.source.authoredPacking.observedVariantId}:${muscle.id}`) {
      throw new Error(`realization origin source observed variant lineage mismatch: ${muscle.id}`);
    }
    const axisNodes = cage.manifest.nodes
      .filter(node => node.id.endsWith(':axis'))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (
      !Array.isArray(muscle.centerline) ||
      muscle.centerline.length !== axisNodes.length ||
      muscle.centerline.some((row, index) =>
        JSON.stringify(row.position) !== JSON.stringify(axisNodes[index].currentPosition) ||
        !Number.isFinite(row.radius) || row.radius <= 0)
    ) {
      throw new Error(`realization origin source geometry projection mismatch: ${muscle.id}`);
    }
    if (
      JSON.stringify(muscle.attachments?.origin?.position) !==
        JSON.stringify(muscle.centerline[0].position) ||
      JSON.stringify(muscle.attachments?.insertion?.position) !==
        JSON.stringify(muscle.centerline.at(-1).position)
    ) {
      throw new Error(`realization origin source geometry attachment mismatch: ${muscle.id}`);
    }
    if (!Number.isFinite(muscle.targetVolume) || muscle.targetVolume <= 0) {
      throw new Error(`realization origin source target volume mismatch: ${muscle.id}`);
    }
  }
}

function realizationOriginDifference(parentCarrier, candidateCarrier) {
  const rows = [];
  const constructionRows = [];
  let squaredDisplacementTotal = 0;
  let nodeCount = 0;
  let fixedNodeMaximumDrift = 0;
  for (const [cageIndex, parentCage] of parentCarrier.cages.entries()) {
    const candidateCage = candidateCarrier.cages[cageIndex];
    const candidateNodes = new Map(candidateCage.manifest.nodes.map(node => [node.id, node]));
    const fixedNodeIds = new Set(parentCage.manifest.constraints.boundaryMasks
      .filter(row => row.fixed)
      .map(row => row.nodeId));
    let changedNodeCount = 0;
    let maximumNodeDisplacement = 0;
    for (const parentNode of parentCage.manifest.nodes) {
      const candidateNode = candidateNodes.get(parentNode.id);
      if (!candidateNode) {
        throw new Error(`realization origin is missing node ${parentNode.id}`);
      }
      requirePoint(candidateNode.currentPosition, `realization origin node ${parentNode.id}`);
      const rawDisplacement = subtract(candidateNode.currentPosition, parentNode.currentPosition);
      const displacement = q9Displacement(rawDisplacement);
      const magnitude = length(displacement.values);
      nodeCount += 1;
      squaredDisplacementTotal += magnitude * magnitude;
      maximumNodeDisplacement = Math.max(maximumNodeDisplacement, magnitude);
      if (fixedNodeIds.has(parentNode.id)) {
        fixedNodeMaximumDrift = Math.max(fixedNodeMaximumDrift, magnitude);
      }
      if (!displacement.isZero) {
        changedNodeCount += 1;
        rows.push({
          constructionId:parentCage.constructionId,
          nodeId:parentNode.id,
          displacementQ9:displacement.integers.map(String),
        });
      }
    }
    constructionRows.push({
      constructionId:parentCage.constructionId,
      changedNodeCount,
      maximumNodeDisplacement,
    });
  }
  return {
    changedNodeCount:rows.length,
    maximumNodeDisplacement:Math.max(0, ...constructionRows.map(
      row => row.maximumNodeDisplacement,
    )),
    rootMeanSquareNodeDisplacement:nodeCount === 0
      ? 0
      : Math.sqrt(squaredDisplacementTotal / nodeCount),
    fixedNodeMaximumDrift,
    constructionRows,
    displacementRows:rows,
  };
}

function requireRealizationOriginBridge(bridge) {
  if (bridge?.schema !== AUTHORED_PACKING_RING_CAGE_BRIDGE_SCHEMA) {
    throw new Error('realization origin requires an authored packing ring-cage bridge');
  }
  for (const [label, carrier] of [
    ['observed', bridge.observedCarrier],
    ['initialized', bridge.solverCarrier],
  ]) {
    if (carrier?.schema !== 'kaminos.muscle-compartment-ring-cage-solver-carrier.v0') {
      throw new Error(`realization origin ${label} parent is not a ring-cage solver carrier`);
    }
    if (carrier.identity?.sha256 !== ringCageCarrierIdentity(carrier)) {
      throw new Error(`realization origin ${label} parent carrier identity mismatch`);
    }
  }
  requireHash(bridge.authorityProfile?.sha256, 'realization origin authority profile');
  if (
    bridge.authorityProfile.sha256 !== bridge.observedCarrier.sourceDocument?.sha256 ||
    bridge.authorityProfile.sha256 !== bridge.solverCarrier.sourceDocument?.sha256 ||
    bridge.authorityProfile.sha256 !== bridge.source?.authoredPacking?.authorityProfileSha256
  ) {
    throw new Error('realization origin authority profile binding mismatch');
  }
  if (
    bridge.initialization?.schema !== 'kaminos.authored-packing-solver-initialization.v0' ||
    bridge.initialization.observedCarrierSha256 !== bridge.observedCarrier.identity.sha256 ||
    bridge.initialization.initializedCarrierSha256 !== bridge.solverCarrier.identity.sha256
  ) {
    throw new Error('realization origin initialization carrier identity mismatch');
  }
  const expectedInitialization = canonicalInitializationReceipt({
    observedCarrier:bridge.observedCarrier,
    solverCarrier:bridge.solverCarrier,
  });
  if (
    JSON.stringify(coreWithoutIdentity(bridge.initialization)) !==
      JSON.stringify(expectedInitialization) ||
    bridge.initialization.identity?.domain !==
      'canonical-json-self-excluding-top-level-identity' ||
    bridge.initialization.identity?.sha256 !==
      hashAuthoredPackingCanonicalJson(expectedInitialization)
  ) {
    throw new Error('realization origin initialization policy or displacement ledger mismatch');
  }
  if (
    bridge.source?.authoredPacking?.observedCarrierSha256 !== bridge.observedCarrier.identity.sha256 ||
    bridge.source?.authoredPacking?.initializedCarrierSha256 !== bridge.solverCarrier.identity.sha256 ||
    bridge.source?.authoredPacking?.initializationSchema !== bridge.initialization.schema ||
    bridge.source?.authoredPacking?.initializationSha256 !== bridge.initialization.identity.sha256
  ) {
    throw new Error('realization origin source authored parent identity mismatch');
  }
  if (
    bridge.route?.requested !== 'exact-authored-sweep-to-positive-volume-ring-cage-v0' ||
    bridge.route?.effective !== bridge.route.requested ||
    bridge.route?.fallbackUsed !== false
  ) {
    throw new Error('realization origin bridge route identity mismatch');
  }
  const sourcePayload = structuredClone(bridge.source);
  delete sourcePayload.input;
  const sourceSha256 = hashMusclePackingCanonicalJson(sourcePayload);
  const expectedSourceIdentity = {
    kind:'operator-authored-fixture',
    id:sourcePayload.id,
    sha256:sourceSha256,
  };
  if (
    JSON.stringify(bridge.source?.input?.requested) !== JSON.stringify(expectedSourceIdentity) ||
    JSON.stringify(bridge.source?.input?.effective) !== JSON.stringify(expectedSourceIdentity)
  ) {
    throw new Error('realization origin bridge requested/effective source identity mismatch');
  }
  requireSourceCarrierProjection(bridge);
  requireHash(bridge.identity?.sha256, 'realization origin bridge');
  if (
    bridge.identity.domain !== 'canonical-json-self-excluding-top-level-identity' ||
    bridge.identity.sha256 !== ringCageBridgeIdentity(bridge)
  ) {
    throw new Error('realization origin bridge identity mismatch');
  }
  return bridge;
}

function requireRealizationOriginExpectedParent(expectedParent, bridge) {
  const effectiveParent = realizationOriginParentEnvelope(bridge);
  if (JSON.stringify(expectedParent) !== JSON.stringify(effectiveParent)) {
    throw new Error('realization origin independently preserved parent authority mismatch');
  }
  return effectiveParent;
}

function requireAuthoredPackingContactCarrierLineage({
  authorityProfile,
  solverCarrier,
  lineageBridge,
  expectedParent,
  lineageRoot,
}) {
  requireRealizationOriginBridge(lineageBridge);
  requireRealizationOriginExpectedParent(expectedParent, lineageBridge);
  if (lineageBridge.authorityProfile.sha256 !== authorityProfile.identity.sha256) {
    throw new Error('authored bridge contact independently preserved carrier lineage authority profile mismatch');
  }
  const lineageCarrier = lineageRoot === 'observed'
    ? lineageBridge.observedCarrier
    : lineageRoot === 'initialized-descendant'
      ? lineageBridge.solverCarrier
      : null;
  if (lineageCarrier === null) {
    throw new Error('authored bridge contact independently preserved carrier lineage root mismatch');
  }
  if (
    JSON.stringify(carrierLawBearingDomain(solverCarrier)) !==
    JSON.stringify(carrierLawBearingDomain(lineageCarrier))
  ) {
    throw new Error('authored bridge contact independently preserved carrier lineage law mismatch');
  }
  return lineageCarrier;
}

function requireCanonicalQ9DisplacementRows(rows, bridge) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('realization origin generation requires canonical displacement rows');
  }
  const cages = new Map(bridge.solverCarrier.cages.map(cage => [cage.constructionId, cage]));
  const seen = new Set();
  for (const row of rows) {
    requireString(row?.constructionId, 'realization origin generation displacement constructionId');
    requireString(row?.nodeId, 'realization origin generation displacement nodeId');
    if (
      !Array.isArray(row.displacementQ9) || row.displacementQ9.length !== 3 ||
      !row.displacementQ9.every(value => {
        if (typeof value !== 'string' || !/^-?(0|[1-9]\d*)$/.test(value)) return false;
        const integer = Number(value);
        return Number.isSafeInteger(integer) && String(integer) === value;
      }) ||
      row.displacementQ9.every(value => value === '0')
    ) {
      throw new Error(`realization origin generation displacement ${row.nodeId} is not canonical q9`);
    }
    const key = `${row.constructionId}|${row.nodeId}`;
    if (seen.has(key)) {
      throw new Error(`realization origin generation repeats node displacement ${key}`);
    }
    seen.add(key);
    const cage = cages.get(row.constructionId);
    const mask = cage?.manifest?.constraints?.boundaryMasks?.find(item => item.nodeId === row.nodeId);
    if (!mask) {
      throw new Error(`realization origin generation node is not constraint-accounted: ${row.nodeId}`);
    }
    if (mask.fixed) {
      throw new Error(`realization origin generation claims fixed attachment drift at ${row.nodeId}`);
    }
  }
}

function canonicalQ9RowsFromRequestedDisplacements(rows, bridge) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('realization origin requires at least one node displacement');
  }
  const cages = new Map(bridge.solverCarrier.cages.map(cage => [cage.constructionId, cage]));
  const constructionOrder = new Map(
    bridge.solverCarrier.orderedConstructionIds.map((constructionId, index) => [constructionId, index]),
  );
  const nodeOrder = new Map(bridge.solverCarrier.cages.flatMap(cage =>
    cage.manifest.nodes.map((node, index) => [`${cage.constructionId}|${node.id}`, index])
  ));
  const seen = new Set();
  const canonicalRows = [];
  const orderedRows = structuredClone(rows).sort((left, right) => {
    const constructionDifference = (constructionOrder.get(left.constructionId) ?? Infinity) -
      (constructionOrder.get(right.constructionId) ?? Infinity);
    if (constructionDifference !== 0) return constructionDifference;
    const leftKey = `${left.constructionId}|${left.nodeId}`;
    const rightKey = `${right.constructionId}|${right.nodeId}`;
    const nodeDifference = (nodeOrder.get(leftKey) ?? Infinity) - (nodeOrder.get(rightKey) ?? Infinity);
    return nodeDifference !== 0 ? nodeDifference : leftKey.localeCompare(rightKey);
  });
  for (const row of orderedRows) {
    requireString(row?.constructionId, 'realization origin displacement constructionId');
    requireString(row?.nodeId, 'realization origin displacement nodeId');
    requirePoint(row.displacement, `realization origin displacement ${row.nodeId}`);
    const key = `${row.constructionId}|${row.nodeId}`;
    if (seen.has(key)) throw new Error(`realization origin repeats node displacement ${key}`);
    seen.add(key);
    const cage = cages.get(row.constructionId);
    if (!cage) throw new Error(`realization origin construction not found: ${row.constructionId}`);
    const mask = cage.manifest.constraints.boundaryMasks.find(item => item.nodeId === row.nodeId);
    if (!mask) throw new Error(`realization origin node is not constraint-accounted: ${row.nodeId}`);
    if (mask.fixed) throw new Error(`realization origin fixed attachment drift attempted at ${row.nodeId}`);
    const displacement = q9Displacement(row.displacement);
    if (!displacement.isZero) {
      canonicalRows.push({
        constructionId:row.constructionId,
        nodeId:row.nodeId,
        displacementQ9:displacement.integers.map(String),
      });
    }
  }
  if (canonicalRows.length === 0) {
    throw new Error('realization origin is physically identical to its initialized parent');
  }
  requireCanonicalQ9DisplacementRows(canonicalRows, bridge);
  return canonicalRows;
}

function candidateCarrierFromCanonicalQ9Rows(bridge, rows) {
  requireCanonicalQ9DisplacementRows(rows, bridge);
  const candidateCarrier = structuredClone(bridge.solverCarrier);
  const cages = new Map(candidateCarrier.cages.map(cage => [cage.constructionId, cage]));
  for (const row of rows) {
    const cage = cages.get(row.constructionId);
    const node = cage.manifest.nodes.find(item => item.id === row.nodeId);
    if (!node) throw new Error(`realization origin node not found: ${row.nodeId}`);
    node.currentPosition = node.currentPosition.map(
      (value, axis) => value + Number(row.displacementQ9[axis]) / IDENTITY_QUANTIZATION,
    );
  }
  candidateCarrier.identity = {
    domain:'canonical-json-self-excluding-top-level-identity',
    sha256:ringCageCarrierIdentity(candidateCarrier),
  };
  return candidateCarrier;
}

function requireRealizationOriginGeneration(generation, bridge, difference) {
  if (generation?.basis?.schema !== 'kaminos.authored-packing-realization-origin-basis.v0') {
    throw new Error('realization origin generation basis schema mismatch');
  }
  requireString(generation.basis.id, 'realization origin generation basis id');
  requireString(generation.basis.authority, 'realization origin generation basis authority');
  if (!Array.isArray(generation.coefficients) || generation.coefficients.length === 0 ||
      !generation.coefficients.every(Number.isFinite)) {
    throw new Error('realization origin generation coefficients must be a nonempty finite array');
  }
  if (generation.basisReplayAuthority !== 'structural-lineage-only-no-admitted-basis-evaluator') {
    throw new Error('realization origin generation basis replay authority mismatch');
  }
  requireCanonicalQ9DisplacementRows(generation.nodeDisplacements, bridge);
  if (JSON.stringify(generation.nodeDisplacements) !== JSON.stringify(difference.displacementRows)) {
    throw new Error('realization origin generation displacement and candidate geometry mismatch');
  }
}

export function createAuthoredPackingRealizationOrigin({
  bridge,
  expectedParent,
  generationBasis,
  coefficients,
  nodeDisplacements,
} = {}) {
  requireRealizationOriginBridge(bridge);
  requireRealizationOriginExpectedParent(expectedParent, bridge);
  if (generationBasis?.schema !== 'kaminos.authored-packing-realization-origin-basis.v0') {
    throw new Error('realization origin generation basis schema mismatch');
  }
  requireString(generationBasis.id, 'realization origin generation basis id');
  requireString(generationBasis.authority, 'realization origin generation basis authority');
  if (!Array.isArray(coefficients) || coefficients.length === 0 || !coefficients.every(Number.isFinite)) {
    throw new Error('realization origin coefficients must be a nonempty finite array');
  }
  const canonicalDisplacementRows = canonicalQ9RowsFromRequestedDisplacements(
    nodeDisplacements,
    bridge,
  );
  const candidateCarrier = candidateCarrierFromCanonicalQ9Rows(
    bridge,
    canonicalDisplacementRows,
  );
  const difference = realizationOriginDifference(bridge.solverCarrier, candidateCarrier);
  if (difference.changedNodeCount === 0) {
    throw new Error('realization origin is physically identical to its initialized parent');
  }
  if (difference.fixedNodeMaximumDrift !== 0) {
    throw new Error('realization origin fixed attachment drift is nonzero');
  }
  const equivalenceCore = {
    domain:'parent-and-q9-canonical-current-position-displacements',
    initializedCarrierSha256:bridge.solverCarrier.identity.sha256,
    displacementRows:difference.displacementRows,
  };
  const core = {
    schema:AUTHORED_PACKING_REALIZATION_ORIGIN_SCHEMA,
    parent:structuredClone(expectedParent),
    generation: {
      basis:structuredClone(generationBasis),
      coefficients:[...coefficients],
      basisReplayAuthority:'structural-lineage-only-no-admitted-basis-evaluator',
      nodeDisplacements:structuredClone(canonicalDisplacementRows),
    },
    candidateCarrier,
    difference,
    equivalence: {
      ...equivalenceCore,
      sha256:hashAuthoredPackingCanonicalJson(equivalenceCore),
    },
    route: {
      requested:'plural-realization-origin-to-existing-global-solver-v0',
      effective:'plural-realization-origin-to-existing-global-solver-v0',
      fallbackUsed:false,
    },
  };
  const origin = { ...core, identity:{ sha256:hashAuthoredPackingCanonicalJson(core) } };
  validateAuthoredPackingRealizationOrigin({ bridge, expectedParent, origin });
  return origin;
}

export function validateAuthoredPackingRealizationOrigin({ bridge, expectedParent, origin } = {}) {
  requireRealizationOriginBridge(bridge);
  if (origin?.schema !== AUTHORED_PACKING_REALIZATION_ORIGIN_SCHEMA) {
    throw new Error('authored packing realization origin schema mismatch');
  }
  const effectiveParent = requireRealizationOriginExpectedParent(expectedParent, bridge);
  if (JSON.stringify(origin.parent) !== JSON.stringify(effectiveParent)) {
    throw new Error('realization origin parent or source authority mismatch');
  }
  if (
    origin.route?.requested !== 'plural-realization-origin-to-existing-global-solver-v0' ||
    origin.route?.effective !== origin.route.requested ||
    origin.route?.fallbackUsed !== false
  ) {
    throw new Error('realization origin route identity mismatch');
  }
  const candidateCarrier = origin.candidateCarrier;
  if (candidateCarrier?.schema !== 'kaminos.muscle-compartment-ring-cage-solver-carrier.v0') {
    throw new Error('realization origin candidate is not a ring-cage solver carrier');
  }
  if (JSON.stringify(carrierSourceIdentityRows(candidateCarrier)) !==
      JSON.stringify(carrierSourceIdentityRows(bridge.solverCarrier))) {
    throw new Error('realization origin source identity substitution');
  }
  if (JSON.stringify(carrierLawBearingDomain(candidateCarrier)) !==
      JSON.stringify(carrierLawBearingDomain(bridge.solverCarrier))) {
    throw new Error('realization origin substituted topology, rest state, constraints, or attachment law');
  }
  if (candidateCarrier.identity?.sha256 !== ringCageCarrierIdentity(candidateCarrier)) {
    throw new Error('realization origin candidate carrier identity mismatch');
  }
  const difference = realizationOriginDifference(bridge.solverCarrier, candidateCarrier);
  if (difference.changedNodeCount === 0) {
    throw new Error('realization origin is physically identical to its initialized parent');
  }
  if (difference.fixedNodeMaximumDrift !== 0) {
    throw new Error('realization origin fixed attachment drift is nonzero');
  }
  if (JSON.stringify(origin.difference) !== JSON.stringify(difference)) {
    throw new Error('realization origin difference descriptor mismatch');
  }
  requireRealizationOriginGeneration(origin.generation, bridge, difference);
  const reconstructedCandidate = candidateCarrierFromCanonicalQ9Rows(
    bridge,
    origin.generation.nodeDisplacements,
  );
  if (JSON.stringify(candidateCarrier) !== JSON.stringify(reconstructedCandidate)) {
    throw new Error('realization origin candidate geometry is not exactly reconstructed from generation');
  }
  const equivalenceCore = {
    domain:'parent-and-q9-canonical-current-position-displacements',
    initializedCarrierSha256:bridge.solverCarrier.identity.sha256,
    displacementRows:difference.displacementRows,
  };
  const expectedEquivalence = {
    ...equivalenceCore,
    sha256:hashAuthoredPackingCanonicalJson(equivalenceCore),
  };
  if (JSON.stringify(origin.equivalence) !== JSON.stringify(expectedEquivalence)) {
    throw new Error('realization origin physical equivalence identity mismatch');
  }
  requireHash(origin.identity?.sha256, 'realization origin');
  if (origin.identity.sha256 !== hashAuthoredPackingCanonicalJson(coreWithoutIdentity(origin))) {
    throw new Error('realization origin identity does not match effective payload');
  }
  return origin;
}

export function assertUniqueAuthoredPackingRealizationOrigins(origins) {
  if (!Array.isArray(origins) || origins.length === 0) {
    throw new Error('realization origin set must be a nonempty array');
  }
  const seen = new Map();
  for (const origin of origins) {
    requireHash(origin?.equivalence?.sha256, 'realization origin equivalence');
    const prior = seen.get(origin.equivalence.sha256);
    if (prior) {
      throw new Error(
        `duplicate physical realization origin: ${prior} and ${origin.generation?.basis?.id || 'unknown'}`,
      );
    }
    seen.set(origin.equivalence.sha256, origin.generation?.basis?.id || 'unknown');
  }
  return origins;
}

const COLLECTIVE_ORIGIN_MODE_IDS = Object.freeze([
  'contact-pressure-relief',
  'contact-slip-positive',
  'contact-slip-negative',
  'radial-breathing-relief',
]);

function addVectors(...vectors) {
  return [0, 1, 2].map(axis => vectors.reduce((sum, vector) => sum + vector[axis], 0));
}

function normalizeVectorOrNull(vector) {
  const magnitude = length(vector);
  return magnitude > 1e-12 ? scale(vector, 1 / magnitude) : null;
}

function projectPerpendicular(vector, axis) {
  return subtract(vector, scale(axis, dot(vector, axis)));
}

function averagePoints(points) {
  if (!Array.isArray(points) || points.length === 0) {
    throw new Error('collective origin geometry requires at least one point');
  }
  return [0, 1, 2].map(axis =>
    points.reduce((sum, point) => sum + point[axis], 0) / points.length
  );
}

function cageAxisNodes(cage) {
  return cage.manifest.nodes
    .filter(node => node.id.endsWith(':axis'))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function collectiveLongitudinalAxis(carrier) {
  const endpointDirections = carrier.cages.map(cage => {
    const axes = cageAxisNodes(cage);
    if (axes.length < 2) {
      throw new Error(`collective origin cage lacks a longitudinal axis: ${cage.constructionId}`);
    }
    return subtract(axes.at(-1).currentPosition, axes[0].currentPosition);
  });
  const reference = endpointDirections.reduce((longest, candidate) =>
    length(candidate) > length(longest) ? candidate : longest
  , [0, 0, 0]);
  const referenceDirection = normalizeVectorOrNull(reference);
  if (referenceDirection === null) {
    throw new Error('collective origin source has no nonzero longitudinal extent');
  }
  const aligned = endpointDirections.map(direction => {
    const normalized = normalizeVectorOrNull(direction);
    if (normalized === null) return [0, 0, 0];
    return dot(normalized, referenceDirection) < 0 ? scale(normalized, -1) : normalized;
  });
  return normalizeVectorOrNull(addVectors(...aligned)) ?? referenceDirection;
}

function collectivePressureDirections(carrier, residualLedger, longitudinalAxis) {
  const pressureByConstruction = new Map(
    carrier.orderedConstructionIds.map(constructionId => [constructionId, [0, 0, 0]]),
  );
  for (const contact of residualLedger.pairwise.contacts) {
    const rawEscape = subtract(contact.closestObstacleBoundaryPoint, contact.point);
    const crossSectionEscape = projectPerpendicular(rawEscape, longitudinalAxis);
    const direction = normalizeVectorOrNull(crossSectionEscape) ?? normalizeVectorOrNull(rawEscape);
    if (direction === null) continue;
    const weighted = scale(direction, contact.penetration);
    pressureByConstruction.set(
      contact.subjectConstructionId,
      addVectors(pressureByConstruction.get(contact.subjectConstructionId), weighted),
    );
    pressureByConstruction.set(
      contact.obstacleConstructionId,
      addVectors(pressureByConstruction.get(contact.obstacleConstructionId), scale(weighted, -1)),
    );
  }
  return new Map([...pressureByConstruction].map(([constructionId, pressure]) => [
    constructionId,
    normalizeVectorOrNull(projectPerpendicular(pressure, longitudinalAxis)),
  ]));
}

function collectiveRadialDirections(carrier, longitudinalAxis) {
  const allAxisPoints = carrier.cages.flatMap(cage =>
    cageAxisNodes(cage).map(node => node.currentPosition)
  );
  const center = averagePoints(allAxisPoints);
  return new Map(carrier.cages.map(cage => {
    const constructionCenter = averagePoints(cageAxisNodes(cage).map(node => node.currentPosition));
    const radial = projectPerpendicular(subtract(constructionCenter, center), longitudinalAxis);
    return [cage.constructionId, normalizeVectorOrNull(radial)];
  }));
}

function collectiveModeDirections({ carrier, residualLedger, longitudinalAxis, semanticId }) {
  const pressureDirections = collectivePressureDirections(
    carrier,
    residualLedger,
    longitudinalAxis,
  );
  if (semanticId === 'radial-breathing-relief') {
    return collectiveRadialDirections(carrier, longitudinalAxis);
  }
  return new Map([...pressureDirections].map(([constructionId, pressure]) => {
    if (pressure === null || semanticId === 'contact-pressure-relief') {
      return [constructionId, pressure];
    }
    const tangent = normalizeVectorOrNull(cross(longitudinalAxis, pressure));
    if (tangent === null) return [constructionId, pressure];
    const signedTangent = semanticId === 'contact-slip-positive'
      ? tangent
      : scale(tangent, -1);
    return [constructionId, normalizeVectorOrNull(addVectors(pressure, signedTangent))];
  }));
}

function collectiveModeNodeDisplacements({ carrier, directions, amplitude }) {
  const rows = [];
  for (const cage of carrier.cages) {
    const direction = directions.get(cage.constructionId);
    if (direction === null || direction === undefined) continue;
    const fixedNodeIds = new Set(cage.manifest.constraints.boundaryMasks
      .filter(row => row.fixed)
      .map(row => row.nodeId));
    const sectionIds = [...new Set(cage.manifest.nodes.map(node =>
      node.id.match(/:section:(\d{4}):/)?.[1]
    ).filter(Boolean))].sort();
    if (sectionIds.length < 3) continue;
    for (const [sectionIndex, sectionId] of sectionIds.entries()) {
      const phase = sectionIndex / (sectionIds.length - 1);
      const weight = Math.sin(Math.PI * phase);
      if (weight <= 1e-12) continue;
      const displacement = scale(direction, amplitude * weight);
      for (const node of cage.manifest.nodes.filter(row =>
        row.id.includes(`:section:${sectionId}:`) && !fixedNodeIds.has(row.id)
      )) {
        rows.push({
          constructionId:cage.constructionId,
          nodeId:node.id,
          displacement,
        });
      }
    }
  }
  return rows;
}

export function createAuthoredPackingCollectiveRealizationOriginFamily({
  bridge,
  expectedParent,
} = {}) {
  requireRealizationOriginBridge(bridge);
  const effectiveParent = requireRealizationOriginExpectedParent(expectedParent, bridge);
  const residualLedger = measureMuscleCompartmentRingCageContactResidualLedger(
    bridge.solverCarrier,
    bridge.source,
  );
  const maximumDisplacementAmplitude = residualLedger.pairwise.movableMaximumPenetration;
  const residualLedgerSha256 = hashAuthoredPackingCanonicalJson(residualLedger);
  const longitudinalAxis = collectiveLongitudinalAxis(bridge.solverCarrier);
  const candidates = [];
  const rejections = [];
  const seenEquivalence = new Map();

  for (const semanticId of COLLECTIVE_ORIGIN_MODE_IDS) {
    if (!(maximumDisplacementAmplitude > 0)) {
      rejections.push({
        semanticId,
        reason:'source-has-no-positive-movable-pairwise-penetration',
      });
      continue;
    }
    const directions = collectiveModeDirections({
      carrier:bridge.solverCarrier,
      residualLedger,
      longitudinalAxis,
      semanticId,
    });
    const nodeDisplacements = collectiveModeNodeDisplacements({
      carrier:bridge.solverCarrier,
      directions,
      amplitude:maximumDisplacementAmplitude,
    });
    if (nodeDisplacements.length === 0) {
      rejections.push({ semanticId, reason:'source-derived-mode-has-no-material-movable-node' });
      continue;
    }
    const origin = createAuthoredPackingRealizationOrigin({
      bridge,
      expectedParent,
      generationBasis: {
        schema:'kaminos.authored-packing-realization-origin-basis.v0',
        id:semanticId,
        authority:'source-derived-provisional-experimental',
        familySchema:AUTHORED_PACKING_COLLECTIVE_ORIGIN_FAMILY_SCHEMA,
        sourceCarrierSha256:bridge.solverCarrier.identity.sha256,
        residualLedgerSha256,
        maximumDisplacementAmplitude,
        amplitudeAuthority:'maximum-movable-pairwise-penetration',
        longitudinalAxis,
        longitudinalEnvelope:'endpoint-pinned-sine-half-wave',
        vertexPolicy:'translate-complete-ring-with-axis',
        randomness:'none',
      },
      coefficients:[1],
      nodeDisplacements,
    });
    const initialState = measureMuscleCompartmentRingCageContactState(
      origin.candidateCarrier,
      bridge.source,
    );
    const nonPositiveCellCount = initialState.cages.reduce(
      (total, cage) => total + cage.nonPositiveCellCount,
      0,
    );
    if (nonPositiveCellCount > 0) {
      rejections.push({
        semanticId,
        reason:'source-derived-origin-has-nonpositive-ring-cage-cell',
        attemptedOriginSha256:origin.identity.sha256,
        equivalenceSha256:origin.equivalence.sha256,
        nonPositiveCellCount,
      });
      continue;
    }
    const prior = seenEquivalence.get(origin.equivalence.sha256);
    if (prior) {
      rejections.push({
        semanticId,
        reason:'physically-duplicate-source-derived-origin',
        duplicateOf:prior,
        equivalenceSha256:origin.equivalence.sha256,
      });
      continue;
    }
    seenEquivalence.set(origin.equivalence.sha256, semanticId);
    candidates.push({
      semanticId,
      origin,
      admission: {
        nonPositiveCellCount,
        fixedNodeMaximumDrift:origin.difference.fixedNodeMaximumDrift,
        maximumPairwisePenetration:initialState.pairwise.maximumPenetration,
        maximumSkeletalPenetration:initialState.skeletal.maximumPenetration,
        maximumCompartmentEscape:initialState.compartment.maximumEscape,
        maximumRelativeVolumeError:Math.max(
          ...initialState.cages.map(cage => cage.relativeVolumeError),
        ),
        claim:'mechanically-initializable-origin-only-no-packing-benefit-claim',
      },
    });
  }

  const core = {
    schema:AUTHORED_PACKING_COLLECTIVE_ORIGIN_FAMILY_SCHEMA,
    parent:structuredClone(effectiveParent),
    source: {
      bridgeSha256:bridge.identity.sha256,
      initializedCarrierSha256:bridge.solverCarrier.identity.sha256,
      residualLedgerSchema:residualLedger.schema,
      residualLedgerSha256,
      maximumMovablePairwisePenetration:maximumDisplacementAmplitude,
    },
    directStart: {
      role:'unchanged-global-solver-control-not-a-realization-origin',
      carrierSha256:bridge.solverCarrier.identity.sha256,
    },
    derivation: {
      semanticModeIds:[...COLLECTIVE_ORIGIN_MODE_IDS],
      maximumDisplacementAmplitude,
      amplitudeAuthority:'maximum-movable-pairwise-penetration',
      longitudinalAxis,
      longitudinalEnvelope:'endpoint-pinned-sine-half-wave',
      vertexPolicy:'translate-complete-ring-with-axis',
      randomness:'none',
      basisReplayAuthority:'structural-lineage-only-no-admitted-basis-evaluator',
    },
    candidates,
    rejections,
    population: {
      definedSemanticCandidateCount:COLLECTIVE_ORIGIN_MODE_IDS.length,
      emittedCandidateCount:candidates.length,
      rejectedCandidateCount:rejections.length,
      arbitraryCandidateCap:null,
      mohelIndicator: {
        status:'nominal-explicit-semantic-enumeration',
        observedCandidateCount:candidates.length,
        permissiveGeneratorSuspected:false,
      },
    },
    route: {
      requested:'source-derived-low-frequency-collective-origins-v0',
      effective:'source-derived-low-frequency-collective-origins-v0',
      fallbackUsed:false,
    },
  };
  return { ...core, identity:{ sha256:hashAuthoredPackingCanonicalJson(core) } };
}

export function validateAuthoredPackingCollectiveRealizationOriginFamily({
  bridge,
  expectedParent,
  family,
} = {}) {
  if (family?.schema !== AUTHORED_PACKING_COLLECTIVE_ORIGIN_FAMILY_SCHEMA) {
    throw new Error('authored packing collective realization-origin family schema mismatch');
  }
  const expectedFamily = createAuthoredPackingCollectiveRealizationOriginFamily({
    bridge,
    expectedParent,
  });
  if (JSON.stringify(family) !== JSON.stringify(expectedFamily)) {
    throw new Error('collective realization-origin family deterministic source-derived replay mismatch');
  }
  return family;
}

function subtract(left, right) {
  return left.map((value, axis) => value - right[axis]);
}

function dot(left, right) {
  return left.reduce((sum, value, axis) => sum + value * right[axis], 0);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function length(value) {
  return Math.hypot(...value);
}

function scale(value, amount) {
  return value.map(row => row * amount);
}

function carrierTetrahedra(carrier, segmentIndex) {
  const leftIndices = new Set(carrier.rings[segmentIndex].vertexIndices);
  const rightIndices = new Set(carrier.rings[segmentIndex + 1].vertexIndices);
  const leftCenter = carrier.centerline[segmentIndex].position;
  const rightCenter = carrier.centerline[segmentIndex + 1].position;
  const sideFaces = carrier.mesh.polygons.filter(face =>
    face.length === 4 &&
    face.filter(index => leftIndices.has(index)).length === 2 &&
    face.filter(index => rightIndices.has(index)).length === 2);
  if (sideFaces.length !== carrier.rings[segmentIndex].vertexIndices.length) {
    throw new Error(`${carrier.id} segment ${segmentIndex} does not form a closed swept section`);
  }
  return sideFaces.flatMap(face => {
    const leftIds = face.filter(index => leftIndices.has(index));
    const pairedRightId = leftId => {
      const position = face.indexOf(leftId);
      const match = [
        face[(position + face.length - 1) % face.length],
        face[(position + 1) % face.length],
      ].find(index => rightIndices.has(index));
      if (match === undefined) throw new Error(`${carrier.id} side face lacks longitudinal correspondence`);
      return match;
    };
    const left = leftIds.map(index => carrier.mesh.vertices[index]);
    const right = leftIds.map(pairedRightId).map(index => carrier.mesh.vertices[index]);
    const vertices = [leftCenter, left[0], left[1], rightCenter, right[0], right[1]];
    return [
      [vertices[0], vertices[1], vertices[2], vertices[3]],
      [vertices[1], vertices[4], vertices[2], vertices[3]],
      [vertices[2], vertices[4], vertices[5], vertices[3]],
    ].map(row => ({
      vertices:row,
      faces:[[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]],
      edges:[[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]],
    }));
  });
}

function tetrahedronBounds(shape) {
  return [0, 1, 2].map(axis => ({
    minimum:Math.min(...shape.vertices.map(vertex => vertex[axis])),
    maximum:Math.max(...shape.vertices.map(vertex => vertex[axis])),
  }));
}

function aabbSignedGap(left, right) {
  return Math.max(...left.map((row, axis) => Math.max(
    right[axis].minimum - row.maximum,
    row.minimum - right[axis].maximum,
  )));
}

function faceNormal(shape, face) {
  const normal = cross(
    subtract(shape.vertices[face[1]], shape.vertices[face[0]]),
    subtract(shape.vertices[face[2]], shape.vertices[face[0]]),
  );
  const magnitude = length(normal);
  return magnitude > 1e-10 ? scale(normal, 1 / magnitude) : null;
}

function tetrahedronSatGap(left, right) {
  const axes = [
    ...left.faces.map(face => faceNormal(left, face)),
    ...right.faces.map(face => faceNormal(right, face)),
  ].filter(Boolean);
  for (const leftEdge of left.edges) {
    const leftDirection = subtract(left.vertices[leftEdge[1]], left.vertices[leftEdge[0]]);
    for (const rightEdge of right.edges) {
      const rightDirection = subtract(right.vertices[rightEdge[1]], right.vertices[rightEdge[0]]);
      const axis = cross(leftDirection, rightDirection);
      const magnitude = length(axis);
      if (magnitude > 1e-8) axes.push(scale(axis, 1 / magnitude));
    }
  }
  let maximumGap = -Infinity;
  for (const axis of axes) {
    const leftProjection = left.vertices.map(vertex => dot(vertex, axis));
    const rightProjection = right.vertices.map(vertex => dot(vertex, axis));
    maximumGap = Math.max(
      maximumGap,
      Math.min(...rightProjection) - Math.max(...leftProjection),
      Math.min(...leftProjection) - Math.max(...rightProjection),
    );
  }
  return maximumGap;
}

function tetrahedronCentroid(shape) {
  return [0, 1, 2].map(axis =>
    shape.vertices.reduce((sum, vertex) => sum + vertex[axis], 0) / shape.vertices.length
  );
}

function measureCarrierContact(left, right) {
  let maximumPenetration = 0;
  let nearestSeparatedAabbGap = Infinity;
  let witness = null;
  let narrowPhaseCandidateCount = 0;
  let tetrahedronComparisonCount = 0;
  const leftSegments = left.centerline.length - 1;
  const rightSegments = right.centerline.length - 1;
  for (let leftSegment = 0; leftSegment < leftSegments; leftSegment += 1) {
    const leftTetrahedra = carrierTetrahedra(left, leftSegment).map(shape => ({
      ...shape,
      bounds:tetrahedronBounds(shape),
    }));
    for (let rightSegment = 0; rightSegment < rightSegments; rightSegment += 1) {
      const rightTetrahedra = carrierTetrahedra(right, rightSegment).map(shape => ({
        ...shape,
        bounds:tetrahedronBounds(shape),
      }));
      for (let leftTetrahedron = 0; leftTetrahedron < leftTetrahedra.length; leftTetrahedron += 1) {
        for (let rightTetrahedron = 0; rightTetrahedron < rightTetrahedra.length; rightTetrahedron += 1) {
          tetrahedronComparisonCount += 1;
          const leftShape = leftTetrahedra[leftTetrahedron];
          const rightShape = rightTetrahedra[rightTetrahedron];
          const broadPhaseGap = aabbSignedGap(leftShape.bounds, rightShape.bounds);
          if (broadPhaseGap > 0) {
            nearestSeparatedAabbGap = Math.min(nearestSeparatedAabbGap, broadPhaseGap);
            continue;
          }
          narrowPhaseCandidateCount += 1;
          const signedGap = tetrahedronSatGap(leftShape, rightShape);
          if (signedGap < 0 && -signedGap > maximumPenetration) {
            maximumPenetration = -signedGap;
            witness = {
              leftSegment,
              rightSegment,
              leftTetrahedron,
              rightTetrahedron,
              leftPoint:tetrahedronCentroid(leftShape),
              rightPoint:tetrahedronCentroid(rightShape),
              signedGap,
            };
          }
        }
      }
    }
  }
  return {
    intersects:maximumPenetration > 1e-9,
    maximumPenetration:maximumPenetration,
    nearestSeparatedAabbGap:Number.isFinite(nearestSeparatedAabbGap)
      ? nearestSeparatedAabbGap
      : 0,
    witness,
    work:{ tetrahedronComparisonCount, narrowPhaseCandidateCount },
  };
}

function contactKey(left, right) {
  return [left, right].sort().join('|');
}

function measureVariantContacts({ manifestSha256, variant, meshTruthKeys = null, source = null }) {
  const pairRows = [];
  const boneRows = [];
  for (let leftIndex = 0; leftIndex < variant.members.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < variant.members.length; rightIndex += 1) {
      const left = variant.members[leftIndex];
      const right = variant.members[rightIndex];
      pairRows.push({
        key:contactKey(left.memberId, right.memberId),
        members:[left.memberId, right.memberId],
        ...measureCarrierContact(left, right),
      });
    }
    const member = variant.members[leftIndex];
    boneRows.push({
      key:contactKey('central-bone', member.memberId),
      memberId:member.memberId,
      ...measureCarrierContact(member, variant.bone),
    });
  }
  const effectiveMeshTruthKeys = meshTruthKeys === null
    ? null
    : [...meshTruthKeys].sort();
  const predictedKeys = [
    ...pairRows.filter(row => row.intersects).map(row => row.key),
    ...boneRows.filter(row => row.intersects).map(row => row.key),
  ].sort();
  const core = {
    schema:AUTHORED_PACKING_CONTACT_MEASUREMENT_SCHEMA,
    source:source ?? { manifestSha256, variantSha256:variant.identity.sha256 },
    variant:{ id:variant.id, role:variant.role },
    method: {
      decomposition:'ring-sweep-side-wedges-to-three-tetrahedra',
      broadPhase:'axis-aligned-tetrahedron-bounds',
      narrowPhase:'convex-tetrahedron-separating-axis-theorem',
      contactTolerance:1e-9,
    },
    pairRows,
    boneRows,
    summary: {
      pairwiseIntersectionCount:pairRows.filter(row => row.intersects).length,
      skeletalIntersectionCount:boneRows.filter(row => row.intersects).length,
      maximumPairwisePenetration:Math.max(0, ...pairRows.map(row => row.maximumPenetration)),
      maximumSkeletalPenetration:Math.max(0, ...boneRows.map(row => row.maximumPenetration)),
      meshTruthKeys:effectiveMeshTruthKeys,
      predictedKeys,
      meshTruthAgreement:effectiveMeshTruthKeys === null
        ? null
        : JSON.stringify(effectiveMeshTruthKeys) === JSON.stringify(predictedKeys),
    },
  };
  return { ...core, identity:{ sha256:hashAuthoredPackingCanonicalJson(core) } };
}

export function measureAuthoredPackingSweepContacts({ manifest, variantId } = {}) {
  validateAuthoredPackingSweepManifest(manifest);
  const variant = variantById(manifest, variantId);
  const meshTruthKeys = variant.meshContactTruth.surfaceOverlapRows.map(row =>
    contactKey(row.leftMemberId, row.rightMemberId));
  return measureVariantContacts({
    manifestSha256:manifest.identity.sha256,
    variant,
    meshTruthKeys,
  });
}

export function measureAuthoredPackingRingCageBridgeContacts({
  manifest,
  authorityProfile,
  solverCarrier,
  lineageBridge,
  expectedParent,
  lineageRoot,
} = {}) {
  validateCanonicalAuthoredPackingAuthorityProfile({ manifest, authorityProfile });
  if (solverCarrier?.schema !== 'kaminos.muscle-compartment-ring-cage-solver-carrier.v0') {
    throw new Error('authored bridge contact measurement requires a ring-cage solver carrier');
  }
  if (
    solverCarrier.sourceDocument?.schema !== AUTHORED_PACKING_RING_CAGE_BRIDGE_SCHEMA ||
    solverCarrier.sourceDocument?.sha256 !== authorityProfile.identity.sha256
  ) {
    throw new Error('authored bridge contact authority profile does not match solver carrier source document');
  }
  const { identity: _identity, ...identityDomain } = solverCarrier;
  const effectiveCarrierSha256 = hashMuscleCompartmentRingCageCanonicalJson(identityDomain);
  if (solverCarrier.identity?.sha256 !== effectiveCarrierSha256) {
    throw new Error('authored bridge contact solver carrier identity mismatch');
  }
  const lineageCarrier = requireAuthoredPackingContactCarrierLineage({
    authorityProfile,
    solverCarrier,
    lineageBridge,
    expectedParent,
    lineageRoot,
  });
  if (JSON.stringify(solverCarrier.orderedConstructionIds) !== JSON.stringify(manifest.memberOrder)) {
    throw new Error('authored bridge contact construction order mismatch');
  }
  const observed = structuredClone(variantById(
    manifest,
    authorityProfile.observedState.variantId,
  ));
  for (const [memberIndex, memberId] of manifest.memberOrder.entries()) {
    const cage = solverCarrier.cages[memberIndex];
    if (cage?.constructionId !== memberId) {
      throw new Error(`authored bridge contact cage identity mismatch at ${memberId}`);
    }
    const nodes = new Map(cage.manifest.nodes.map(node => [node.id, node]));
    const carrier = observed.members[memberIndex];
    for (let sectionIndex = 0; sectionIndex < carrier.rings.length; sectionIndex += 1) {
      const axisId = sectionNodeId(memberId, sectionIndex, 'axis');
      const axis = nodes.get(axisId);
      if (!axis) throw new Error(`authored bridge contact is missing ${axisId}`);
      carrier.centerline[sectionIndex].position = structuredClone(axis.currentPosition);
      for (const [radialIndex, vertexIndex] of carrier.rings[sectionIndex].vertexIndices.entries()) {
        const vertexId = sectionNodeId(
          memberId,
          sectionIndex,
          `vertex:${String(radialIndex).padStart(2, '0')}`,
        );
        const node = nodes.get(vertexId);
        if (!node) throw new Error(`authored bridge contact is missing ${vertexId}`);
        carrier.mesh.vertices[vertexIndex] = structuredClone(node.currentPosition);
      }
    }
  }
  observed.id = `${observed.id}:solver-carrier:${effectiveCarrierSha256.slice(0, 16)}`;
  delete observed.identity;
  return measureVariantContacts({
    manifestSha256:manifest.identity.sha256,
    variant:observed,
    source: {
      manifestSha256:manifest.identity.sha256,
      authorityProfileSha256:authorityProfile.identity.sha256,
      solverCarrierSha256:effectiveCarrierSha256,
      independentlyPreservedCarrierLineage: {
        bridgeSha256:lineageBridge.identity.sha256,
        root:lineageRoot,
        rootCarrierSha256:lineageCarrier.identity.sha256,
        observedCarrierSha256:expectedParent.observedCarrierSha256,
        initializedCarrierSha256:expectedParent.initializedCarrierSha256,
        authorityProfileSha256:expectedParent.authorityProfile.sha256,
        initializationSha256:expectedParent.initializationSha256,
      },
      meshTruthAuthority:'unavailable-for-deformed-or-hybrid-candidate',
    },
  });
}

function requireAuthoredPackingTrajectoryMaximumIterations(maximumIterations) {
  if (!Number.isInteger(maximumIterations) || maximumIterations <= 0) {
    throw new Error('authored packing trajectory maximumIterations must be a positive integer');
  }
  return maximumIterations;
}

function createAuthoredPackingTrajectorySolverContract({ bridge, maximumIterations }) {
  requireRealizationOriginBridge(bridge);
  requireAuthoredPackingTrajectoryMaximumIterations(maximumIterations);
  const sourceInitial = measureMuscleCompartmentRingCageContactState(
    bridge.solverCarrier,
    bridge.source,
  );
  const inheritedMaximumVolumeDebt = Math.max(
    ...sourceInitial.cages.map(row => row.relativeVolumeError),
  );
  const volumeDebtTolerance = 1e-6;
  const exactBoneTolerance = 1e-9;
  return {
    config: {
      curvatureRegularization:12,
      maxIterations:maximumIterations,
      maximumLocalTurningAngleChange:0.35,
      relaxationStep:0.2,
      maximumTotalTurningAngleChange:1.5,
      convergenceTolerance:1e-4,
      maximumRelativeVolumeError:inheritedMaximumVolumeDebt + volumeDebtTolerance,
    },
    gates: {
      inheritedMaximumVolumeDebt,
      volumeDebtTolerance,
      exactBoneTolerance,
      exactBoneNonincrease:true,
      fixedAttachments:true,
      positiveCells:true,
    },
  };
}

function runAuthoredPackingTrajectoryFromAuthenticatedCarrier({
  manifest,
  authorityProfile,
  bridge,
  expectedParent,
  initialCarrier,
  solverContract,
} = {}) {
  validateCanonicalAuthoredPackingAuthorityProfile({ manifest, authorityProfile });
  requireRealizationOriginBridge(bridge);
  requireRealizationOriginExpectedParent(expectedParent, bridge);
  if (!solverContract?.config || !solverContract?.gates) {
    throw new Error('authored packing trajectory requires one explicit shared solver contract');
  }
  const initialExact = measureAuthoredPackingRingCageBridgeContacts({
    manifest,
    authorityProfile,
    solverCarrier:initialCarrier,
    lineageBridge:bridge,
    expectedParent,
    lineageRoot:'initialized-descendant',
  });
  const observedExact = measureAuthoredPackingRingCageBridgeContacts({
    manifest,
    authorityProfile,
    solverCarrier:bridge.observedCarrier,
    lineageBridge:bridge,
    expectedParent,
    lineageRoot:'observed',
  });
  const config = structuredClone(solverContract.config);
  const gates = structuredClone(solverContract.gates);
  const result = solveMuscleCompartmentRingCageContact(
    initialCarrier,
    bridge.source,
    config,
    { stepConstraint:candidate => {
      const candidateExact = measureAuthoredPackingRingCageBridgeContacts({
        manifest,
        authorityProfile,
        solverCarrier:candidate,
        lineageBridge:bridge,
        expectedParent,
        lineageRoot:'initialized-descendant',
      });
      const violation = candidateExact.summary.maximumSkeletalPenetration >
        initialExact.summary.maximumSkeletalPenetration + gates.exactBoneTolerance
        ? 'exact-authored-bone-penetration-increase'
        : null;
      return {
        violation,
        receipt: {
          schema:'kaminos.authored-packing-accepted-step-receipt.v0',
          exactContact:candidateExact,
        },
      };
    } },
  );
  const packedExact = measureAuthoredPackingRingCageBridgeContacts({
    manifest,
    authorityProfile,
    solverCarrier:result.packedCarrier,
    lineageBridge:bridge,
    expectedParent,
    lineageRoot:'initialized-descendant',
  });
  return {
    schema:AUTHORED_PACKING_TRAJECTORY_ASSAY_SCHEMA,
    authorityProfile,
    bridge,
    config,
    gates,
    result,
    exact:{
      observed:observedExact,
      initialized:initialExact,
      initial:initialExact,
      packed:packedExact,
    },
  };
}

export function runAuthoredPackingTrajectoryAssay({
  manifest,
  observedVariantId,
  intentVariantId,
  policy,
  maximumIterations = 8,
} = {}) {
  requireAuthoredPackingTrajectoryMaximumIterations(maximumIterations);
  const authorityProfile = createAuthoredPackingAuthorityProfile({
    manifest,
    observedVariantId,
    intentVariantId,
    policy,
  });
  const bridge = createAuthoredPackingRingCageBridge({ manifest, authorityProfile });
  const expectedParent = createAuthoredPackingRealizationOriginParentEnvelope({ bridge });
  const solverContract = createAuthoredPackingTrajectorySolverContract({
    bridge,
    maximumIterations,
  });
  return runAuthoredPackingTrajectoryFromAuthenticatedCarrier({
    manifest,
    authorityProfile,
    bridge,
    expectedParent,
    initialCarrier:bridge.solverCarrier,
    solverContract,
  });
}

export function runAuthoredPackingCollectiveTrajectoryAssay({
  manifest,
  observedVariantId,
  intentVariantId,
  policy,
  maximumIterations = 8,
} = {}) {
  requireAuthoredPackingTrajectoryMaximumIterations(maximumIterations);
  const authorityProfile = createAuthoredPackingAuthorityProfile({
    manifest,
    observedVariantId,
    intentVariantId,
    policy,
  });
  const bridge = createAuthoredPackingRingCageBridge({ manifest, authorityProfile });
  const expectedParent = createAuthoredPackingRealizationOriginParentEnvelope({ bridge });
  const family = createAuthoredPackingCollectiveRealizationOriginFamily({
    bridge,
    expectedParent,
  });
  validateAuthoredPackingCollectiveRealizationOriginFamily({
    bridge,
    expectedParent,
    family,
  });
  const solverContract = createAuthoredPackingTrajectorySolverContract({
    bridge,
    maximumIterations,
  });
  const directTrajectory = runAuthoredPackingTrajectoryFromAuthenticatedCarrier({
    manifest,
    authorityProfile,
    bridge,
    expectedParent,
    initialCarrier:bridge.solverCarrier,
    solverContract,
  });
  const candidateBySemanticId = new Map(
    family.candidates.map(candidate => [candidate.semanticId, candidate]),
  );
  const rejectionBySemanticId = new Map(
    family.rejections.map(rejection => [rejection.semanticId, rejection]),
  );
  const candidates = family.derivation.semanticModeIds.map(semanticId => {
    const sourceCandidate = candidateBySemanticId.get(semanticId);
    if (!sourceCandidate) {
      const rejection = rejectionBySemanticId.get(semanticId);
      if (!rejection) {
        throw new Error(`collective trajectory family omitted semantic mode ${semanticId}`);
      }
      return {
        semanticId,
        role:'source-derived-realization-origin',
        status:'source-rejected',
        originSha256:rejection.attemptedOriginSha256 ?? null,
        initialCarrierSha256:null,
        trajectory:null,
        failure:null,
        rejection:structuredClone(rejection),
      };
    }
    validateAuthoredPackingRealizationOrigin({
      bridge,
      expectedParent,
      origin:sourceCandidate.origin,
    });
    try {
      const trajectory = runAuthoredPackingTrajectoryFromAuthenticatedCarrier({
        manifest,
        authorityProfile,
        bridge,
        expectedParent,
        initialCarrier:sourceCandidate.origin.candidateCarrier,
        solverContract,
      });
      return {
        semanticId,
        role:'source-derived-realization-origin',
        status:'completed',
        originSha256:sourceCandidate.origin.identity.sha256,
        initialCarrierSha256:sourceCandidate.origin.candidateCarrier.identity.sha256,
        trajectory,
        failure:null,
        rejection:null,
      };
    } catch (error) {
      return {
        semanticId,
        role:'source-derived-realization-origin',
        status:'solver-failed',
        originSha256:sourceCandidate.origin.identity.sha256,
        initialCarrierSha256:sourceCandidate.origin.candidateCarrier.identity.sha256,
        trajectory:null,
        failure: {
          phase:'unchanged-global-solver-trajectory',
          error:error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        },
        rejection:null,
      };
    }
  });
  const completedCandidateCount = candidates.filter(row => row.status === 'completed').length;
  const sourceRejectedCandidateCount = candidates.filter(
    row => row.status === 'source-rejected',
  ).length;
  const solverFailedCandidateCount = candidates.filter(
    row => row.status === 'solver-failed',
  ).length;
  return {
    schema:AUTHORED_PACKING_COLLECTIVE_TRAJECTORY_ASSAY_SCHEMA,
    authorityProfile,
    bridge,
    expectedParent,
    family,
    solverContract,
    directStart: {
      semanticId:'direct-start',
      role:family.directStart.role,
      status:'completed',
      originSha256:null,
      initialCarrierSha256:bridge.solverCarrier.identity.sha256,
      trajectory:directTrajectory,
      failure:null,
      rejection:null,
    },
    candidates,
    population: {
      definedCandidateCount:family.population.definedSemanticCandidateCount,
      completedCandidateCount,
      sourceRejectedCandidateCount,
      solverFailedCandidateCount,
      arbitraryCandidateCap:null,
    },
    route: {
      requested:'collective-origin-family-through-unchanged-global-solver-v0',
      effective:'collective-origin-family-through-unchanged-global-solver-v0',
      fallbackUsed:false,
    },
    selection: {
      status:'not-performed',
      reason:'raw-multi-candidate-frontier-requires-comparative-and-operator-visual-disposition',
    },
    claimCeiling:'raw-shared-solver-trajectories-only-no-candidate-benefit-or-architecture-selection',
  };
}

export function runAuthoredPackingOneStepAssay(args = {}) {
  return {
    ...runAuthoredPackingTrajectoryAssay({ ...args, maximumIterations:1 }),
    schema:AUTHORED_PACKING_ONE_STEP_ASSAY_SCHEMA,
  };
}

export function cleanReferenceVariant(manifest) {
  validateAuthoredPackingSweepManifest(manifest);
  return variantByRole(manifest, 'clean-reference');
}
