import {
  createSmoothFittedProxyRigBinding,
  createSmoothFittedProxyRigProbeBinding,
  evaluateSmoothFittedProxyRigContactPhase,
  evaluateSmoothFittedProxyRigPhase,
} from './lirm-reference-fitted-armature-core.mjs';
import {
  createMotionContactProbeRequest,
  resolveMotionContactConstraints,
} from './motion-support-core.js';

export const STATIONARY_HILL_CONTACT_ROUTE = 'kaminos/lirm-719024/stationary-hill-smooth-contact-v0';
export const STATIONARY_HILL_PUBLISHED_CONTACT_ROUTE = 'kaminos/lirm-719024/published-stationary-contact-v0';
export const STATIONARY_CONTACT_RECEIPT_SHA256 = 'sha256:2c5a33f6334308e5b410f465119dceea0ddf656f9d68061054542b70f1503925';
export const STATIONARY_CONTACT_CONSTRAINTS_SHA256 = 'sha256:77a8e0f795791956ceb34a17da397865ea0a7504f98542de1e6b0529e66f72fb';
const VERIFIED_STATIONARY_CONTACT_PUBLICATION = Symbol('verified stationary contact publication');
const STATIONARY_CONTACT_PATCH_IDS = Object.freeze([
  'front-left',
  'front-right',
  'rear-left',
  'rear-right',
]);

function bytesOf(value, label) {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error(`${label} must be exact bytes or text`);
}

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 verifier is unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

function parseJsonBytes(bytes, label) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export async function verifyPublishedStationaryContactArtifacts({
  constraintsBytes,
  receiptBytes,
} = {}) {
  const exactConstraintsBytes = bytesOf(constraintsBytes, 'stationary contact constraints');
  const exactReceiptBytes = bytesOf(receiptBytes, 'stationary contact receipt');
  const [constraintsSha256, receiptSha256] = await Promise.all([
    sha256(exactConstraintsBytes),
    sha256(exactReceiptBytes),
  ]);
  if (constraintsSha256 !== STATIONARY_CONTACT_CONSTRAINTS_SHA256) {
    throw new Error(`stationary contact constraints hash mismatch: ${constraintsSha256}`);
  }
  if (receiptSha256 !== STATIONARY_CONTACT_RECEIPT_SHA256) {
    throw new Error(`stationary contact receipt hash mismatch: ${receiptSha256}`);
  }
  const constraints = deepFreeze(
    parseJsonBytes(exactConstraintsBytes, 'stationary contact constraints'),
  );
  const receipt = deepFreeze(
    parseJsonBytes(exactReceiptBytes, 'stationary contact receipt'),
  );
  const publication = {
    constraints,
    constraintsSha256,
    receipt,
    receiptSha256,
  };
  Object.defineProperty(publication, VERIFIED_STATIONARY_CONTACT_PUBLICATION, {
    value: true,
    enumerable: false,
  });
  return Object.freeze(publication);
}

function requireVector3(value, label) {
  if (!Array.isArray(value) || value.length !== 3
      || value.some(component => !Number.isFinite(Number(component)))) {
    throw new Error(`${label} must be a finite vec3`);
  }
  return value.map(Number);
}

function requireNormalization(normalization) {
  const center = requireVector3(normalization?.center, 'support normalization center');
  const scale = Number(normalization?.scale);
  if (!(scale > 0)) throw new Error('support normalization scale must be positive');
  return { center, scale };
}

function sourceScaledPoint(point, normalization, bodyScale) {
  return {
    x: (point.x / normalization.scale + normalization.center[0]) * bodyScale,
    y: (point.y / normalization.scale + normalization.center[1]) * bodyScale,
    z: (point.z / normalization.scale + normalization.center[2]) * bodyScale,
  };
}

export function createSupportPlacedFittedRig({
  normalizedPositions,
  registration,
  normalization,
  bodyScale,
  contactAtlas,
  contactAtlasSha256,
  sampleCount = 192,
} = {}) {
  const exactNormalization = requireNormalization(normalization);
  const exactBodyScale = Number(bodyScale);
  if (!(exactBodyScale > 0)) throw new Error('support body scale must be positive');
  if (!normalizedPositions || normalizedPositions.length % 3 !== 0) {
    throw new Error('support placed fitted rig requires packed normalized positions');
  }
  const bodyPositions = Float64Array.from(normalizedPositions, (value, index) => (
    (Number(value) / exactNormalization.scale + exactNormalization.center[index % 3])
      * exactBodyScale
  ));
  const bodyRegistration = {
    ...structuredClone(registration),
    stations: registration.stations.map(station => ({
      ...station,
      position: sourceScaledPoint(station.position, exactNormalization, exactBodyScale),
      radius: station.radius ? {
        x: station.radius.x / exactNormalization.scale * exactBodyScale,
        y: station.radius.y / exactNormalization.scale * exactBodyScale,
        z: station.radius.z / exactNormalization.scale * exactBodyScale,
      } : station.radius,
    })),
  };
  const binding = createSmoothFittedProxyRigBinding({
    positions: bodyPositions,
    registration: bodyRegistration,
    sampleCount,
  });
  const probeBinding = createSmoothFittedProxyRigProbeBinding({
    binding,
    contactAtlas,
    contactAtlasSha256,
  });
  return {
    schema: 'kaminos.lirm-support-placed-fitted-rig.v0',
    normalization: exactNormalization,
    bodyScale: exactBodyScale,
    binding,
    probeBinding,
  };
}

