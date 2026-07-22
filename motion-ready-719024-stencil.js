export const ORACLE_STENCIL_SCHEMA = 'kaminos.oracle-mechanical-stencil.v0';
export const ORACLE_STENCIL_BINDING_SCHEMA = 'kaminos.oracle-mechanical-stencil-binding.v0';
export const ORACLE_STENCIL_AUTHORITY = 'operator-authored-rest-space-semantics';

const REGION_KINDS = new Set([
  'body-axis',
  'appendage-chain',
  'contact-patch',
  'preservation-region',
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function point3(value, label) {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must contain three coordinates`);
  return value.map((coordinate, index) => finiteNumber(coordinate, `${label}[${index}]`));
}

function positiveRadius(value, label) {
  const radius = finiteNumber(value, label);
  if (radius <= 0) throw new Error(`${label} must be positive`);
  return radius;
}

function normalizeRegion(region, index) {
  const id = assertString(region?.id, `region ${index} id`);
  const kind = assertString(region?.kind, `${id} kind`);
  if (!REGION_KINDS.has(kind)) throw new Error(`${id} has unsupported region kind ${kind}`);
  const label = assertString(region?.label, `${id} label`);
  if (!Array.isArray(region.points)) throw new Error(`${id} points must be an array`);
  const points = region.points.map((point, pointIndex) => point3(point, `${id} point ${pointIndex}`));
  if (!Array.isArray(region.radii)) throw new Error(`${id} radii must be an array`);

  let radii;
  if (kind === 'body-axis') {
    if (points.length !== 2 || region.radii.length !== 2) throw new Error(`${id} body axis requires two points and two radii`);
    radii = region.radii.map((radius, radiusIndex) => positiveRadius(radius, `${id} radius ${radiusIndex}`));
  } else if (kind === 'appendage-chain') {
    if (points.length < 3 || points.length !== region.radii.length) {
      throw new Error(`${id} appendage chain requires at least three points with matching radii`);
    }
    radii = region.radii.map((radius, radiusIndex) => positiveRadius(radius, `${id} radius ${radiusIndex}`));
  } else if (kind === 'contact-patch') {
    if (points.length !== 1 || region.radii.length !== 1) throw new Error(`${id} contact patch requires one point and one radius`);
    radii = [positiveRadius(region.radii[0], `${id} radius`)];
  } else {
    if (points.length !== 1 || region.radii.length !== 1) throw new Error(`${id} preservation region requires one point and one ellipsoid radius`);
    if (!Array.isArray(region.radii[0]) || region.radii[0].length !== 3) {
      throw new Error(`${id} preservation region radius must contain three axes`);
    }
    radii = [region.radii[0].map((radius, radiusIndex) => positiveRadius(radius, `${id} radius ${radiusIndex}`))];
  }

  return { id, kind, label, points, radii };
}

export function createOracleStencilDocument({ castId, castHash, registrationHash, authoringSessionId }) {
  return {
    schema: ORACLE_STENCIL_SCHEMA,
    cast: {
      id: assertString(castId, 'cast id'),
      sha256: assertString(castHash, 'cast hash'),
      registrationSha256: assertString(registrationHash, 'registration hash'),
    },
    authoring: {
      authority: ORACLE_STENCIL_AUTHORITY,
      source: 'exact-cast-rest-space-surface',
      coordinateSpace: 'asset-local',
      sessionId: assertString(authoringSessionId, 'authoring session id'),
      status: 'draft',
    },
    regions: [],
  };
}

export function validateOracleStencilDocument(document, expected = {}) {
  if (document?.schema !== ORACLE_STENCIL_SCHEMA) {
    throw new Error(`oracle stencil schema must be ${ORACLE_STENCIL_SCHEMA}`);
  }
  if (document?.authoring?.authority !== ORACLE_STENCIL_AUTHORITY) {
    throw new Error('oracle stencil requires explicit operator-authored authority');
  }
  if (document.authoring.source !== 'exact-cast-rest-space-surface') {
    throw new Error('oracle stencil source must be the exact cast rest-space surface');
  }
  if (document.authoring.coordinateSpace !== 'asset-local') {
    throw new Error('oracle stencil coordinate space must be asset-local');
  }
  assertString(document.authoring.sessionId, 'authoring session id');
  if (!['draft', 'accepted'].includes(document.authoring.status)) throw new Error('oracle stencil status must be draft or accepted');

  const cast = {
    id: assertString(document?.cast?.id, 'cast id'),
    sha256: assertString(document?.cast?.sha256, 'cast hash'),
    registrationSha256: assertString(document?.cast?.registrationSha256, 'registration hash'),
  };
  if (expected.castId && cast.id !== expected.castId) throw new Error('oracle stencil cast id mismatch');
  if (expected.castHash && cast.sha256 !== expected.castHash) throw new Error('oracle stencil cast hash mismatch');
  if (expected.registrationHash && cast.registrationSha256 !== expected.registrationHash) {
    throw new Error('oracle stencil registration hash mismatch');
  }
  if (!Array.isArray(document.regions)) throw new Error('oracle stencil regions must be an array');
  const ids = new Set();
  const regions = document.regions.map((region, index) => {
    const normalized = normalizeRegion(region, index);
    if (ids.has(normalized.id)) throw new Error(`oracle stencil has duplicate region id ${normalized.id}`);
    ids.add(normalized.id);
    return normalized;
  });

  return {
    schema: ORACLE_STENCIL_SCHEMA,
    cast,
    authoring: {
      authority: ORACLE_STENCIL_AUTHORITY,
      source: 'exact-cast-rest-space-surface',
      coordinateSpace: 'asset-local',
      sessionId: document.authoring.sessionId,
      status: document.authoring.status,
    },
    regions,
  };
}

export function canonicalizeOracleStencil(document) {
  const normalized = validateOracleStencilDocument(document);
  normalized.regions.sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(normalized);
}

export async function hashOracleStencil(document) {
  const bytes = new TextEncoder().encode(canonicalizeOracleStencil(document));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function upsertOracleStencilRegion(document, region) {
  const normalized = validateOracleStencilDocument(document);
  const nextRegion = normalizeRegion(region, normalized.regions.length);
  const next = clone(normalized);
  const index = next.regions.findIndex(candidate => candidate.id === nextRegion.id);
  if (index >= 0) next.regions[index] = nextRegion;
  else next.regions.push(nextRegion);
  return validateOracleStencilDocument(next, normalized.cast.id ? {
    castId: normalized.cast.id,
    castHash: normalized.cast.sha256,
    registrationHash: normalized.cast.registrationSha256,
  } : {});
}

export function removeOracleStencilRegion(document, regionId) {
  const normalized = validateOracleStencilDocument(document);
  return {
    ...normalized,
    regions: normalized.regions.filter(region => region.id !== regionId),
  };
}

export function setOracleStencilStatus(document, status) {
  const normalized = validateOracleStencilDocument(document);
  return validateOracleStencilDocument({
    ...normalized,
    authoring: { ...normalized.authoring, status },
  });
}

export function perturbOracleStencilRegion(document, regionId, perturbation = {}) {
  const normalized = validateOracleStencilDocument(document);
  const translate = point3(perturbation.translate || [0, 0, 0], 'perturbation translation');
  const radiusScale = positiveRadius(perturbation.radiusScale ?? 1, 'perturbation radius scale');
  let found = false;
  const regions = normalized.regions.map(region => {
    if (region.id !== regionId) return region;
    found = true;
    return {
      ...region,
      points: region.points.map(point => point.map((coordinate, axis) => coordinate + translate[axis])),
      radii: region.kind === 'preservation-region'
        ? [region.radii[0].map(radius => radius * radiusScale)]
        : region.radii.map(radius => radius * radiusScale),
    };
  });
  if (!found) throw new Error(`oracle stencil region ${regionId} does not exist`);
  return validateOracleStencilDocument({ ...normalized, regions });
}

function capsuleMembership(point, points, radii) {
  let strongest = 0;
  for (let segment = 0; segment < points.length - 1; segment++) {
    const a = points[segment];
    const b = points[segment + 1];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ap = [point[0] - a[0], point[1] - a[1], point[2] - a[2]];
    const lengthSquared = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    const t = lengthSquared > 1e-12
      ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / lengthSquared))
      : 0;
    const nearest = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    const radius = radii[segment] + (radii[segment + 1] - radii[segment]) * t;
    const distance = Math.hypot(point[0] - nearest[0], point[1] - nearest[1], point[2] - nearest[2]);
    strongest = Math.max(strongest, Math.max(0, 1 - distance / radius));
  }
  return strongest;
}

function regionMembership(point, region) {
  if (region.kind === 'body-axis' || region.kind === 'appendage-chain') {
    return capsuleMembership(point, region.points, region.radii);
  }
  if (region.kind === 'contact-patch') {
    const center = region.points[0];
    const distance = Math.hypot(point[0] - center[0], point[1] - center[1], point[2] - center[2]);
    return Math.max(0, 1 - distance / region.radii[0]);
  }
  const center = region.points[0];
  const radii = region.radii[0];
  const normalizedDistance = Math.hypot(
    (point[0] - center[0]) / radii[0],
    (point[1] - center[1]) / radii[1],
    (point[2] - center[2]) / radii[2],
  );
  return Math.max(0, 1 - normalizedDistance);
}

export async function deriveOracleStencilBinding(document, packedPositions, expected = {}) {
  const stencil = validateOracleStencilDocument(document, expected);
  if (!ArrayBuffer.isView(packedPositions) || packedPositions.length % 3 !== 0) {
    throw new Error('oracle stencil binding requires a packed position buffer');
  }
  const vertexCount = packedPositions.length / 3;
  const regions = stencil.regions.map(region => {
    const vertexIndices = [];
    const weights = [];
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const point = [packedPositions[vertex * 3], packedPositions[vertex * 3 + 1], packedPositions[vertex * 3 + 2]];
      const weight = regionMembership(point, region);
      if (weight <= 0) continue;
      vertexIndices.push(vertex);
      weights.push(weight);
    }
    return { id: region.id, kind: region.kind, vertexIndices, weights };
  });
  return {
    schema: ORACLE_STENCIL_BINDING_SCHEMA,
    authority: 'derived-from-operator-semantic-stencil',
    cast: clone(stencil.cast),
    stencilHash: await hashOracleStencil(stencil),
    vertexCount,
    regions,
  };
}
