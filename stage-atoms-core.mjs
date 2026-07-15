export const STAGE_AUDIO_SOURCE_ACCESS_SCHEMA = 'kaminos.stage-audio-source-access.v0';
export const STAGE_ATOMS_SCHEMA = 'kaminos.stage-atoms.v0';
export const MATERIAL_STAGE_FRAME_SCHEMA = 'kaminos.material-stage-frame.v0';
export const MATERIAL_SPATIALIZATION_SCHEMA = 'kaminos.material-spatialization.v0';
export const STAGE_ATOMS_WITNESS_SCHEMA = 'kaminos.stage-atoms-witness.v0';
export const STAGE_ATOMS_ROUTE_IDENTITY = 'stage-atoms-pulp-shaped-material-spatializer-v0';

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, finiteNumber(value, min)));
}

function normalizedLicense(value) {
  return String(value || '').trim().toUpperCase();
}

function isNoDerivativesLicense(license) {
  return /\bND\b|NO[\s_-]*DERIV/.test(normalizedLicense(license));
}

function isNonCommercialLicense(license) {
  return /\bNC\b|NON[\s_-]*COMMERCIAL/.test(normalizedLicense(license));
}

function isCreativeCommonsTransformable(license) {
  const normalized = normalizedLicense(license);
  return (
    normalized === 'CC0' ||
    normalized.includes('PUBLIC DOMAIN') ||
    normalized.startsWith('CC BY') ||
    normalized.startsWith('CREATIVE COMMONS')
  ) && !isNoDerivativesLicense(normalized);
}

function receiptWarningList(sourceKind, license) {
  if (sourceKind === 'spotify_reference') return ['no_lawful_pcm_fuel'];
  if (sourceKind === 'bandcamp_purchase') return ['public_demo_requires_separate_permission'];
  if (isNoDerivativesLicense(license)) return ['no_derivatives_blocks_material_sync'];
  if (isNonCommercialLicense(license)) return ['noncommercial_public_use_requires_review'];
  return [];
}

function combinedReceiptWarnings(sourceKind, license, extraWarnings = []) {
  return Array.from(new Set([
    ...receiptWarningList(sourceKind, license),
    ...extraWarnings.map(warning => String(warning)).filter(Boolean),
  ]));
}

export function classifyAudioSourceAccess(source = {}) {
  const sourceKind = String(source.sourceKind || source.kind || 'unknown');
  const license = String(source.license || '');
  const base = {
    schema: STAGE_AUDIO_SOURCE_ACCESS_SCHEMA,
    sourceKind,
    trackId: String(source.trackId || source.id || ''),
    title: String(source.title || ''),
    artist: String(source.artist || ''),
    license,
    attribution: String(source.attribution || ''),
    downloadUrl: String(source.downloadUrl || ''),
    sourcePageUrl: String(source.sourcePageUrl || source.filePageUrl || ''),
    localPath: String(source.localPath || ''),
    receiptWarnings: combinedReceiptWarnings(sourceKind, license, Array.isArray(source.receiptWarnings) ? source.receiptWarnings : []),
  };

  if (sourceKind === 'spotify_reference') {
    return {
      ...base,
      accessClass: 'reference_only',
      analysisAllowed: false,
      transformAllowed: false,
      syncAllowed: false,
      publicDemoAllowed: false,
      analysisScope: 'none',
    };
  }

  if (sourceKind === 'bandcamp_purchase' || normalizedLicense(license) === 'PERSONAL_PURCHASE') {
    return {
      ...base,
      accessClass: 'private_local_taste',
      analysisAllowed: true,
      transformAllowed: true,
      syncAllowed: true,
      publicDemoAllowed: false,
      analysisScope: 'private_local_only',
    };
  }

  const transformable = isCreativeCommonsTransformable(license);
  const nonCommercial = isNonCommercialLicense(license);
  return {
    ...base,
    accessClass: transformable ? (nonCommercial ? 'private_research_transformable' : 'open_transformable') : 'unknown_or_restricted',
    analysisAllowed: transformable,
    transformAllowed: transformable,
    syncAllowed: transformable,
    publicDemoAllowed: transformable && !nonCommercial,
    analysisScope: transformable && !nonCommercial ? 'public_demo_with_attribution' : transformable ? 'private_research_review_public' : 'none',
  };
}

function byParamKey(controls = []) {
  const map = new Map();
  for (const control of controls) {
    const key = control?.paramKey || control?.param_key || control?.id;
    if (key) map.set(String(key), control);
  }
  return map;
}

