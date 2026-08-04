import { createHash } from 'node:crypto';

import {
  MUSCLE_COMPARTMENT_PACKING_SOURCE_SCHEMA,
  measureMuscleCompartmentPacking,
} from './muscle-compartment-packing-core.mjs';
import { TRACK_M_ROUTING_FIXTURE_SCHEMA } from './track-m-routing-fixture-core.mjs';

export const AUTHORED_MUSCLE_PACKING_COORDINATE_CARRIER_SCHEMA =
  'kaminos.authored-muscle-packing-coordinate-carrier.v0';
export const AUTHORED_MUSCLE_PACKING_INTAKE_RECEIPT_SCHEMA =
  'kaminos.authored-muscle-packing-intake-receipt.v0';

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ACCEPTED_IDENTITY_FIELDS = Object.freeze([
  'source.assetSha256',
  'source.graphSha256',
  'source.graphFileSha256',
  'source.routingFixtureSha256',
  'muscles[].constructionId',
  'muscles[].lineageId',
  'muscles[].instanceId',
  'muscles[].surfaceInstanceId',
  'muscles[].surfaceGeometrySha256',
  'muscles[].pathInstanceId',
  'muscles[].pathGeometrySha256',
  'muscles[].attachments.origin',
  'muscles[].attachments.insertion',
]);
const REQUIRED_GEOMETRY_FIELDS = Object.freeze([
  'coordinateCarrier.coordinateSpace',
  'coordinateCarrier.compartment',
  'coordinateCarrier.obstacles',
  'coordinateCarrier.muscles[].centerline',
  'coordinateCarrier.muscles[].targetVolume',
  'coordinateCarrier.muscles[].volumeAuthority',
]);
const ACCEPTED_COORDINATE_FIELDS = Object.freeze([
  'coordinateCarrier.coordinateSpace',
  'coordinateCarrier.compartment',
  'coordinateCarrier.obstacles',
  'coordinateCarrier.muscles[].centerline',
  'coordinateCarrier.muscles[].targetVolume',
  'coordinateCarrier.muscles[].volumeAuthority',
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  if (typeof value === 'number' && Object.is(value, -0)) return 0;
  return value;
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function sameValue(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function sourceIdentity(routingFixture) {
  return {
    assetSha256: routingFixture?.source?.assetSha256,
    graphSha256: routingFixture?.source?.graphSha256,
    graphFileSha256: routingFixture?.source?.graphFileSha256,
    routingFixtureSha256: routingFixture?.fixtureSha256,
  };
}

function receipt(core) {
  return canonical({
    schema: AUTHORED_MUSCLE_PACKING_INTAKE_RECEIPT_SCHEMA,
    receiptSha256: hashJson(core),
    ...core,
  });
}

function reject({ status, reason, input, source, acceptedFields = [], missingFields = [] }) {
  return receipt({
    status,
    admitted: false,
    reason,
    input: structuredClone(input),
    source: structuredClone(source),
    acceptedFields: [...acceptedFields],
    missingFields: [...missingFields],
    packingSource: null,
  });
}

function assertHash(value, label) {
  if (!HASH_PATTERN.test(value || '')) throw new Error(`${label} must be a SHA-256 identity`);
}

function validateRouteIdentityInput(value, label, expectedId) {
  if (!value || typeof value !== 'object') throw new Error(`${label} input identity is missing`);
  for (const route of ['requested', 'effective']) {
    const row = value[route];
    if (!row || typeof row.kind !== 'string' || typeof row.id !== 'string') {
      throw new Error(`${label} ${route} input identity is incomplete`);
    }
    assertHash(row.sha256, `${label} ${route}`);
  }
  if (!sameValue(value.requested, value.effective)) {
    throw new Error(`${label} requested and effective input identities disagree`);
  }
  if (value.effective.id !== expectedId) {
    throw new Error(`${label} effective id does not name the consumed input`);
  }
}

function fixtureCore(routingFixture) {
  const {
    fixtureSha256: ignoredFixtureIdentity,
    schema: ignoredEnvelopeSchema,
    ...core
  } = routingFixture;
  return core;
}

function validateFixture(routingFixture) {
  if (routingFixture?.schema !== TRACK_M_ROUTING_FIXTURE_SCHEMA) {
    throw new Error(`routing fixture schema mismatch: ${routingFixture?.schema || 'missing'}`);
  }
  assertHash(routingFixture.fixtureSha256, 'routing fixture internal identity');
  if (hashJson(fixtureCore(routingFixture)) !== routingFixture.fixtureSha256) {
    throw new Error('routing fixture internal identity does not match its effective payload');
  }
  for (const [key, value] of Object.entries(sourceIdentity(routingFixture))) assertHash(value, key);
  const routes = routingFixture.conditions?.correct?.routes;
  if (!Array.isArray(routes) || routes.length < 2 || routes.length > 8) {
    throw new Error('routing fixture must expose between two and eight correct routes');
  }
  return routes;
}

function compareField(actual, expected, label) {
  if (!sameValue(actual, expected)) throw new Error(`${label} does not match the routing fixture`);
}

function validateCoordinateCarrier(routingFixture, routes, coordinateCarrier) {
  if (coordinateCarrier?.schema !== AUTHORED_MUSCLE_PACKING_COORDINATE_CARRIER_SCHEMA) {
    throw new Error(`coordinate carrier schema mismatch: ${coordinateCarrier?.schema || 'missing'}`);
  }
  if (typeof coordinateCarrier.id !== 'string' || coordinateCarrier.id.length === 0) {
    throw new Error('coordinate carrier id must be a nonempty string');
  }
  compareField(coordinateCarrier.source, sourceIdentity(routingFixture), 'coordinate carrier source identity');
  if (
    coordinateCarrier.coordinateSpace?.kind !== 'source-world' ||
    coordinateCarrier.coordinateSpace?.dimension !== 3 ||
    typeof coordinateCarrier.coordinateSpace?.unit !== 'string' ||
    coordinateCarrier.coordinateSpace.unit.length === 0
  ) {
    throw new Error('coordinate carrier must declare a finite 3D source-world coordinate space and nonempty unit');
  }
  if (!Array.isArray(coordinateCarrier.obstacles) || coordinateCarrier.obstacles.length === 0) {
    throw new Error('coordinate carrier requires at least one skeletal clearance obstacle');
  }
  for (const obstacle of coordinateCarrier.obstacles) {
    if (typeof obstacle.sourceAuthority !== 'string' || obstacle.sourceAuthority.length === 0) {
      throw new Error(`${obstacle.id || 'skeletal obstacle'} sourceAuthority must be a nonempty string`);
    }
  }
  if (!Array.isArray(coordinateCarrier.muscles) || coordinateCarrier.muscles.length !== routes.length) {
    throw new Error('coordinate carrier muscle set must exactly match the routing fixture route set');
  }

  const byConstruction = new Map(coordinateCarrier.muscles.map(muscle => [muscle.constructionId, muscle]));
  if (byConstruction.size !== coordinateCarrier.muscles.length) {
    throw new Error('coordinate carrier construction ids must be unique');
  }
  const orderedMuscles = routes.map(route => {
    const muscle = byConstruction.get(route.constructionId);
    if (!muscle) throw new Error(`${route.constructionId} is missing from coordinate carrier`);
    for (const field of ['constructionId', 'lineageId', 'instanceId']) {
      compareField(muscle[field], route[field], `${route.constructionId} ${field}`);
    }
    for (const field of [
      'surfaceInstanceId',
      'surfaceGeometrySha256',
      'pathInstanceId',
      'pathGeometrySha256',
    ]) {
      compareField(muscle[field], route.components[field], `${route.constructionId} ${field}`);
    }
    for (const endpoint of ['origin', 'insertion']) {
      compareField(
        muscle.attachments?.[endpoint]?.id,
        route[endpoint].assignedHandleInstanceId,
        `${route.constructionId} ${endpoint} attachment id`,
      );
      compareField(
        muscle.attachments?.[endpoint]?.sourceAuthority,
        route[endpoint].sourceAuthority,
        `${route.constructionId} ${endpoint} source authority`,
      );
      compareField(
        muscle.attachments?.[endpoint]?.position,
        route[endpoint].point,
        `${route.constructionId} ${endpoint} position`,
      );
    }
    if (typeof muscle.volumeAuthority !== 'string' || muscle.volumeAuthority.length === 0) {
      throw new Error(`${route.constructionId} volumeAuthority must be a nonempty string`);
    }
    return muscle;
  });
  return orderedMuscles;
}

function buildPackingSource(routingFixture, coordinateCarrier, orderedMuscles, input) {
  return canonical({
    schema: MUSCLE_COMPARTMENT_PACKING_SOURCE_SCHEMA,
    id: coordinateCarrier.id,
    authority: {
      kind: 'operator-authored',
      anatomicalAdmission: 'geometric-only',
    },
    dimension: 3,
    input: structuredClone(input.coordinateCarrier),
    source: sourceIdentity(routingFixture),
    coordinateSpace: structuredClone(coordinateCarrier.coordinateSpace),
    compartment: structuredClone(coordinateCarrier.compartment),
    obstacles: structuredClone(coordinateCarrier.obstacles),
    muscles: orderedMuscles.map(muscle => ({
      id: muscle.constructionId,
      identity: {
        sourceId: muscle.surfaceInstanceId,
        constructionId: muscle.constructionId,
        lineageId: muscle.lineageId,
        instanceId: muscle.instanceId,
      },
      componentIdentity: {
        surfaceInstanceId: muscle.surfaceInstanceId,
        surfaceGeometrySha256: muscle.surfaceGeometrySha256,
        pathInstanceId: muscle.pathInstanceId,
        pathGeometrySha256: muscle.pathGeometrySha256,
      },
      authority: {
        kind: 'operator-authored',
        anatomicalAdmission: 'geometric-only',
      },
      attachments: structuredClone(muscle.attachments),
      centerline: structuredClone(muscle.centerline),
      targetVolume: muscle.targetVolume,
      volumeAuthority: muscle.volumeAuthority,
    })),
  });
}

export function admitAuthoredMusclePackingIntake({ routingFixture, coordinateCarrier, input }) {
  const source = sourceIdentity(routingFixture);
  let routes;
  try {
    routes = validateFixture(routingFixture);
    validateRouteIdentityInput(input?.routingFixture, 'routing fixture', routingFixture.selection?.id);
    if (coordinateCarrier) {
      validateRouteIdentityInput(input?.coordinateCarrier, 'coordinate carrier', coordinateCarrier.id);
    } else if (input?.coordinateCarrier !== null) {
      throw new Error('missing coordinate carrier must have a null input identity');
    }
  } catch (error) {
    return reject({
      status: /requested and effective|effective id|input identity/i.test(error.message)
        ? 'input-identity-mismatch'
        : 'source-identity-mismatch',
      reason: error.message,
      input,
      source,
    });
  }

  if (!coordinateCarrier) {
    return reject({
      status: 'identity-coherent_geometry-unavailable',
      reason: 'authenticated routing identities and byte-bound endpoints are present, but no world-space packing coordinate carrier was supplied',
      input,
      source,
      acceptedFields: ACCEPTED_IDENTITY_FIELDS,
      missingFields: REQUIRED_GEOMETRY_FIELDS,
    });
  }

  let orderedMuscles;
  try {
    orderedMuscles = validateCoordinateCarrier(routingFixture, routes, coordinateCarrier);
  } catch (error) {
    return reject({
      status: /match the routing fixture|missing from coordinate|route set|construction ids/i.test(error.message)
        ? 'source-identity-mismatch'
        : 'geometry-invalid',
      reason: error.message,
      input,
      source,
      acceptedFields: ACCEPTED_IDENTITY_FIELDS,
    });
  }

  const packingSource = buildPackingSource(routingFixture, coordinateCarrier, orderedMuscles, input);
  try {
    measureMuscleCompartmentPacking(packingSource, packingSource.muscles, 5);
  } catch (error) {
    return reject({
      status: 'geometry-invalid',
      reason: error.message,
      input,
      source,
      acceptedFields: ACCEPTED_IDENTITY_FIELDS,
    });
  }

  return receipt({
    status: 'admitted',
    admitted: true,
    reason: 'routing identities, fixed endpoints, coordinate space, carrier geometry, volume authority, skeletal clearance, and compartment bounds agree',
    input: structuredClone(input),
    source,
    acceptedFields: [...ACCEPTED_IDENTITY_FIELDS, ...ACCEPTED_COORDINATE_FIELDS],
    missingFields: [],
    packingSource,
  });
}
