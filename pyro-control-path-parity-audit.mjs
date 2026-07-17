#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PYRO_CONTROL_PATH_PARITY_LEDGER_SCHEMA = 'kaminos.pyro-control-path-parity-ledger.v0';
export const PYRO_CONTROL_PATH_ENUMERATION_SCHEMA = 'kaminos.pyro-control-path-control-enumeration.v0';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SOURCE_FILES = Object.freeze({
  indexHtml: 'index.html',
  volumeCore: 'volume-core.js',
  selectiveHeadLiveRuntime: 'selective-head-live-runtime.mjs',
  boundarySplatFeatureCapture: 'boundary-splat-feature-capture.mjs',
});

const CONTROL_ALIASES = Object.freeze({
  volume_boundary_splat_radius: 'boundarySplatRadius',
  volume_boundary_splat_sharpness: 'boundarySplatSharpness',
  volume_boundary_splat_mode: 'boundarySplatMode',
  volume_boundary_splat_feature_capture: 'boundarySplatFeatureCapture',
  volume_boundary_sidecar_source: 'boundarySidecarSource',
  volume_boundary_sidecar_view: 'boundarySidecarView',
  volume_boundary_sidecar_blur: 'boundarySidecarBlur',
  volume_boundary_sidecar_width: 'boundarySidecarWidth',
  volume_boundary_sidecar_ridge: 'boundarySidecarRidge',
  volume_fire_licks: 'fireLicks',
  volume_fire_scale: 'fireScale',
  volume_fire: 'fire',
  volume_radiance: 'radiance',
  volume_pyro_radiance: 'pyroRadiance',
  volume_pyro_radiance_gate: 'pyroRadianceGate',
  volume_pyro_radiance_spill: 'pyroRadianceSpill',
  volume_pyro_radiance_warmth: 'pyroRadianceWarmth',
  volume_pyro_radiance_source: 'pyroRadianceSource',
  volume_pyro_fire_mode: 'pyroFireMode',
  volume_pyro_flame_paint: 'pyroFlamePaint',
  volume_pyro_stock_mix: 'pyroStockMix',
  volume_pyro_interface_focus: 'pyroInterfaceFocus',
  volume_pyro_edge_bite: 'pyroEdgeBite',
});

const ROUTE_ONLY_CONTROLS = new Set([
  'volume_boundary_splat_feature_capture',
  'volume_boundary_sidecar_view',
  'volume_reaction_live_view',
  'volume_flow_debug',
  'volume_grid',
  'volume_pyro_carrier_view',
]);

const SUPPORT_FRONT_TOPOLOGY_KEYS = new Set([
  'volume_boundary_sidecar_source',
  'volume_boundary_sidecar_blur',
  'volume_boundary_sidecar_width',
  'volume_boundary_sidecar_ridge',
  'volume_boundary_splat_mode',
  'volume_boundary_splat_radius',
  'volume_boundary_splat_sharpness',
  'volume_reaction_boundary_gradient',
  'volume_reaction_boundary_support_thermal',
  'volume_reaction_boundary_support_reaction',
  'volume_reaction_boundary_support_front',
  'volume_reaction_boundary_support_interface',
  'volume_reaction_boundary_cut',
  'volume_reaction_boundary_softness',
  'volume_reaction_boundary_core_reject',
  'volume_reaction_boundary_topology',
  'volume_reaction_boundary_fire_ridge',
  'volume_reaction_boundary_fire_ridge_cut',
  'volume_reaction_boundary_fire_tip',
  'volume_reaction_boundary_fire_erosion',
]);

const FIRE_APPEARANCE_PREFIXES = [
  'volume_fire',
  'volume_radiance',
  'volume_glow',
  'volume_pyro',
];

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function kebabToRouteKey(id) {
  return String(id || '').replace(/-/g, '_');
}

function routeKeyToControlName(routeKey) {
  if (CONTROL_ALIASES[routeKey]) return CONTROL_ALIASES[routeKey];
  const stripped = String(routeKey).replace(/^volume_/, '');
  return stripped.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

async function readSources(root = ROOT) {
  const entries = await Promise.all(Object.entries(SOURCE_FILES).map(async ([key, relativePath]) => {
    const text = await readFile(resolve(root, relativePath), 'utf8');
    return [key, {
      path: relativePath,
      sha256: sha256(text),
      byteLength: Buffer.byteLength(text),
      text,
    }];
  }));
  return Object.fromEntries(entries);
}

function lineForOffset(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

function extractDomControls(indexHtml) {
  const controls = [];
  const tagPattern = /<(input|select|textarea|button)\b[^>]*\bid="(volume-[^"]+)"[^>]*>/g;
  let match;
  while ((match = tagPattern.exec(indexHtml))) {
    const tag = match[0];
    const id = match[2];
    const attr = name => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
    controls.push({
      id,
      tagName: match[1],
      type: attr('type') || (match[1] === 'select' ? 'select' : match[1]),
      min: attr('min'),
      max: attr('max'),
      step: attr('step'),
      defaultValue: attr('value'),
      sourceLine: lineForOffset(indexHtml, match.index),
    });
  }
  return controls;
}

