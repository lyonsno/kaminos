export const SPECIMEN_CHECKPOINT_SCHEMA = 'kaminos.specimen-checkpoint.v0';
export const SPECIMEN_VIEW_ARTIFACT_SCHEMA = 'kaminos.specimen-view-artifact.v0';
export const KILN_IMAGE_ARTIFACT_SCHEMA = 'kaminos.kiln.image-artifact.v0';
export const KILN_IMAGE_ROUTE_RECEIPT_SCHEMA = 'kaminos.kiln.image-route-receipt.v0';

export const SPECIMEN_VIEW_KINDS = ['beauty', 'depth', 'normal', 'silhouette', 'mask'];

function unique(values) {
  return [...new Set((values || []).map(value => String(value)).filter(Boolean))];
}

export function buildSpecimenRouteReceipt({
  requestedRoute = 'primitive_specimen_export',
  effectiveRoute = 'fixture_primitive_export',
  runtime = 'kaminos-specimen-checkpoint',
  fallbackReason = 'primitive_fixture_pending_live_clay_bench',
  sourceTruthWarnings = [],
} = {}) {
  const warnings = unique(sourceTruthWarnings);
  if (requestedRoute !== effectiveRoute) warnings.push('route_receipt_requested_effective_mismatch');
  if (requestedRoute !== effectiveRoute && fallbackReason) warnings.push('fallback_route_mismatch');
  return {
    schema: KILN_IMAGE_ROUTE_RECEIPT_SCHEMA,
    requestedRoute,
    effectiveRoute,
    runtime,
    fallbackReason,
    sourceTruthWarnings: unique(warnings),
  };
}

export function createFixturePrimitiveSpecimenCheckpoint({
  specimenId = 'fixture-red-lerm-primitive-001',
  specimenKind = 'red_lerm',
  firstVerticalRole = 'carrier_actor',
  primitiveKind = 'red_lerm_blob',
} = {}) {
  const routeReceipt = buildSpecimenRouteReceipt({
    sourceTruthWarnings: ['fixture_primitive_not_live_sculpt_truth'],
  });
  return {
    schema: SPECIMEN_CHECKPOINT_SCHEMA,
    specimenId,
    specimenKind,
    firstVerticalRole,
    checkpointKind: 'fixture_primitive',
    sourceKind: 'fixture',
    primitiveStack: [
      { kind: primitiveKind, shape: 'squashed_capsule', material: 'matte_red', transform: { x: 0, y: 0, scaleX: 1.12, scaleY: 0.88 } },
      { kind: 'sensing_nub', shape: 'soft_nub', material: 'matte_red_highlight', transform: { x: -0.22, y: -0.28, scaleX: 0.32, scaleY: 0.28 } },
      { kind: 'carry_groove', shape: 'shallow_belly_groove', material: 'shadow_red', transform: { x: 0.05, y: 0.24, scaleX: 0.72, scaleY: 0.18 } },
    ],
    cameraRig: {
      view: 'front_three_quarter',
      projection: 'orthographic',
      width: 128,
      height: 96,
    },
    regionMasks: [
      { id: 'front-cap', role: 'sacred_no_face_cap', mutable: false },
      { id: 'belly-groove', role: 'carry_contact_region', mutable: true },
      { id: 'ground-contact', role: 'terrain_contact_patch', mutable: true },
    ],
    negativeLaw: ['no_visible_eyes', 'no_mouth', 'do_not_install_face', 'keep_schnoz_nub_soft'],
    routeReceipt,
    sourceTruthWarnings: unique(['fixture_primitive_not_live_sculpt_truth', ...routeReceipt.sourceTruthWarnings]),
  };
}