export function createSupportRootFrame({ prepass, contactPlaneY } = {}) {
  if (prepass?.schema !== 'kaminos.motion-support-prepass.v0') {
    throw new Error('support root frame requires a motion support prepass');
  }
  const rootSurface = requireVector3(prepass.rootSurface, 'support root surface');
  const forward = requireVector3(prepass.frame?.forward, 'support forward');
  const right = requireVector3(prepass.frame?.right, 'support right');
  const up = requireVector3(prepass.frame?.up, 'support up');
  const bodyScale = Number(prepass.body?.scale);
  const rootLift = Number(prepass.support?.rootLift);
  const plane = Number(contactPlaneY);
  if (!(bodyScale > 0) || !Number.isFinite(rootLift) || !Number.isFinite(plane)) {
    throw new Error('support root frame requires finite body scale, root lift, and contact plane');
  }
  const origin = rootSurface.map(
    (value, axis) => value + up[axis] * (rootLift - plane * bodyScale),
  );
  return {
    schema: 'kaminos.creature-root-frame.v0',
    origin: { x: origin[0], y: origin[1], z: origin[2] },
    lateral: { x: right[0], y: right[1], z: right[2] },
    normal: { x: up[0], y: up[1], z: up[2] },
    tangent: { x: -forward[0], y: -forward[1], z: -forward[2] },
  };
}

export function createProbeSetFromFittedPhase({ request, packet } = {}) {
  if (request?.schema !== 'kaminos.motion-contact-probe-request.v0') {
    throw new Error('fitted phase probe set requires a contact probe request');
  }
  const probesById = new Map(packet?.probes?.map(probe => [probe.id, probe]) ?? []);
  const patches = request.patches.map(patch => {
    const probe = probesById.get(patch.id);
    if (!probe) throw new Error(`fitted phase packet is missing requested patch ${patch.id}`);
    return { id: patch.id, worldPosition: [...probe.worldPosition] };
  });
  return {
    schema: 'kaminos.motion-contact-probe-set.v0',
    requestId: request.id,
    prepassId: request.prepassId,
    supportSurface: structuredClone(request.supportSurface),
    body: structuredClone(request.body),
    contactAtlas: structuredClone(request.contactAtlas),
    poseId: request.poseId,
    phase: request.phase,
    patches,
  };
}

function requireExactPublishedStationaryContact({
  placedRig,
  prepass,
  publication,
} = {}) {
  if (publication?.[VERIFIED_STATIONARY_CONTACT_PUBLICATION] !== true) {
    throw new Error('stationary contact application requires verified publication bytes');
  }
  const { constraints, constraintsSha256, receipt, receiptSha256 } = publication ?? {};
  if (receiptSha256 !== STATIONARY_CONTACT_RECEIPT_SHA256) {
    throw new Error(`stationary contact receipt hash mismatch: ${receiptSha256}`);
  }
  if (constraintsSha256 !== STATIONARY_CONTACT_CONSTRAINTS_SHA256) {
    throw new Error(`stationary contact constraints hash mismatch: ${constraintsSha256}`);
  }
  if (receipt?.schema !== 'kaminos.motion-contact-constraints-artifact-receipt.v0'
      || receipt.status !== 'pass'
      || receipt.failurePhase !== null
      || receipt.output?.constraintsSha256 !== STATIONARY_CONTACT_CONSTRAINTS_SHA256.slice(7)) {
    throw new Error('stationary contact receipt is not the reviewed publication marker');
  }
  if (constraints?.schema !== 'kaminos.motion-contact-constraints.v0'
      || constraints.id !== 'stationary-hill-probes:C:constraints'
      || constraints.authority !== 'world-space-contact-resolution'
      || constraints.poseId !== 'molten-low-frequency:C'
      || constraints.phase !== 1.3) {
    throw new Error('stationary contact constraints identity mismatch');
  }
  if (constraints.requestId !== 'stationary-hill-probes:C'
      || constraints.prepassId !== prepass?.id
      || constraints.body?.id !== prepass?.body?.id
      || constraints.body?.registrationId !== prepass?.body?.registrationId
      || constraints.body?.scale !== prepass?.body?.scale) {
    throw new Error('stationary contact request, prepass, or body identity mismatch');
  }
  if (constraints.supportSurface?.revision !== '81c5348'
      || constraints.supportSurface?.sourceRef
        !== 'lerms:cc/hill-of-hills-live-terrain-server-0702@81c5348') {
    throw new Error('stationary contact support identity mismatch');
  }
  if (constraints.contactAtlas?.castHash
        !== placedRig?.probeBinding?.sourceCastSha256?.slice('sha256:'.length)
      || constraints.contactAtlas?.registrationHash
        !== placedRig?.probeBinding?.contactAtlasRegistrationHash
      || constraints.contactAtlas?.sha256
        !== placedRig?.probeBinding?.contactAtlasSha256) {
    throw new Error('stationary contact atlas identity mismatch');
  }
  if (!Array.isArray(constraints.patches)
      || constraints.patches.length !== STATIONARY_CONTACT_PATCH_IDS.length
      || constraints.patches.some((patch, index) => (
        patch.id !== STATIONARY_CONTACT_PATCH_IDS[index]
        || !Number.isFinite(patch.signedDistance)
      ))) {
    throw new Error('stationary contact patch order or signed-distance identity mismatch');
  }
  return constraints;
}