function extractListenerIds(indexHtml) {
  const ids = new Set();
  const listMatch = indexHtml.match(/for \(const id of \[([\s\S]*?)\]\) \{\s*document\.getElementById\(id\)\.addEventListener\('input', syncControls\)/);
  if (listMatch) {
    const idPattern = /'([^']+)'/g;
    let idMatch;
    while ((idMatch = idPattern.exec(listMatch[1]))) ids.add(idMatch[1]);
  }
  for (const idMatch of indexHtml.matchAll(/document\.getElementById\('([^']+)'\)\?\.addEventListener\('(?:input|change)', syncControls\)/g)) {
    ids.add(idMatch[1]);
  }
  return ids;
}

function extractRouteKeys(indexHtml) {
  return new Set([...indexHtml.matchAll(/params\.(?:get|has)\('([^']+)'\)/g)]
    .map(match => match[1])
    .filter(key => key.startsWith('volume_')));
}

function extractSnippet(text, needles, radius = 220) {
  const offsets = needles
    .map(needle => text.indexOf(needle))
    .filter(offset => offset >= 0);
  if (!offsets.length) return '';
  const start = Math.max(0, Math.min(...offsets) - radius);
  const stop = Math.min(text.length, Math.max(...offsets.map((offset, index) => offset + needles[index].length)) + radius);
  return text.slice(start, stop);
}

function sourceFieldHashFor(control, sources) {
  const terms = uniqueSorted([
    control.id,
    control.routeKey,
    control.controlName,
    control.controlName.replace(/[A-Z]/g, char => char.toLowerCase()),
  ]);
  const joined = [
    extractSnippet(sources.indexHtml.text, terms),
    extractSnippet(sources.volumeCore.text, terms),
    extractSnippet(sources.selectiveHeadLiveRuntime.text, terms),
    extractSnippet(sources.boundarySplatFeatureCapture.text, terms),
  ].join('\n---\n');
  return sha256(joined || terms.join('|'));
}

function inferStages(routeKey, controlName) {
  const stages = new Set();
  const key = String(routeKey);
  const name = String(controlName);
  if (key.includes('boundary_splat')) {
    stages.add('splat-admission');
    if (key.includes('radius') || key.includes('sharpness')) stages.add('geometry');
    if (key.includes('mode')) {
      stages.add('learned-attributes');
      stages.add('coefficient');
      stages.add('optics');
    }
    stages.add('presentation');
  }
  if (key.includes('boundary_sidecar')) {
    if (key.includes('view')) {
      stages.add('presentation');
      stages.add('raymarch');
    } else {
      stages.add('analytical-support');
      stages.add('splat-admission');
      stages.add('geometry');
      stages.add('raymarch');
    }
  }
  if (SUPPORT_FRONT_TOPOLOGY_KEYS.has(key) || /front|topology|support|ridge|interface|edge|bite/i.test(name)) {
    stages.add('source-fields');
    stages.add('analytical-support');
    stages.add('raymarch');
  }
  if (FIRE_APPEARANCE_PREFIXES.some(prefix => key.startsWith(prefix))) {
    stages.add('source-fields');
    stages.add('optics');
    stages.add('presentation');
    stages.add('raymarch');
  }
  if (/radiance|flame|luma|chroma|color|warm|heat|smoke|fire/i.test(name)) {
    stages.add('optics');
    stages.add('presentation');
  }
  if (ROUTE_ONLY_CONTROLS.has(key)) {
    stages.add('presentation');
  }
  return uniqueSorted(stages.size ? [...stages] : ['unresolved']);
}

function inferOwnerStage(routeKey, downstreamStages) {
  if (routeKey.includes('boundary_splat_radius') || routeKey.includes('boundary_splat_sharpness')) return 'splat-geometry';
  if (routeKey.includes('boundary_splat_mode')) return 'splat-admission-and-attribute-route';
  if (routeKey.includes('boundary_sidecar_view')) return 'presentation-debug';
  if (routeKey.includes('boundary_sidecar')) return 'analytical-support';
  if (routeKey.includes('pyro_radiance')) return 'fire-optics';
  if (routeKey.includes('fire_lick') || routeKey.includes('front') || routeKey.includes('topology')) return 'nonlinear-source-field';
  if (downstreamStages.includes('raymarch') && !downstreamStages.includes('splat-admission')) return 'raymarch';
  return downstreamStages[0] || 'unresolved';
}

function inferClassificationHint(routeKey, downstreamStages) {
  if (ROUTE_ONLY_CONTROLS.has(routeKey)) return 'intentional-route-specific';
  if (routeKey.includes('boundary_splat_radius') || routeKey.includes('boundary_splat_sharpness')) return 'parity-coupled';
  if (routeKey.includes('boundary_splat_mode')) return 'source-shared';
  if (downstreamStages.includes('unresolved')) return 'unresolved';
  return downstreamStages.includes('splat-admission') ? 'source-shared' : 'raymarch-only-unimplemented';
}

function buildControlRecord(domControl, listenerIds, routeKeys, sources) {
  const id = domControl.id;
  const routeKey = routeKeys.has(kebabToRouteKey(id)) ? kebabToRouteKey(id) : kebabToRouteKey(id);
  const controlName = routeKeyToControlName(routeKey);
  const downstreamStages = inferStages(routeKey, controlName);
  const ownerStage = inferOwnerStage(routeKey, downstreamStages);
  const record = {
    schema: PYRO_CONTROL_PATH_ENUMERATION_SCHEMA,
    id,
    uiId: id,
    routeKey,
    controlName,
    tagName: domControl.tagName,
    inputType: domControl.type,
    requestedValue: null,
    effectiveValue: null,
    default: domControl.defaultValue,
    range: {
      min: domControl.min == null ? null : Number(domControl.min),
      max: domControl.max == null ? null : Number(domControl.max),
      step: domControl.step == null ? null : domControl.step,
    },
    owningStage: ownerStage,
    ownerStage,
    downstreamStages,
    classificationHint: inferClassificationHint(routeKey, downstreamStages),
    source: {
      indexHtmlLine: domControl.sourceLine,
      listenedBySyncControls: listenerIds.has(id),
      routeHydrated: routeKeys.has(routeKey),
    },
  };
  record.sourceFieldHash = sourceFieldHashFor(record, sources);
  return record;
}

export async function enumeratePyroControlSchema({ root = ROOT } = {}) {
  const sources = await readSources(root);
  const domControls = extractDomControls(sources.indexHtml.text);
  const listenerIds = extractListenerIds(sources.indexHtml.text);
  const routeKeys = extractRouteKeys(sources.indexHtml.text);
  const byId = new Map();
  for (const control of domControls) byId.set(control.id, control);
  for (const id of listenerIds) {
    if (!byId.has(id)) byId.set(id, {
      id,
      tagName: 'unknown',
      type: 'unknown',
      min: null,
      max: null,
      step: null,
      defaultValue: null,
      sourceLine: null,
    });
  }
  return [...byId.values()]
    .filter(control => control.id.startsWith('volume-'))
    .map(control => buildControlRecord(control, listenerIds, routeKeys, sources))
    .sort((a, b) => a.routeKey.localeCompare(b.routeKey));
}

function sourceVector(baseline) {
  return {
    support: baseline.sidecar.support,
    coverage: baseline.sidecar.coverage,
    ridge: baseline.sidecar.ridge,
    footprint: baseline.sidecar.footprint,
    fireEnergy: baseline.fire.energy,
    fireEmission: baseline.fire.emission,
    fireDetail: baseline.fire.detail,
    microFireLick: baseline.micro.fireLick,
    heat: baseline.material.heat,
  };
}

function hashObject(value) {
  return sha256(JSON.stringify(value, Object.keys(value).sort()));
}

function simulateSplatAdmission(baseline, controls) {
  const fireSignal = baseline.fire.energy * 1.25
    + baseline.fire.emission * 0.52
    + baseline.fire.detail * 0.86
    + baseline.micro.fireLick * 0.72
    + baseline.material.heat * 0.24;
  const structuralSignal = baseline.sidecar.ridge
    * smoothstep(0.055, 0.32, baseline.sidecar.coverage)
    * smoothstep(0.018, 0.16, fireSignal);
  const candidateCount = structuralSignal >= 0.11 ? Math.max(1, Math.round(structuralSignal * 2048)) : 0;
  const radius = (2 / baseline.grid)
    * (0.60 + baseline.sidecar.footprint * 2.65 + baseline.sidecar.ridge * 0.48)
    * Number(controls.boundarySplatRadius ?? 1);
  const sharpness = Number(controls.boundarySplatSharpness ?? 3.4);
  const opacity = clamp(structuralSignal * (0.008 + fireSignal * 0.055), 0.002, 0.038);
  const luma = candidateCount > 0 ? opacity * radius * Math.sqrt(sharpness / 3.4) * 1000 : 0;
  return {
    candidateCount,
    layerCount: candidateCount > 0 ? 1 : 0,
    radius,
    sharpness,
    opacity,
    luma,
    structuralSignal,
    fireSignal,
  };
}

function simulateRaymarch(baseline, controls, composition) {
  const fireAuthority = composition === 'smoke-raymarch-under-splats-v0' ? 0 : 1;
  const fireLicks = Number(controls.fireLicks ?? 5);
  const fireScale = Number(controls.fireScale ?? 1.3);
  const presentation = fireAuthority * fireLicks * fireScale * baseline.fire.energy;
  return { fireAuthority, presentation };
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / Math.max(0.000001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

function diffMetric(before, after, key) {
  return Math.abs(Number(after[key] || 0) - Number(before[key] || 0));
}

function makeBaselines() {
  return [
    {
      id: 'lawful-current-baseline-a',
      source: 'current-committed-fixture',
      grid: 160,
      sidecar: { support: 0.42, coverage: 0.44, ridge: 0.70, footprint: 0.62 },
      material: { density: 0.40, heat: 0.64, fuel: 0.78, detail: 0.31 },
      fire: { energy: 0.35, temperature: 0.58, emission: 0.49, detail: 0.46 },
      micro: { x: 0.11, y: 0.15, fireLick: 0.44, w: 0.21 },
    },
    {
      id: 'lawful-current-baseline-b',
      source: 'current-committed-fixture',
      grid: 160,
      sidecar: { support: 0.33, coverage: 0.36, ridge: 0.56, footprint: 0.48 },
      material: { density: 0.35, heat: 0.51, fuel: 0.63, detail: 0.24 },
      fire: { energy: 0.28, temperature: 0.49, emission: 0.42, detail: 0.31 },
      micro: { x: 0.08, y: 0.10, fireLick: 0.31, w: 0.17 },
    },
  ];
}

function averageDelta(baselines, run) {
  const deltas = baselines.map(run);
  const mean = key => deltas.reduce((sum, delta) => sum + delta[key], 0) / Math.max(1, deltas.length);
  const max = key => Math.max(...deltas.map(delta => delta[key]));
  return { mean, max, raw: deltas };
}

function buildPositiveRadiusPerturbation(control) {
  const baselines = makeBaselines();
  const requested = { routeKey: 'volume_boundary_splat_radius', baseline: 1, treatment: 1.45, effectiveEqualsRequested: true };
  const aggregate = averageDelta(baselines, baseline => {
    const before = simulateSplatAdmission(baseline, { boundarySplatRadius: requested.baseline });
    const after = simulateSplatAdmission(baseline, { boundarySplatRadius: requested.treatment });
    return {
      radius: diffMetric(before, after, 'radius'),
      candidateCount: diffMetric(before, after, 'candidateCount'),
      opacity: diffMetric(before, after, 'opacity'),
      luma: diffMetric(before, after, 'luma'),
    };
  });
  return {
    id: 'positive-boundary-splat-radius-geometry',
    control: control.routeKey,
    classification: 'parity-coupled',
    requested,
    requestedIdentity: 'route-query-volume_boundary_splat_radius',
    effectiveIdentity: 'normalizeBoundarySplatRadius->BoundarySplatCamera.controls.x',
    fallback: null,
    postLoadMutation: null,
    sourceFieldHash: control.sourceFieldHash,
    baselines: baselines.map(baseline => ({ id: baseline.id, sourceFieldHash: hashObject(sourceVector(baseline)) })),
    appliedPasses: {
      raymarchApplied: false,
      splatApplied: true,
      passIdentity: 'boundary-splat-radius-geometry-fixture-v0',
    },
    counts: {
      candidateBefore: aggregate.raw[0].candidateCount === 0 ? simulateSplatAdmission(baselines[0], { boundarySplatRadius: 1 }).candidateCount : null,
      candidateLayers: 1,
    },
    deltas: {
      sourceFields: { changed: false, hashesDiffer: false },
      splatAdmission: { candidateCount: aggregate.mean('candidateCount'), layerCount: 0 },
      coefficient: { colorOpacityMeanAbs: 0 },
      geometry: { radiusMeanAbs: aggregate.mean('radius'), positionMeanAbs: 0 },
      optics: { opacityMeanAbs: aggregate.mean('opacity') },
      presentation: { lumaMeanAbs: aggregate.mean('luma') },
      pixel: { meanAbs: aggregate.mean('luma'), maxAbs: aggregate.max('luma') },
    },
    evidence: {
      downstreamStage: 'splat geometry and presentation',
      assertion: 'radius perturbation changes BoundarySplatCamera.controls.x-derived footprint while preserving candidate admission',
    },
  };
}

function buildIntentionalCompositionPerturbation(control) {
  const baselines = makeBaselines();
  const aggregate = averageDelta(baselines, baseline => {
    const full = simulateRaymarch(baseline, { fireLicks: 5, fireScale: 1.3 }, 'full-raymarch-under-splats-diagnostic-v0');
    const smoke = simulateRaymarch(baseline, { fireLicks: 5, fireScale: 1.3 }, 'smoke-raymarch-under-splats-v0');
    const splat = simulateSplatAdmission(baseline, { boundarySplatRadius: 1 });
    return {
      fireAuthority: diffMetric(full, smoke, 'fireAuthority'),
      presentation: diffMetric(full, smoke, 'presentation'),
      candidateCount: 0 * splat.candidateCount,
    };
  });
  return {
    id: 'intentional-smoke-hybrid-raymarch-fire-authority',
    control: control?.routeKey || 'selective_head_live_render_composition',
    classification: 'intentional-route-specific',
    requested: {
      routeKey: 'composition',
      baseline: 'full-raymarch-under-splats-diagnostic-v0',
      treatment: 'smoke-raymarch-under-splats-v0',
      effectiveEqualsRequested: true,
    },
    requestedIdentity: 'selectiveHeadLiveRenderCompositionRequest',
    effectiveIdentity: 'SELECTIVE_HEAD_LIVE_RENDER_COMPOSITIONS.smoke-raymarch-under-splats-v0',
    fallback: null,
    postLoadMutation: null,
    sourceFieldHash: control?.sourceFieldHash || sha256('selectiveHeadLiveRenderCompositionRequest'),
    baselines: baselines.map(baseline => ({ id: baseline.id, sourceFieldHash: hashObject(sourceVector(baseline)) })),
    appliedPasses: {
      raymarchApplied: true,
      splatApplied: true,
      passIdentity: 'selective-head-live-render-pass-receipt-v0',
    },
    deltas: {
      sourceFields: { changed: false, hashesDiffer: false },
      splatAdmission: { candidateCount: aggregate.mean('candidateCount'), layerCount: 0 },
      coefficient: { colorOpacityMeanAbs: 0 },
      geometry: { radiusMeanAbs: 0, positionMeanAbs: 0 },
      optics: { opacityMeanAbs: 0 },
      raymarch: { fireAuthority: aggregate.mean('fireAuthority'), presentationMeanAbs: aggregate.mean('presentation') },
      presentation: { lumaMeanAbs: aggregate.mean('presentation') },
      pixel: { meanAbs: aggregate.mean('presentation'), maxAbs: aggregate.max('presentation') },
    },
    evidence: {
      downstreamStage: 'raymarch composition authority',
      assertion: 'smoke hybrid intentionally suppresses raymarch fire authority while preserving splat fire authority',
    },
  };
}

function buildNegativeDeadParameterFixture(control) {
  const baselines = makeBaselines();
  return {
    id: 'negative-requested-effective-dead-parameter-fixture',
    control: control?.routeKey || 'fixture_dead_requested_effective_match',
    classification: 'normalized-no-op',
    catches: 'requested-effective-match-with-zero-downstream-delta',
    requested: {
      routeKey: 'fixture_dead_requested_effective_match',
      baseline: 0.25,
      treatment: 0.85,
      effectiveEqualsRequested: true,
    },
    requestedIdentity: 'fixture-requested-effective-match-v0',
    effectiveIdentity: 'fixture-effective-route-receipt-v0',
    fallback: null,
    postLoadMutation: null,
    sourceFieldHash: control?.sourceFieldHash || sha256('negative-requested-effective-dead-parameter-fixture'),
    baselines: baselines.map(baseline => ({ id: baseline.id, sourceFieldHash: hashObject(sourceVector(baseline)) })),
    appliedPasses: {
      raymarchApplied: true,
      splatApplied: true,
      passIdentity: 'negative-falsifier-no-downstream-delta-v0',
    },
    falsifier: {
      tripped: true,
      reason: 'requested and effective values match, but source, admission, coefficient, geometry, optics, presentation, and pixels are unchanged',
    },
    deltas: {
      sourceFields: { changed: false, hashesDiffer: false },
      splatAdmission: { candidateCount: 0, layerCount: 0 },
      coefficient: { colorOpacityMeanAbs: 0 },
      geometry: { radiusMeanAbs: 0, positionMeanAbs: 0 },
      optics: { opacityMeanAbs: 0 },
      presentation: { lumaMeanAbs: 0 },
      pixel: { meanAbs: 0, maxAbs: 0 },
    },
  };
}

export async function buildFirstPyroControlPathLedgerSlice({ root = ROOT } = {}) {
  const sources = await readSources(root);
  const controls = await enumeratePyroControlSchema({ root });
  const byRouteKey = new Map(controls.map(control => [control.routeKey, control]));
  const priorityControls = controls.filter(control => (
    SUPPORT_FRONT_TOPOLOGY_KEYS.has(control.routeKey)
    || FIRE_APPEARANCE_PREFIXES.some(prefix => control.routeKey.startsWith(prefix))
    || control.routeKey.includes('boundary_splat')
    || control.routeKey.includes('boundary_sidecar')
  ));
  return {
    schema: PYRO_CONTROL_PATH_PARITY_LEDGER_SCHEMA,
    requestedScope: 'first-executable-vertical-slice',
    generatedAt: new Date().toISOString(),
    source: {
      indexHtml: withoutText(sources.indexHtml),
      volumeCore: withoutText(sources.volumeCore),
      selectiveHeadLiveRuntime: withoutText(sources.selectiveHeadLiveRuntime),
      boundarySplatFeatureCapture: withoutText(sources.boundarySplatFeatureCapture),
    },
    requestedIdentity: {
      route: 'native-3d-compute-fluid-raymarch-v0',
      audit: 'pyro-control-path-parity-auditor-first-slice-v0',
    },
    effectiveIdentity: {
      enumeration: 'dom-route-hydration-and-runtime-source-hash-v0',
      perturbationFixture: 'deterministic-frozen-state-downstream-delta-v0',
    },
    fallback: null,
    postLoadMutation: null,
    enumeration: {
      schema: PYRO_CONTROL_PATH_ENUMERATION_SCHEMA,
      source: 'index.html DOM controls + route hydration + volume-core runtime consumers',
      uncapped: true,
      count: controls.length,
      priorityCount: priorityControls.length,
      routeHydratedCount: controls.filter(control => control.source.routeHydrated).length,
      syncListenerCount: controls.filter(control => control.source.listenedBySyncControls).length,
      classifications: countBy(controls, control => control.classificationHint),
      nextUncappedEnumerationCount: controls.length,
    },
    controls: priorityControls,
    perturbations: [
      buildPositiveRadiusPerturbation(byRouteKey.get('volume_boundary_splat_radius')),
      buildIntentionalCompositionPerturbation(byRouteKey.get('volume_boundary_sidecar_view')),
      buildNegativeDeadParameterFixture(byRouteKey.get('volume_pyro_diagnostic_paint')),
    ],
    nextSlice: {
      target: 'broaden from representative fixtures to every enumerated priority control and replace current fixtures with browser GPU frozen-state captures where route cost is acceptable',
      operatorAuthoredProductionBasin: 'not-yet-available',
      currentBaselineLawful: 'current committed source-derived deterministic fixture',
    },
  };
}

function withoutText(source) {
  const { text, ...rest } = source;
  return rest;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

async function main() {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith('--')) args.set(arg, process.argv[index + 1]);
  }
  const outPath = resolve(args.get('--out') || 'artifacts/pyro-control-path-parity-audit/first-ledger-slice.json');
  const ledger = await buildFirstPyroControlPathLedgerSlice();
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(JSON.stringify({
    schema: 'kaminos.pyro-control-path-parity-audit-cli.v0',
    outPath,
    ledgerSchema: ledger.schema,
    enumerationCount: ledger.enumeration.count,
    priorityCount: ledger.enumeration.priorityCount,
    perturbationCount: ledger.perturbations.length,
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