function controlPosition(control, viewport = [1, 1], fallbackIndex = 0, fallbackCount = 1) {
  const rect = Array.isArray(control?.rect) ? control.rect : null;
  if (rect && rect.length >= 4) {
    const [x, y, w, h] = rect.map(value => finiteNumber(value, 0));
    const viewportWidth = Math.max(1, finiteNumber(viewport[0], 1));
    const viewportHeight = Math.max(1, finiteNumber(viewport[1], 1));
    const centerX = (x + w / 2) / viewportWidth;
    const centerY = (y + h / 2) / viewportHeight;
    return [
      Number(((centerX - 0.5) * 2).toFixed(6)),
      0,
      Number(((0.5 - centerY) * 2).toFixed(6)),
    ];
  }
  const spread = fallbackCount <= 1 ? 0 : fallbackIndex / (fallbackCount - 1);
  return [Number(((spread - 0.5) * 2).toFixed(6)), 0, Number((0.35 - spread * 0.7).toFixed(6))];
}

function graphFeedbackIncoming(node, connections = []) {
  return connections.some(connection => (
    Boolean(connection?.feedback) &&
    (
      String(connection.destNode ?? connection.dest_node ?? '') === String(node.id) ||
      String(connection.sourceNode ?? connection.source_node ?? '') === String(node.id)
    )
  ));
}

function graphAutomationIncoming(node, connections = []) {
  return connections.some(connection => (
    String(connection.kind || '').toLowerCase() === 'automation' &&
    String(connection.destNode ?? connection.dest_node ?? '') === String(node.id)
  ));
}

function atomFromGraphNode(node, control, graph, index, count, viewport) {
  const id = String(control?.id || control?.paramKey || node?.paramKey || node?.id || `stage-atom-${index}`);
  const confidence = clamp(control?.confidence ?? node?.confidence ?? 1, 0, 1);
  const position = controlPosition(control, viewport, index, count);
  const latencySamples = Math.max(0, finiteNumber(node?.latencySamples ?? node?.latency_samples, 0));
  const level = Math.max(0, finiteNumber(node?.level, index));
  const feedbackIncoming = graphFeedbackIncoming(node, graph.connections || []);
  const automationIncoming = graphAutomationIncoming(node, graph.connections || []);
  const bindingAuthority = control?.paramKey || node?.paramKey
    ? 'pulp-design-ir-param-key'
    : 'pulp-graph-runtime-node';

  return {
    id,
    label: String(control?.label || node?.label || id),
    kind: String(control?.kind || node?.kind || 'stage_atom'),
    sourceNodeId: control?.sourceNodeId || control?.source_node_id || null,
    paramKey: control?.paramKey || node?.paramKey || null,
    confidence,
    stage: {
      position,
      sourceRect: Array.isArray(control?.rect) ? [...control.rect] : null,
      positionAuthority: control?.rect ? 'pulp-design-ir-rect' : 'pulp-graph-level-layout',
    },
    graph: {
      nodeId: node?.id ?? null,
      kind: String(node?.kind || 'Unknown'),
      level,
      latencySamples,
      feedbackIncoming,
      automationIncoming,
    },
    materialRegion: {
      bindingAuthority,
      coupling: clamp(0.24 + confidence * 0.42 + (feedbackIncoming ? 0.18 : 0), 0, 1),
      propagation: clamp(0.2 + level * 0.1 + latencySamples / 512, 0, 1),
      occlusionSeed: clamp(latencySamples / 512 + (feedbackIncoming ? 0.22 : 0), 0, 1),
    },
  };
}

function atomFromControl(control, index, count, viewport) {
  const id = String(control?.id || control?.paramKey || `stage-control-${index}`);
  const confidence = clamp(control?.confidence ?? 1, 0, 1);
  return {
    id,
    label: String(control?.label || id),
    kind: String(control?.kind || 'control'),
    sourceNodeId: control?.sourceNodeId || control?.source_node_id || null,
    paramKey: control?.paramKey || null,
    confidence,
    stage: {
      position: controlPosition(control, viewport, index, count),
      sourceRect: Array.isArray(control?.rect) ? [...control.rect] : null,
      positionAuthority: control?.rect ? 'pulp-design-ir-rect' : 'pulp-control-order-layout',
    },
    graph: {
      nodeId: null,
      kind: 'Control',
      level: index,
      latencySamples: 0,
      feedbackIncoming: false,
      automationIncoming: false,
    },
    materialRegion: {
      bindingAuthority: control?.paramKey ? 'pulp-design-ir-param-key' : 'pulp-design-ir-control',
      coupling: clamp(0.3 + confidence * 0.4, 0, 1),
      propagation: 0.25,
      occlusionSeed: 0.05,
    },
  };
}

