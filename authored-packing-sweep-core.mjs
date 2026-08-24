import { createHash } from 'node:crypto';

import {
  hashMuscleCompartmentRingCageCanonicalJson,
} from './muscle-compartment-ring-cage-core.mjs';
import {
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
    if (!Number.isFinite(value)) throw new Error('identity basis cannot contain a non-finite number');
    const quantized = Math.sign(value) * Math.floor(Math.abs(value) * IDENTITY_QUANTIZATION + 0.5);
    if (!Number.isSafeInteger(quantized)) {
      throw new Error(`identity basis number exceeds safe quantization range: ${value}`);
    }
    return ['$number-q9', String(quantized)];
  }
  if (Array.isArray(value)) return value.map(identityBasis);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, identityBasis(value[key])]));
  }
  return value;
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

function bridgeCage({ memberId, observed, intent, sourceIdentity }) {
  if (!sameTopology(observed, intent)) {
    throw new Error(`${memberId} observed and intent variants do not share exact sweep topology`);
  }
  const nodeById = new Map();
  const nodes = [];
  const boundaryMasks = [];
  const sectionCount = intent.rings.length;
  const currentCarrierForSection = sectionIndex =>
    sectionIndex === 0 || sectionIndex === sectionCount - 1 ? intent : observed;
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
  validateAuthoredPackingSweepManifest(manifest);
  if (authorityProfile?.schema !== AUTHORED_PACKING_AUTHORITY_PROFILE_SCHEMA) {
    throw new Error('authored packing ring-cage bridge requires an authority profile');
  }
  if (authorityProfile.source?.manifestSha256 !== manifest.identity.sha256) {
    throw new Error('authored packing ring-cage bridge manifest/profile identity mismatch');
  }
  const observedVariant = variantById(manifest, authorityProfile.observedState.variantId);
  const intentVariant = variantById(manifest, authorityProfile.intentState.variantId);
  const identities = new Map(manifest.memberOrder.map(memberId => [memberId, {
    sourceId:`${manifest.identity.sha256}:${memberId}`,
    constructionId:memberId,
    lineageId:`${manifest.id}:${memberId}`,
    instanceId:`${observedVariant.id}:${memberId}`,
  }]));
  const cages = manifest.memberOrder.map((memberId, index) => bridgeCage({
    memberId,
    observed:observedVariant.members[index],
    intent:intentVariant.members[index],
    sourceIdentity:identities.get(memberId),
  }));
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
  const solverCarrierCore = {
    schema:'kaminos.muscle-compartment-ring-cage-solver-carrier.v0',
    sourceDocument: {
      schema:AUTHORED_PACKING_RING_CAGE_BRIDGE_SCHEMA,
      sha256:authorityProfile.identity.sha256,
    },
    orderedConstructionIds:[...manifest.memberOrder],
    cages,
  };
  const solverCarrier = {
    ...solverCarrierCore,
    identity: {
      domain:'canonical-json-self-excluding-top-level-identity',
      sha256:hashMuscleCompartmentRingCageCanonicalJson(solverCarrierCore),
    },
  };
  return {
    schema:AUTHORED_PACKING_RING_CAGE_BRIDGE_SCHEMA,
    source,
    solverCarrier,
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
} = {}) {
  validateAuthoredPackingSweepManifest(manifest);
  if (authorityProfile?.schema !== AUTHORED_PACKING_AUTHORITY_PROFILE_SCHEMA ||
      authorityProfile.source?.manifestSha256 !== manifest.identity.sha256) {
    throw new Error('authored bridge contact measurement requires the matching authority profile');
  }
  if (solverCarrier?.schema !== 'kaminos.muscle-compartment-ring-cage-solver-carrier.v0') {
    throw new Error('authored bridge contact measurement requires a ring-cage solver carrier');
  }
  const { identity: _identity, ...identityDomain } = solverCarrier;
  const effectiveCarrierSha256 = hashMuscleCompartmentRingCageCanonicalJson(identityDomain);
  if (solverCarrier.identity?.sha256 !== effectiveCarrierSha256) {
    throw new Error('authored bridge contact solver carrier identity mismatch');
  }
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
      meshTruthAuthority:'unavailable-for-deformed-or-hybrid-candidate',
    },
  });
}

export function runAuthoredPackingTrajectoryAssay({
  manifest,
  observedVariantId,
  intentVariantId,
  policy,
  maximumIterations = 8,
} = {}) {
  if (!Number.isInteger(maximumIterations) || maximumIterations <= 0) {
    throw new Error('authored packing trajectory maximumIterations must be a positive integer');
  }
  const authorityProfile = createAuthoredPackingAuthorityProfile({
    manifest,
    observedVariantId,
    intentVariantId,
    policy,
  });
  const bridge = createAuthoredPackingRingCageBridge({ manifest, authorityProfile });
  const initial = measureMuscleCompartmentRingCageContactState(
    bridge.solverCarrier,
    bridge.source,
  );
  const initialExact = measureAuthoredPackingRingCageBridgeContacts({
    manifest,
    authorityProfile,
    solverCarrier:bridge.solverCarrier,
  });
  const inheritedMaximumVolumeDebt = Math.max(
    ...initial.cages.map(row => row.relativeVolumeError),
  );
  const volumeDebtTolerance = 1e-6;
  const exactBoneTolerance = 1e-9;
  const config = {
    curvatureRegularization:12,
    maxIterations:maximumIterations,
    maximumLocalTurningAngleChange:0.35,
    relaxationStep:0.2,
    maximumTotalTurningAngleChange:1.5,
    convergenceTolerance:1e-4,
    maximumRelativeVolumeError:inheritedMaximumVolumeDebt + volumeDebtTolerance,
  };
  const result = solveMuscleCompartmentRingCageContact(
    bridge.solverCarrier,
    bridge.source,
    config,
    { stepConstraint:candidate => {
      const candidateExact = measureAuthoredPackingRingCageBridgeContacts({
        manifest,
        authorityProfile,
        solverCarrier:candidate,
      });
      return candidateExact.summary.maximumSkeletalPenetration >
        initialExact.summary.maximumSkeletalPenetration + exactBoneTolerance
        ? 'exact-authored-bone-penetration-increase'
        : null;
    } },
  );
  const packedExact = measureAuthoredPackingRingCageBridgeContacts({
    manifest,
    authorityProfile,
    solverCarrier:result.packedCarrier,
  });
  return {
    schema:AUTHORED_PACKING_TRAJECTORY_ASSAY_SCHEMA,
    authorityProfile,
    bridge,
    config,
    gates: {
      inheritedMaximumVolumeDebt,
      volumeDebtTolerance,
      exactBoneTolerance,
      exactBoneNonincrease:true,
      fixedAttachments:true,
      positiveCells:true,
    },
    result,
    exact:{ initial:initialExact, packed:packedExact },
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
