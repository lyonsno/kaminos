import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  adjudicateTissueResponseLedger,
  analyticalTissueDescriptorHash,
  analyticalTissueRowPlanHash,
} from './analytical-tissue-assay-core.mjs';

export const ANALYTICAL_TISSUE_GEOMETRY_ASSAY_SCHEMA =
  'kaminos.analytical-tissue-geometry-assay.v0';

const EFFECTIVE_ROUTE = Object.freeze({
  id: 'synthetic-hindquarter-analytic-profile-mesh-v0',
  compilerId: 'analytical-tissue-profile-mesh-v0',
  geometry: 'closed-elliptical-station-mesh',
  projection: 'right-sagittal-orthographic',
});

const CAMERA = Object.freeze({
  id: 'synthetic-hindquarter-orthographic-v0',
  view: 'right-sagittal',
  horizontalAxis: 'anterior',
  verticalAxis: 'dorsal',
  bounds: Object.freeze({ anterior: [-0.78, 0.38], dorsal: [-0.72, 0.72] }),
});

const BASE_COMPONENTS = Object.freeze([
  Object.freeze({
    id: 'pelvis', tissueClass: 'rigid', center: [0, -0.02, 0.03], radii: [0.39, 0.30, 0.50],
  }),
  Object.freeze({
    id: 'gluteal-carrier', tissueClass: 'muscle', center: [0, 0.16, -0.28], radii: [0.38, 0.31, 0.48],
  }),
  Object.freeze({
    id: 'haunch-bulk', tissueClass: 'fat', center: [0, 0.00, -0.36], radii: [0.45, 0.34, 0.58],
  }),
  Object.freeze({
    id: 'ischial-tether', tissueClass: 'tether', center: [0, -0.29, -0.05], radii: [0.15, 0.12, 0.34],
  }),
]);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function finitePositiveInteger(value, label, minimum) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}`);
  }
}

function createState(muscleTension) {
  if (!Number.isFinite(muscleTension)) throw new Error('muscleTension must be finite');
  const components = BASE_COMPONENTS.map((component) => ({
    ...component,
    center: [...component.center],
    radii: [...component.radii],
  }));
  const muscle = components.find((component) => component.id === 'gluteal-carrier');
  muscle.radii[0] += muscleTension * 0.40;
  muscle.radii[1] += muscleTension * 0.70;
  const fat = components.find((component) => component.id === 'haunch-bulk');
  fat.radii[0] += muscleTension * 0.25;
  const tether = components.find((component) => component.id === 'ischial-tether');
  tether.center[1] -= muscleTension * 0.30;
  return {
    muscleTension,
    skinSlack: 0.025 + muscleTension * 0.18,
    components,
  };
}

function section(component, z, isotropic) {
  const [, centerY, centerZ] = component.center;
  let [radiusX, radiusY, radiusZ] = component.radii;
  if (isotropic) {
    const radius = Math.cbrt(radiusX * radiusY * radiusZ);
    radiusX = radius;
    radiusY = radius;
    radiusZ = radius;
  }
  const axial = (z - centerZ) / radiusZ;
  if (Math.abs(axial) >= 1) return null;
  const scale = Math.sqrt(1 - axial * axial);
  return {
    componentId: component.id,
    tissueClass: component.tissueClass,
    top: centerY + radiusY * scale,
    bottom: centerY - radiusY * scale,
    width: radiusX * scale,
    support: scale,
  };
}

function rawProfile(state, stationCount, { isotropic = false } = {}) {
  const [zMin, zMax] = CAMERA.bounds.anterior;
  const stations = [];
  for (let index = 0; index < stationCount; index += 1) {
    const z = zMin + (zMax - zMin) * index / (stationCount - 1);
    const sections = state.components
      .map((component) => section(component, z, isotropic))
      .filter(Boolean);
    if (sections.length === 0) throw new Error(`no component supports station ${index}`);
    const skinCoordinate = (z + 0.28) / 0.48;
    const skinSupport = Math.abs(skinCoordinate) < 1
      ? Math.pow(1 - skinCoordinate * skinCoordinate, 2)
      : 0;
    const skinOffset = state.skinSlack * skinSupport;
    stations.push({
      z,
      top: Math.max(...sections.map((entry) => entry.top)) + skinOffset,
      bottom: Math.min(...sections.map((entry) => entry.bottom)) - skinOffset * 0.72,
      width: Math.max(...sections.map((entry) => entry.width)) + skinOffset * 0.62,
      componentSupports: Object.fromEntries(sections.map((entry) => [entry.componentId, entry.support])),
    });
  }
  return stations;
}

function smoothValues(values, passes = 2) {
  let current = [...values];
  for (let pass = 0; pass < passes; pass += 1) {
    current = current.map((value, index) => {
      if (index === 0 || index === current.length - 1) return value;
      return current[index - 1] * 0.25 + value * 0.5 + current[index + 1] * 0.25;
    });
  }
  return current;
}

function smoothProfile(profile, passes = 3) {
  const top = smoothValues(profile.map((station) => station.top), passes);
  const bottom = smoothValues(profile.map((station) => station.bottom), passes);
  const width = smoothValues(profile.map((station) => station.width), passes);
  return profile.map((station, index) => ({
    ...station,
    top: top[index],
    bottom: bottom[index],
    width: width[index],
  }));
}

function profileForRow(row, state, baselineState, stationCount) {
  if (row.implementationMode === 'isotropized-profile') {
    return smoothProfile(rawProfile(state, stationCount, { isotropic: true }), 1);
  }
  if (row.implementationMode === 'raw-identity-profile') {
    return rawProfile(state, stationCount);
  }
  if (row.implementationMode === 'frozen-profile') {
    return smoothProfile(rawProfile(baselineState, stationCount), 5);
  }
  if (row.implementationMode === 'smoothed-identity-profile') {
    return smoothProfile(rawProfile(state, stationCount), 5);
  }
  throw new Error(`unsupported analytical tissue implementation mode: ${row.implementationMode}`);
}

function profileToMesh(profile, radialSegments) {
  const vertices = [];
  const faces = [];
  for (const station of profile) {
    const centerY = (station.top + station.bottom) * 0.5;
    const radiusY = (station.top - station.bottom) * 0.5;
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angle = segment / radialSegments * Math.PI * 2;
      vertices.push([
        station.width * Math.cos(angle),
        centerY + radiusY * Math.sin(angle),
        station.z,
      ]);
    }
  }
  for (let station = 0; station < profile.length - 1; station += 1) {
    const base = station * radialSegments;
    const next = base + radialSegments;
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const after = (segment + 1) % radialSegments;
      faces.push([base + segment, next + segment, next + after, base + after]);
    }
  }
  const startCenter = vertices.length;
  vertices.push([0, (profile[0].top + profile[0].bottom) * 0.5, profile[0].z]);
  const endCenter = vertices.length;
  const lastProfile = profile.at(-1);
  vertices.push([0, (lastProfile.top + lastProfile.bottom) * 0.5, lastProfile.z]);
  const lastRing = (profile.length - 1) * radialSegments;
  for (let segment = 0; segment < radialSegments; segment += 1) {
    const after = (segment + 1) % radialSegments;
    faces.push([startCenter, after, segment]);
    faces.push([endCenter, lastRing + segment, lastRing + after]);
  }
  return { vertices, faces };
}

function profileMetrics(profile) {
  const inRange = (station, [low, high]) => station.z >= low && station.z <= high;
  const muscleRegion = profile.filter((station) => inRange(station, [-0.66, 0.08]));
  const fatRegion = profile.filter((station) => inRange(station, [-0.78, -0.02]));
  const tetherRegion = profile.filter((station) => inRange(station, [-0.34, 0.18]));
  const slackRegion = profile.filter((station) => inRange(station, [-0.72, 0.22]));
  return {
    muscleBulge: Math.max(...muscleRegion.map((station) => station.top)),
    fatSpan: Math.max(...fatRegion.map((station) => station.width * 2)),
    tetherAnchor: Math.min(...tetherRegion.map((station) => station.bottom)),
    skinSlack: slackRegion.reduce(
      (sum, station) => sum + station.width + (station.top - station.bottom) * 0.5,
      0,
    ) / slackRegion.length,
  };
}

function subtractMetrics(perturbed, baseline) {
  return Object.fromEntries(
    Object.keys(baseline).map((key) => [key, perturbed[key] - baseline[key]]),
  );
}

function responseShape(baseline, perturbed, baselineState, perturbedState, identityBearing) {
  const displacement = baseline.map((station, index) => {
    const other = perturbed[index];
    return {
      z: station.z,
      magnitude: Math.hypot(
        other.top - station.top,
        other.bottom - station.bottom,
        other.width - station.width,
      ),
      dorsal: other.top - station.top,
    };
  });
  const target = baselineState.components.find((component) => component.id === 'gluteal-carrier');
  const targetMin = target.center[2] - target.radii[2];
  const targetMax = target.center[2] + target.radii[2];
  const inside = displacement.filter((entry) => entry.z >= targetMin && entry.z <= targetMax);
  const outside = displacement.filter((entry) => entry.z < targetMin || entry.z > targetMax);
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const insideMean = mean(inside.map((entry) => entry.magnitude));
  const outsideMean = mean(outside.map((entry) => entry.magnitude));
  const maxSecondDifference = Math.max(
    ...displacement.slice(1, -1).map((entry, index) => Math.abs(
      displacement[index].dorsal - entry.dorsal * 2 + displacement[index + 2].dorsal
    )),
  );

  const baselineById = new Map(baselineState.components.map((component) => [component.id, component]));
  const changes = perturbedState.components.map((component) => {
    const before = baselineById.get(component.id);
    const beforeVolume = before.radii.reduce((product, value) => product * value, 1);
    const afterVolume = component.radii.reduce((product, value) => product * value, 1);
    const centerShift = Math.hypot(...component.center.map((value, index) => value - before.center[index]));
    return { componentId: component.id, magnitude: Math.abs(afterVolume - beforeVolume) + centerShift * 0.05 };
  });
  changes.push({
    componentId: 'hindquarter-skin',
    magnitude: Math.abs(perturbedState.skinSlack - baselineState.skinSlack) * 0.22,
  });
  const total = changes.reduce((sum, entry) => sum + entry.magnitude, 0) || 1;
  const ranked = [...changes].sort((a, b) => b.magnitude - a.magnitude);
  return {
    localization: {
      support: [targetMin, targetMax],
      insideMean,
      outsideMean,
      ratio: insideMean / Math.max(outsideMean, 1e-12),
    },
    smoothness: { maxSecondDifference },
    attribution: identityBearing
      ? {
          dominantComponentId: ranked[0].componentId,
          targetFraction: changes.find((entry) => entry.componentId === 'gluteal-carrier').magnitude / total,
          componentFractions: Object.fromEntries(
            changes.map((entry) => [entry.componentId, entry.magnitude / total]),
          ),
        }
      : { dominantComponentId: null, targetFraction: 0, componentFractions: {} },
  };
}

function mixtureContributors(state) {
  const raw = state.components.map((component) => ({
    componentId: component.id,
    tissueClass: component.tissueClass,
    magnitude: component.radii.reduce((product, value) => product * value, 1),
  }));
  raw.push({ componentId: 'hindquarter-skin', tissueClass: 'skin', magnitude: 0.035 });
  const total = raw.reduce((sum, entry) => sum + entry.magnitude, 0);
  return raw.map(({ magnitude, ...entry }) => ({ ...entry, weight: magnitude / total }));
}

function surfaceEvidence(row, state) {
  if (row.implementationMode === 'isotropized-profile') {
    return {
      outputSurfaceId: `${row.id}:muscle-tension:${state.muscleTension}`,
      identityMode: 'none',
      contributors: [{ componentId: 'smooth-blob', tissueClass: 'undifferentiated', weight: 1 }],
    };
  }
  if (row.implementationMode === 'frozen-profile') {
    return {
      outputSurfaceId: `${row.id}:muscle-tension:${state.muscleTension}`,
      identityMode: 'mixture-weights',
      contributors: [{ componentId: 'hindquarter-skin', tissueClass: 'skin', weight: 1 }],
    };
  }
  return {
    outputSurfaceId: `${row.id}:muscle-tension:${state.muscleTension}`,
    identityMode: 'mixture-weights',
    contributors: mixtureContributors(state),
  };
}

function compileState(row, state, baselineState, stationCount, radialSegments) {
  const profile = profileForRow(row, state, baselineState, stationCount);
  return {
    stateId: `muscle-tension:${state.muscleTension}`,
    profile,
    mesh: profileToMesh(profile, radialSegments),
    metrics: profileMetrics(profile),
    surface: surfaceEvidence(row, state),
  };
}

function comparison(sourceMetrics, candidateMetrics) {
  return Object.fromEntries(Object.keys(sourceMetrics).map((key) => [key, {
    source: sourceMetrics[key],
    envelope: candidateMetrics[key],
  }]));
}

export function buildAnalyticalTissueMuscleTensionAssay({
  descriptor,
  rowPlan,
  sourceFixture,
  delta = 0.1,
  stationCount = 65,
  radialSegments = 32,
} = {}) {
  if (!descriptor || !rowPlan || !sourceFixture) {
    throw new Error('descriptor, rowPlan, and sourceFixture are required');
  }
  if (!(Number.isFinite(delta) && delta > 0)) throw new Error('delta must be positive and finite');
  finitePositiveInteger(stationCount, 'stationCount', 9);
  finitePositiveInteger(radialSegments, 'radialSegments', 8);
  if (sourceFixture.schema !== 'kaminos.analytical-tissue-source-response.v0') {
    throw new Error('unsupported source response fixture schema');
  }
  if (sourceFixture.descriptorId !== descriptor.id) {
    throw new Error('source response descriptorId does not match descriptor');
  }
  if (sourceFixture.controlId !== 'muscle-tension' || sourceFixture.delta !== delta) {
    throw new Error('source response control or delta does not match trial');
  }
  if (sourceFixture.cameraId !== CAMERA.id) {
    throw new Error('source response camera does not match effective camera');
  }
  const observableIds = descriptor.observables.map((entry) => entry.id);
  for (const field of ['baselineMetrics', 'perturbedMetrics', 'responseObservables']) {
    if (canonicalJson(Object.keys(sourceFixture[field] ?? {}).sort()) !== canonicalJson([...observableIds].sort())) {
      throw new Error(`source response ${field} does not match descriptor observables`);
    }
  }
  const computedSourceResponse = subtractMetrics(
    sourceFixture.perturbedMetrics,
    sourceFixture.baselineMetrics,
  );
  for (const observableId of observableIds) {
    if (Math.abs(computedSourceResponse[observableId] - sourceFixture.responseObservables[observableId]) > 1e-12) {
      throw new Error(`source response is internally inconsistent for ${observableId}`);
    }
  }
  const baselineState = createState(0);
  const perturbedState = createState(delta);
  const sourceBaselineMetrics = structuredClone(sourceFixture.baselineMetrics);
  const sourcePerturbedMetrics = structuredClone(sourceFixture.perturbedMetrics);
  const sourceFixtureHash = hashValue(sourceFixture);
  const source = {
    fixtureId: sourceFixture.id,
    fixtureHash: sourceFixtureHash,
    authority: structuredClone(sourceFixture.authority),
    baseline: { metrics: sourceBaselineMetrics },
    perturbed: { metrics: sourcePerturbedMetrics },
    response: { observables: structuredClone(sourceFixture.responseObservables) },
  };
  const camera = { ...CAMERA, hash: hashValue(CAMERA) };
  const rows = rowPlan.rows.map((row) => {
    const baseline = compileState(row, baselineState, baselineState, stationCount, radialSegments);
    const perturbed = compileState(row, perturbedState, baselineState, stationCount, radialSegments);
    const identityBearing = !row.evidenceDisposition.includes('control')
      && row.implementationMode !== 'isotropized-profile';
    const response = {
      observables: subtractMetrics(perturbed.metrics, baseline.metrics),
      ...responseShape(
        baseline.profile,
        perturbed.profile,
        baselineState,
        perturbedState,
        identityBearing,
      ),
    };
    const evidence = {
      descriptor,
      descriptorHash: analyticalTissueDescriptorHash(descriptor),
      freeze: {
        requestedRouteId: EFFECTIVE_ROUTE.id,
        effectiveRouteId: EFFECTIVE_ROUTE.id,
        baselineObservationId: `${row.id}:baseline:v0`,
        perturbedObservationId: `${row.id}:muscle-tension:${delta}:v0`,
        cameraHash: camera.hash,
        sourceHash: sourceFixtureHash,
      },
      representation: {
        requestedInteriorCarrierId: row.interiorCarrierId,
        effectiveInteriorCarrierId: row.interiorCarrierId,
        requestedSurfaceFormationId: row.surfaceFormationId,
        effectiveSurfaceFormationId: row.surfaceFormationId,
        requestedImplementationMode: row.implementationMode,
        effectiveImplementationMode: row.implementationMode,
      },
      assay: {
        rowPlan,
        rowPlanHash: analyticalTissueRowPlanHash(rowPlan),
        rowId: row.id,
      },
      trial: { controlId: 'muscle-tension', delta },
      surface: perturbed.surface,
    };
    const verdict = adjudicateTissueResponseLedger({
      baselineComparison: comparison(sourceBaselineMetrics, baseline.metrics),
      perturbedComparison: comparison(sourcePerturbedMetrics, perturbed.metrics),
      perturbedRelation: 'muscleBulge',
      expectedDirection: 1,
      evidence,
    });
    return {
      ...row,
      effectiveRouteId: EFFECTIVE_ROUTE.id,
      cameraHash: camera.hash,
      baseline,
      perturbed,
      response,
      evidence,
      verdict,
    };
  });
  const assay = {
    schema: ANALYTICAL_TISSUE_GEOMETRY_ASSAY_SCHEMA,
    status: 'completed',
    claimCeiling: rowPlan.claimCeiling,
    effectiveRoute: EFFECTIVE_ROUTE,
    camera,
    descriptorHash: analyticalTissueDescriptorHash(descriptor),
    rowPlanHash: analyticalTissueRowPlanHash(rowPlan),
    parameters: { controlId: 'muscle-tension', delta, stationCount, radialSegments },
    source,
    sourceFixtureHash,
    rows,
  };
  return { ...assay, assayHash: hashValue(assay) };
}

function safeObjectId(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]+/g, '_');
}

export function analyticalTissueMeshToObj(mesh, { objectId = 'analytical-tissue-envelope' } = {}) {
  if (!mesh?.vertices?.length || !mesh?.faces?.length) throw new Error('nonempty mesh is required');
  const lines = [`o ${safeObjectId(objectId)}`];
  for (const vertex of mesh.vertices) lines.push(`v ${vertex.join(' ')}`);
  for (const face of mesh.faces) lines.push(`f ${face.map((index) => index + 1).join(' ')}`);
  return `${lines.join('\n')}\n`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function profilePath(profile, panel) {
  const [zMin, zMax] = CAMERA.bounds.anterior;
  const [yMin, yMax] = CAMERA.bounds.dorsal;
  const point = (z, y) => [
    panel.x + (z - zMin) / (zMax - zMin) * panel.width,
    panel.y + panel.height - (y - yMin) / (yMax - yMin) * panel.height,
  ];
  const upper = profile.map((station) => point(station.z, station.top));
  const lower = [...profile].reverse().map((station) => point(station.z, station.bottom));
  return [...upper, ...lower]
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ') + ' Z';
}

export function renderAnalyticalTissueAssaySvg(assay) {
  if (assay?.schema !== ANALYTICAL_TISSUE_GEOMETRY_ASSAY_SCHEMA || assay.rows.length !== 4) {
    throw new Error('completed four-row analytical tissue assay is required');
  }
  const width = 1280;
  const height = 1030;
  const panels = assay.rows.map((_, index) => ({
    x: 60 + (index % 2) * 620,
    y: 150 + Math.floor(index / 2) * 390,
    width: 560,
    height: 270,
  }));
  const body = assay.rows.map((row, index) => {
    const panel = panels[index];
    const verdict = row.verdict.passed ? 'candidate admitted' : 'not admitted';
    return `<g id="${escapeXml(row.id)}">
        <rect x="${panel.x}" y="${panel.y}" width="${panel.width}" height="${panel.height}" rx="14" fill="#111923" stroke="#304455"/>
        <path d="${profilePath(row.baseline.profile, panel)}" fill="#73808b" fill-opacity="0.48" stroke="#a7b1ba" stroke-width="2"/>
        <path d="${profilePath(row.perturbed.profile, panel)}" fill="#35d4c7" fill-opacity="0.28" stroke="#5ff3e5" stroke-width="2.4"/>
        <text x="${panel.x}" y="${panel.y - 42}" class="title">${escapeXml(row.id)}</text>
        <text x="${panel.x}" y="${panel.y - 18}" class="meta">${escapeXml(row.role)} · ${verdict}</text>
        <text x="${panel.x + 14}" y="${panel.y + panel.height - 16}" class="metric">locality ${row.response.localization.ratio.toFixed(2)} · smooth Δ² ${row.response.smoothness.maxSecondDifference.toFixed(4)} · muscle Δ ${row.response.observables.muscleBulge.toFixed(4)}</text>
      </g>`;
  }).join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#081018"/>
  <style>
    text { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; fill: #d8e7ed; }
    .heading { font-size: 25px; font-weight: 700; }
    .sub { font-size: 14px; fill: #8fa7b2; }
    .title { font-size: 17px; font-weight: 700; }
    .meta { font-size: 12px; fill: #94aab3; }
    .metric { font-size: 11px; fill: #b9cbd2; }
  </style>
  <text x="60" y="44" class="heading">Bounded analytic-profile muscle-tension precursor</text>
  <text x="60" y="70" class="sub">baseline = grey · perturbed = cyan · fixed synthetic comparator · no distinct representation result</text>
  ${body}
  <text x="60" y="890" class="sub">visual companion to report.json · route ${escapeXml(assay.effectiveRoute.id)} · camera ${escapeXml(assay.camera.id)}</text>
  <text x="60" y="915" class="sub">descriptor ${escapeXml(assay.descriptorHash)}</text>
  <text x="60" y="940" class="sub">row plan ${escapeXml(assay.rowPlanHash)}</text>
  <text x="60" y="965" class="sub">source fixture ${escapeXml(assay.sourceFixtureHash)}</text>
  <text x="60" y="990" class="sub">assay ${escapeXml(assay.assayHash)}</text>
  <text x="60" y="1015" class="sub">no anatomical, authored-envelope, feline, generator, reconstruction, registration, motion, or production claim</text>
</svg>
`;
}