function stageRadius(atoms) {
  return atoms.reduce((radius, atom) => Math.max(radius, Math.hypot(atom.stage.position[0], atom.stage.position[2])), 0);
}

export function buildStageAtoms({ sourceAccess, design = {}, graph = {} } = {}) {
  const classifiedSource = sourceAccess?.schema === STAGE_AUDIO_SOURCE_ACCESS_SCHEMA
    ? sourceAccess
    : classifyAudioSourceAccess(sourceAccess || {});
  const controls = Array.isArray(design.controls) ? design.controls : [];
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const controlMap = byParamKey(controls);
  const viewport = Array.isArray(design.viewport) ? design.viewport : [800, 600];
  const usedControls = new Set();
  const atoms = [];

  for (const [index, node] of nodes.entries()) {
    const key = String(node?.paramKey || node?.id || '');
    const control = controlMap.get(key);
    if (control) usedControls.add(control);
    atoms.push(atomFromGraphNode(node, control, graph, index, Math.max(nodes.length, 1), viewport));
  }

  for (const control of controls) {
    if (!usedControls.has(control)) {
      atoms.push(atomFromControl(control, atoms.length, Math.max(controls.length + nodes.length, 1), viewport));
    }
  }

  const falseCloseWarnings = [];
  if (!classifiedSource.analysisAllowed) falseCloseWarnings.push('analysis_not_allowed');
  if (atoms.length === 0) falseCloseWarnings.push('no_stage_atoms');

  return {
    schema: STAGE_ATOMS_SCHEMA,
    routeIdentity: STAGE_ATOMS_ROUTE_IDENTITY,
    sourceAccess: classifiedSource,
    sourceDesign: design,
    sourceGraph: graph,
    atoms,
    stageBounds: {
      radius: Number(stageRadius(atoms).toFixed(6)),
      atomCount: atoms.length,
    },
    falseCloseWarnings,
  };
}

function audioFeature(features, key, fallback = 0) {
  return clamp(features?.[key] ?? fallback, 0, 1);
}

export function simulateStageMaterialFrame(stage, { t = 0, audioFeatures = {} } = {}) {
  const energy = audioFeature(audioFeatures, 'energy');
  const onsetStrength = audioFeature(audioFeatures, 'onsetStrength');
  const recurrenceConfidence = audioFeature(audioFeatures, 'recurrenceConfidence');
  const spectralCentroid = audioFeature(audioFeatures, 'spectralCentroid');

  const materialAtoms = (stage.atoms || []).map(atom => {
    const confidence = clamp(atom.confidence, 0, 1);
    const feedbackBoost = atom.graph.feedbackIncoming ? 0.2 : 0;
    const automationBoost = atom.graph.automationIncoming ? 0.12 : 0;
    const excitation = clamp(
      energy * (0.28 + atom.materialRegion.coupling * 0.46) +
      onsetStrength * 0.18 +
      automationBoost,
      0,
      1,
    );
    const feedbackMemory = clamp(
      recurrenceConfidence * (atom.graph.feedbackIncoming ? 0.72 : 0.22) +
      atom.graph.latencySamples / 768 +
      feedbackBoost,
      0,
      1,
    );
    const occlusion = clamp(
      atom.materialRegion.occlusionSeed +
      spectralCentroid * 0.16 +
      (1 - confidence) * 0.12,
      0,
      1,
    );
    const heat = clamp(excitation * 0.72 + feedbackMemory * 0.24 + atom.materialRegion.propagation * 0.18, 0, 1);
    return {
      id: atom.id,
      label: atom.label,
      position: [...atom.stage.position],
      field: {
        excitation: Number(excitation.toFixed(6)),
        feedbackMemory: Number(feedbackMemory.toFixed(6)),
        occlusion: Number(occlusion.toFixed(6)),
        heat: Number(heat.toFixed(6)),
        coupling: Number(atom.materialRegion.coupling.toFixed(6)),
      },
    };
  });

  return {
    schema: MATERIAL_STAGE_FRAME_SCHEMA,
    routeIdentity: stage.routeIdentity || STAGE_ATOMS_ROUTE_IDENTITY,
    t: finiteNumber(t, 0),
    materialAuthority: 'stage-atoms-plus-lawful-audio-v0',
    sourceAccess: stage.sourceAccess,
    materialAtoms,
    receipts: [
      {
        kind: 'audio_source_access',
        accessClass: stage.sourceAccess?.accessClass || 'unknown',
        analysisAllowed: Boolean(stage.sourceAccess?.analysisAllowed),
        trackId: stage.sourceAccess?.trackId || '',
      },
      ...(stage.atoms || []).map(atom => ({
        kind: 'stage_atom_binding',
        id: atom.id,
        bindingAuthority: atom.materialRegion.bindingAuthority,
        positionAuthority: atom.stage.positionAuthority,
      })),
    ],
  };
}

