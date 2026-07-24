import {
  sampleHillTerrainSurface,
  validateAxialCrawlerRegistration,
} from './hill-motion-affordance-source.mjs';
import { createSampledSupportSurface } from './motion-support-core.js';

const EPSILON = 1e-8;

function requireTerrainSource(source) {
  const columns = Math.round(Number(source?.grid?.columns));
  const rows = Math.round(Number(source?.grid?.rows));
  const heights = source?.channels?.height?.values;
  if (columns < 2 || rows < 2 || !heights || heights.length < columns * rows) {
    throw new Error('Hill support adapter requires a complete height channel and grid');
  }
  const xMin = Number(source?.worldBounds?.x?.min);
  const xMax = Number(source?.worldBounds?.x?.max);
  const zMin = Number(source?.worldBounds?.z?.min);
  const zMax = Number(source?.worldBounds?.z?.max);
  if (![xMin, xMax, zMin, zMax].every(Number.isFinite) || xMax <= xMin || zMax <= zMin) {
    throw new Error('Hill support adapter requires finite non-empty world bounds');
  }
  return { columns, rows, xMin, xMax, zMin, zMax };
}

export function createHillMotionSupportIdentity(packet, options = {}) {
  const sourceRef = String(options.sourceRef || packet?.source?.sourceRef || '');
  const revision = String(
    options.revision
      || packet?.source?.sourceRefDetail?.commit
      || packet?.packetHash
      || '',
  );
  const id = String(
    options.id
      || packet?.source?.configId
      || packet?.source?.route
      || '',
  );
  if (!id || !sourceRef || !revision) {
    throw new Error('Hill support identity requires routed id, sourceRef, and revision');
  }
  return Object.freeze({ id, sourceRef, revision });
}

export function createHillSampledSupportSurface(source, identity) {
  const terrain = requireTerrainSource(source);
  const cellWidth = Math.min(
    (terrain.xMax - terrain.xMin) / (terrain.columns - 1),
    (terrain.zMax - terrain.zMin) / (terrain.rows - 1),
  );
  return createSampledSupportSurface({
    kind: 'single-valued-heightfield',
    identity,
    sampleSpacing: cellWidth,
    bounds: {
      x: { min: terrain.xMin, max: terrain.xMax },
      z: { min: terrain.zMin, max: terrain.zMax },
    },
    sample(worldX, worldZ) {
      const hillSample = sampleHillTerrainSurface(source, worldX, worldZ);
      return {
        schema: 'kaminos.sampled-support-sample.v0',
        surfaceId: String(identity?.id || ''),
        surfaceRevision: String(identity?.revision || ''),
        world: [...hillSample.world],
        normal: [...hillSample.normal],
        inBounds: hillSample.inBounds,
        sourceSample: {
          schema: hillSample.schema,
          grid: [...hillSample.grid],
        },
      };
    },
  });
}

export function createAxialBodySupportFootprint(registrationInput, options = {}) {
  const registration = registrationInput?.axialSpan
    ? registrationInput
    : validateAxialCrawlerRegistration(registrationInput);
  const id = String(options.id || '');
  const registrationId = String(options.registrationId || '');
  if (!id || !registrationId) {
    throw new Error('axial support footprint requires body and registration identity');
  }
  const scale = Math.max(EPSILON, Number(options.scale) || 1);
  const bounds = registration.bounds || {};
  const halfWidth = Math.max(
    Math.abs(Number(bounds?.min?.[0]) || 0),
    Math.abs(Number(bounds?.max?.[0]) || 0),
  ) * scale;
  const boundsMinZ = Number(bounds?.min?.[2]);
  const boundsMaxZ = Number(bounds?.max?.[2]);
  const tailZ = Number.isFinite(boundsMaxZ)
    ? Math.max(registration.tailZ, boundsMaxZ)
    : registration.tailZ;
  const headZ = Number.isFinite(boundsMinZ)
    ? Math.min(registration.headZ, boundsMinZ)
    : registration.headZ;
  const stationByT = new Map();
  const addStation = (stationId, t, localZ, authored) => {
    stationByT.set(Number(t).toFixed(9), {
      stationId,
      t: Number(t),
      localZ: Number(localZ),
      authored,
    });
  };
  addStation(
    'footprint-tail',
    (registration.tailZ - tailZ) / registration.axialSpan,
    tailZ,
    false,
  );
  addStation(
    'footprint-head',
    (registration.tailZ - headZ) / registration.axialSpan,
    headZ,
    false,
  );
  for (const station of registration.spineStations) {
    addStation(
      station.id,
      station.t,
      registration.tailZ - station.t * registration.axialSpan,
      true,
    );
  }
  return Object.freeze({
    schema: 'kaminos.motion-support-footprint.v0',
    id,
    registrationId,
    morphology: 'axial-body',
    scale,
    halfWidth,
    tailZ,
    headZ,
    axialSpan: tailZ - headZ,
    registrationTailZ: registration.tailZ,
    registrationAxialSpan: registration.axialSpan,
    stations: Object.freeze(
      [...stationByT.values()]
        .sort((a, b) => a.t - b.t)
        .map(station => Object.freeze(station)),
    ),
  });
}