export async function writeAnalyticalTissueMuscleTensionArtifacts({
  outDir,
  descriptor,
  rowPlan,
  sourceFixture,
  requestedRouteId = EFFECTIVE_ROUTE.id,
  delta = 0.1,
  stationCount = 65,
  radialSegments = 32,
} = {}) {
  if (typeof outDir !== 'string' || outDir.length === 0) {
    throw new Error('outDir is required');
  }

  await mkdir(outDir, { recursive: true });
  const reportPath = join(outDir, 'report.json');
  const report = {
    schema: 'kaminos.analytical-tissue-geometry-run-report.v0',
    status: 'running',
    requestedRouteId,
    effectiveRouteId: EFFECTIVE_ROUTE.id,
    parameters: { delta, stationCount, radialSegments },
    outputs: [],
  };
  let phase = 'input-validation';

  try {
    if (!descriptor || !rowPlan || !sourceFixture) {
      throw new Error('descriptor, rowPlan, and sourceFixture are required');
    }
    if (requestedRouteId !== EFFECTIVE_ROUTE.id) {
      throw new Error(
        `requested route ${requestedRouteId} is unavailable; effective route would be ${EFFECTIVE_ROUTE.id}`,
      );
    }
    report.descriptorHash = analyticalTissueDescriptorHash(descriptor);
    report.rowPlanHash = analyticalTissueRowPlanHash(rowPlan);
    report.requestedSourceResponseRef = rowPlan.sourceResponseRef;
    report.effectiveSourceFixtureId = sourceFixture.id;
    report.sourceFixtureHash = hashValue(sourceFixture);

    phase = 'assay-build';
    const assay = buildAnalyticalTissueMuscleTensionAssay({
      descriptor,
      rowPlan,
      sourceFixture,
      delta,
      stationCount,
      radialSegments,
    });
    report.assayHash = assay.assayHash;

    phase = 'artifact-write';
    const products = [
      ['assay.json', `${JSON.stringify(assay, null, 2)}\n`],
      ['contact-sheet.svg', renderAnalyticalTissueAssaySvg(assay)],
    ];
    for (const [rowIndex, row] of assay.rows.entries()) {
      for (const stateId of ['baseline', 'perturbed']) {
        const filename = `${rowIndex + 1}-${safeObjectId(row.id)}-${stateId}.obj`;
        products.push([
          filename,
          analyticalTissueMeshToObj(row[stateId].mesh, {
            objectId: `${row.id}-${stateId}`,
          }),
        ]);
      }
    }

    for (const [relativePath, contents] of products) {
      const outputPath = join(outDir, relativePath);
      await writeFile(outputPath, contents, 'utf8');
      const bytes = await readFile(outputPath);
      report.outputs.push({
        relativePath,
        byteLength: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    report.status = 'completed';
    report.failurePhase = null;
    report.lastTrustworthyEvidence = 'all primary artifacts reread and hashed from disk';
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return { assay, report, reportPath };
  } catch (error) {
    report.status = 'failed';
    report.failurePhase = phase;
    report.error = error instanceof Error ? error.message : String(error);
    report.lastTrustworthyEvidence = phase === 'input-validation'
      ? 'output directory created; no assay artifact emitted'
      : phase === 'assay-build'
        ? 'inputs validated; no assay artifact emitted'
        : `${report.outputs.length} primary artifact(s) reread and hashed from disk`;
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    throw error;
  }
}