function specimenSvg({ checkpoint, viewKind }) {
  const label = `${checkpoint.specimenKind} ${viewKind}`;
  const palettes = {
    beauty: { body: '#c52a28', nub: '#de3c38', groove: '#7a1717', ground: '#2a1717', text: '#f0c36b', bg: '#151515' },
    depth: { body: '#b8b8b8', nub: '#d4d4d4', groove: '#777777', ground: '#3d3d3d', text: '#cfcfcf', bg: '#111111' },
    normal: { body: '#7da6ff', nub: '#97c7ff', groove: '#c18bff', ground: '#353f64', text: '#c7d6ff', bg: '#11131a' },
    silhouette: { body: '#f2f2f2', nub: '#f2f2f2', groove: '#f2f2f2', ground: '#333333', text: '#dddddd', bg: '#050505' },
    mask: { body: '#ff3158', nub: '#31d6ff', groove: '#ffe14a', ground: '#1f6f3b', text: '#f0c36b', bg: '#080808' },
  };
  const p = palettes[viewKind] || palettes.beauty;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96" viewBox="0 0 128 96">
    <rect width="128" height="96" fill="${p.bg}"/>
    <ellipse cx="64" cy="76" rx="38" ry="9" fill="${p.ground}" opacity=".9"/>
    <ellipse cx="64" cy="57" rx="34" ry="24" fill="${p.body}"/>
    <ellipse cx="55" cy="36" rx="19" ry="20" fill="${p.nub}"/>
    <ellipse cx="64" cy="69" rx="24" ry="5" fill="${p.groove}" opacity=".75"/>
    <circle cx="39" cy="64" r="7" fill="${p.body}" opacity=".85"/>
    <circle cx="88" cy="65" r="6" fill="${p.body}" opacity=".85"/>
    <text x="7" y="90" fill="${p.text}" font-family="monospace" font-size="8">${label}</text>
  </svg>`;
}

function svgDataUrl(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function viewConditioningRoles(viewKind) {
  return unique(['reference', `${viewKind}_source`, viewKind === 'beauty' ? 'material_swatch' : null]);
}

export function exportSpecimenCheckpointViews(checkpoint, viewKinds = SPECIMEN_VIEW_KINDS) {
  if (!checkpoint || checkpoint.schema !== SPECIMEN_CHECKPOINT_SCHEMA) {
    throw new Error('valid specimen checkpoint is required');
  }
  return viewKinds.map(viewKind => {
    const artifactId = `${checkpoint.specimenId}-${viewKind}`;
    const conditioningRoles = viewConditioningRoles(viewKind);
    const source = svgDataUrl(specimenSvg({ checkpoint, viewKind }));
    const imageArtifact = {
      schema: KILN_IMAGE_ARTIFACT_SCHEMA,
      artifactId,
      title: `${checkpoint.specimenKind} ${viewKind} view`,
      source,
      storageRef: source,
      mimeType: 'image/svg+xml',
      width: checkpoint.cameraRig?.width || 128,
      height: checkpoint.cameraRig?.height || 96,
      sourceKind: checkpoint.sourceKind || 'fixture',
      specimenKind: checkpoint.specimenKind,
      firstVerticalRole: checkpoint.firstVerticalRole,
      conditioningRoles,
      specimenCheckpointId: checkpoint.specimenId,
      checkpointKind: checkpoint.checkpointKind,
      viewKind,
      assetRole: 'conditioning_view',
      promotionState: 'bench_evidence',
      routeReceipt: checkpoint.routeReceipt,
      sourceTruthWarnings: checkpoint.sourceTruthWarnings || [],
    };
    return {
      schema: SPECIMEN_VIEW_ARTIFACT_SCHEMA,
      artifactId,
      specimenCheckpointId: checkpoint.specimenId,
      checkpointKind: checkpoint.checkpointKind,
      specimenKind: checkpoint.specimenKind,
      firstVerticalRole: checkpoint.firstVerticalRole,
      viewKind,
      sourceKind: checkpoint.sourceKind || 'fixture',
      conditioningRoles,
      routeReceipt: checkpoint.routeReceipt,
      sourceTruthWarnings: checkpoint.sourceTruthWarnings || [],
      imageArtifact,
    };
  });
}

export function specimenCheckpointWitness({ checkpoint, viewArtifacts } = {}) {
  const views = Array.isArray(viewArtifacts) ? viewArtifacts : exportSpecimenCheckpointViews(checkpoint);
  const viewKinds = views.map(artifact => artifact.viewKind);
  const ok = checkpoint?.schema === SPECIMEN_CHECKPOINT_SCHEMA
    && views.length === SPECIMEN_VIEW_KINDS.length
    && SPECIMEN_VIEW_KINDS.every(kind => viewKinds.includes(kind))
    && views.every(artifact => artifact.schema === SPECIMEN_VIEW_ARTIFACT_SCHEMA && artifact.imageArtifact?.schema === KILN_IMAGE_ARTIFACT_SCHEMA);
  return {
    schema: 'kaminos.specimen-checkpoint-witness.v0',
    ok,
    checkpointSchema: checkpoint?.schema || null,
    viewArtifactSchema: SPECIMEN_VIEW_ARTIFACT_SCHEMA,
    checkpoint,
    viewKinds,
    artifactIds: views.map(artifact => artifact.artifactId),
    sourceTruthWarnings: unique([
      ...(checkpoint?.sourceTruthWarnings || []),
      ...views.flatMap(artifact => artifact.sourceTruthWarnings || []),
    ]),
  };
}