export function spatializeFromStageMaterial(materialFrame, _options = {}) {
  const emitters = (materialFrame.materialAtoms || [])
    .filter(atom => atom.field.heat > 0.04 || atom.field.feedbackMemory > 0.1)
    .map(atom => {
      const pan = clamp(atom.position[0], -1, 1);
      const direct = clamp(atom.field.excitation * (1 - atom.field.occlusion * 0.45), 0, 1);
      const reverb = clamp(0.08 + atom.field.feedbackMemory * 0.48 + atom.field.occlusion * 0.24, 0, 1);
      const spread = clamp(0.18 + atom.field.heat * 0.38 + atom.field.feedbackMemory * 0.28, 0, 1);
      const lowpass = Math.round(18000 - atom.field.occlusion * 9800 - atom.field.feedbackMemory * 1800);
      return {
        id: atom.id,
        label: atom.label,
        position: atom.position.map(value => Number(value.toFixed(6))),
        send: {
          pan: Number(pan.toFixed(6)),
          direct: Number(direct.toFixed(6)),
          reverb: Number(reverb.toFixed(6)),
          spread: Number(spread.toFixed(6)),
          lowpassHz: Math.max(1200, lowpass),
        },
      };
    });

  return {
    schema: MATERIAL_SPATIALIZATION_SCHEMA,
    routeIdentity: materialFrame.routeIdentity || STAGE_ATOMS_ROUTE_IDENTITY,
    spatializationAuthority: 'material-stage-atoms-v0',
    rawAudioFeatureUse: 'ignored_after_material_frame',
    emitters,
  };
}

export function buildStageAtomsWitness({
  sourceAccess,
  design = {},
  graph = {},
  audioFeatures = {},
  t = 0,
} = {}) {
  const classifiedSource = sourceAccess?.schema === STAGE_AUDIO_SOURCE_ACCESS_SCHEMA
    ? sourceAccess
    : classifyAudioSourceAccess(sourceAccess || {});
  if (!classifiedSource.analysisAllowed) {
    const error = new Error(`analysis_not_allowed:${classifiedSource.sourceKind}`);
    error.code = 'analysis_not_allowed';
    throw error;
  }

  const stage = buildStageAtoms({ sourceAccess: classifiedSource, design, graph });
  const materialFrame = simulateStageMaterialFrame(stage, { t, audioFeatures });
  const spatialization = spatializeFromStageMaterial(materialFrame, {
    rawAudioFeatures: { energy: 0, onsetStrength: 0, recurrenceConfidence: 0, spectralCentroid: 0 },
  });
  const spatializationRawProbe = spatializeFromStageMaterial(materialFrame, {
    rawAudioFeatures: { energy: 1, onsetStrength: 1, recurrenceConfidence: 1, spectralCentroid: 1 },
  });

  return {
    schema: STAGE_ATOMS_WITNESS_SCHEMA,
    routeIdentity: STAGE_ATOMS_ROUTE_IDENTITY,
    stage,
    materialFrame,
    spatialization,
    falseCloseChecks: {
      spotifyReferenceRejected: true,
      spatializerIgnoresRawAudio: JSON.stringify(spatialization.emitters) === JSON.stringify(spatializationRawProbe.emitters),
      stageHasAtoms: stage.atoms.length > 0,
    },
    operatorHandle: {
      sourcePanel: {
        primarySourceKind: classifiedSource.sourceKind,
        accessClass: classifiedSource.accessClass,
        publicDemoAllowed: classifiedSource.publicDemoAllowed,
      },
      nextVisibleRoute: 'stage-atoms-browser-witness-v0',
    },
  };
}