export function evaluatePublishedStationaryContactPhase({
  placedRig,
  prepass,
  publication,
  bodyPhase = 0,
  amplitude = 0.18,
  contactPlaneY,
  includeBaseline = false,
  clearance = 0.008,
  correctionGain = 0.82,
  maximumCorrection = 0.18,
  iterationCount = 3,
} = {}) {
  if (placedRig?.schema !== 'kaminos.lirm-support-placed-fitted-rig.v0') {
    throw new Error('published stationary contact evaluation requires a support-placed fitted rig');
  }
  const constraints = requireExactPublishedStationaryContact({ placedRig, prepass, publication });
  const normalizedPhase = ((Number(bodyPhase) % 1) + 1) % 1;
  const rootFrame = createSupportRootFrame({ prepass, contactPlaneY });
  const baseline = includeBaseline ? evaluateSmoothFittedProxyRigPhase({
    binding: placedRig.binding,
    probeBinding: placedRig.probeBinding,
    phase: normalizedPhase,
    amplitude,
    rootFrame,
  }) : null;
  const realized = evaluateSmoothFittedProxyRigContactPhase({
    binding: placedRig.binding,
    probeBinding: placedRig.probeBinding,
    phase: normalizedPhase,
    amplitude,
    rootFrame,
    constraints,
    clearance,
    correctionGain,
    maximumCorrection,
    iterationCount,
  });
  return {
    schema: 'kaminos.lirm-published-stationary-contact-packet.v0',
    requestedRoute: STATIONARY_HILL_PUBLISHED_CONTACT_ROUTE,
    effectiveRoute: STATIONARY_HILL_PUBLISHED_CONTACT_ROUTE,
    phase: normalizedPhase,
    publication: {
      receiptSha256: publication.receiptSha256,
      constraintsSha256: publication.constraintsSha256,
      constraintsId: constraints.id,
      poseId: constraints.poseId,
      constraintPhase: constraints.phase,
    },
    rootFrame,
    baseline,
    constraints,
    realized,
  };
}

export function evaluateStationaryHillContactPhase({
  placedRig,
  supportSurface,
  prepass,
  contactAtlas,
  phase = 0,
  amplitude = 0.18,
  contactPlaneY,
  clearance = 0.008,
  correctionGain = 0.82,
  maximumCorrection = 0.18,
  iterationCount = 3,
} = {}) {
  if (placedRig?.schema !== 'kaminos.lirm-support-placed-fitted-rig.v0') {
    throw new Error('stationary Hill contact evaluation requires a support-placed fitted rig');
  }
  const normalizedPhase = ((Number(phase) % 1) + 1) % 1;
  const radians = normalizedPhase * Math.PI * 2;
  const poseId = `molten-smooth-fitted:${normalizedPhase.toFixed(9)}`;
  const request = createMotionContactProbeRequest(prepass, contactAtlas, {
    id: `stationary-hill-probes:${normalizedPhase.toFixed(9)}`,
    phase: radians,
    poseId,
    contactAtlasSha256: placedRig.probeBinding.contactAtlasSha256,
  });
  const rootFrame = createSupportRootFrame({ prepass, contactPlaneY });
  const baseline = evaluateSmoothFittedProxyRigPhase({
    binding: placedRig.binding,
    probeBinding: placedRig.probeBinding,
    phase: normalizedPhase,
    amplitude,
    rootFrame,
  });
  const probeSet = createProbeSetFromFittedPhase({ request, packet: baseline });
  const constraints = resolveMotionContactConstraints(
    supportSurface,
    prepass,
    request,
    probeSet,
  );
  const realized = evaluateSmoothFittedProxyRigContactPhase({
    binding: placedRig.binding,
    probeBinding: placedRig.probeBinding,
    phase: normalizedPhase,
    amplitude,
    rootFrame,
    constraints,
    clearance,
    correctionGain,
    maximumCorrection,
    iterationCount,
  });
  return {
    schema: 'kaminos.lirm-stationary-hill-contact-packet.v0',
    requestedRoute: STATIONARY_HILL_CONTACT_ROUTE,
    effectiveRoute: STATIONARY_HILL_CONTACT_ROUTE,
    phase: normalizedPhase,
    rootFrame,
    request,
    baseline,
    probeSet,
    constraints,
    realized,
  };
}
