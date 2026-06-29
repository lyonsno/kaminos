export const KAMINOS_TRACKED_HAND_SURFACE_SCHEMA = 'kaminos.tracked-hand-surface-compositor.v0';
export const KAMINOS_TRACKED_HAND_SURFACE_WITNESS_SCHEMA = 'kaminos.tracked-hand-surface-witness.v0';
export const PERCEPTASIA_HAND_CONTROL_SCHEMA = 'perceptasia.hand-control.v0';
export const DEFAULT_PERCEPTASIA_HAND_ENDPOINT = '/hand-control-sidecar-event';

export const HAND_SURFACE_FACES = Object.freeze([
  [0, 5, 9], [0, 9, 13], [0, 13, 17], [5, 9, 13], [9, 13, 17],
  [0, 1, 5], [1, 2, 5], [2, 3, 5], [3, 4, 5],
  [5, 6, 10], [5, 9, 10], [6, 7, 11], [6, 10, 11], [7, 8, 12], [7, 11, 12],
  [9, 10, 14], [9, 13, 14], [10, 11, 15], [10, 14, 15], [11, 12, 16], [11, 15, 16],
  [13, 14, 18], [13, 17, 18], [14, 15, 19], [14, 18, 19], [15, 16, 20], [15, 19, 20],
]);

const LIVE_WILOR_RE = /^native_wilor_mini_.*sidecar_live$/;

export function buildFixturePerceptasiaHandPacket(overrides = {}) {
  const landmarks2d = overrides.landmarks2d || [
    { x: 0.510, y: 0.660 },
    { x: 0.475, y: 0.630 },
    { x: 0.446, y: 0.592 },
    { x: 0.429, y: 0.552 },
    { x: 0.475, y: 0.515 },
    { x: 0.458, y: 0.515 },
    { x: 0.440, y: 0.455 },
    { x: 0.430, y: 0.395 },
    { x: 0.489, y: 0.497 },
    { x: 0.512, y: 0.505 },
    { x: 0.512, y: 0.435 },
    { x: 0.513, y: 0.370 },
    { x: 0.515, y: 0.328 },
    { x: 0.565, y: 0.522 },
    { x: 0.582, y: 0.455 },
    { x: 0.594, y: 0.395 },
    { x: 0.602, y: 0.352 },
    { x: 0.612, y: 0.550 },
    { x: 0.641, y: 0.496 },
    { x: 0.662, y: 0.452 },
    { x: 0.678, y: 0.420 },
  ];
  const worldLandmarks = overrides.worldLandmarks || [
    { x: 0, y: 0, z: 0 },
    { x: -0.045, y: 0.03, z: -0.012 },
    { x: -0.08, y: 0.075, z: -0.018 },
    { x: -0.108, y: 0.118, z: -0.016 },
    { x: -0.066, y: 0.148, z: -0.034 },
    { x: -0.062, y: 0.145, z: -0.01 },
    { x: -0.07, y: 0.22, z: -0.032 },
    { x: -0.079, y: 0.292, z: -0.05 },
    { x: -0.05, y: 0.164, z: -0.044 },
    { x: 0, y: 0.158, z: -0.012 },
    { x: 0.004, y: 0.242, z: -0.03 },
    { x: 0.006, y: 0.321, z: -0.048 },
    { x: 0.008, y: 0.375, z: -0.06 },
    { x: 0.056, y: 0.145, z: -0.01 },
    { x: 0.07, y: 0.224, z: -0.028 },
    { x: 0.086, y: 0.294, z: -0.042 },
    { x: 0.098, y: 0.344, z: -0.054 },
    { x: 0.106, y: 0.122, z: -0.008 },
    { x: 0.132, y: 0.19, z: -0.024 },
    { x: 0.154, y: 0.245, z: -0.038 },
    { x: 0.171, y: 0.286, z: -0.05 },
  ];
  const effectiveRoute = overrides.effectiveRoute || overrides.sourceBackend || 'wilor_mini_mps_saved_image_replay';
  const palmNormal = overrides.palmNormal || { x: 0.051, y: -0.19, z: 0.98 };

  return {
    schema: PERCEPTASIA_HAND_CONTROL_SCHEMA,
    source_backend: overrides.sourceBackend || effectiveRoute,
    timestamp: overrides.timestampMs ?? 1000,
    frame_id: overrides.frameId || 'fixture-hand-frame-001',
    handedness: overrides.handedness || 'Right',
    confidence: overrides.confidence ?? 0.93,
    video_size: overrides.videoSize || { width: 1280, height: 720 },
    palm_center: overrides.palmCenter || { x: 0.51, y: 0.54 },
    landmarks_2d: landmarks2d,
    landmarks_3d: worldLandmarks,
    world_landmarks: worldLandmarks,
    mano: overrides.mano || overrides.denseMano || null,
    palm_normal_proxy: palmNormal,
    hand_frame_basis: {
      source: effectiveRoute,
      x_axis: { x: -0.999, y: 0.041, z: -0.009 },
      y_axis: { x: 0.038, y: 0.962, z: 0.27 },
      z_axis: palmNormal,
    },
    openness: overrides.openness ?? 0.81,
    pinch_distance: overrides.pinchDistance ?? 0.035,
    fist_score: overrides.fistScore ?? 0.19,
    spread: overrides.spread ?? 0.285,
    velocity: overrides.velocity || { x_px_per_s: 0, y_px_per_s: 0, px_per_s: 0 },
    jitter_px: overrides.jitterPx ?? 0,
    mode_suggestion: overrides.modeSuggestion || 'precision',
    debug: {
      dropped_frames: 0,
      tracking_resets: 0,
      relocalization: false,
      backend_errors: [],
      evidence_route: effectiveRoute,
      model_route: overrides.modelRoute || 'WiLoR-mini fork lyonsno/codex/mps-layout-smoke-0522',
      device_route: effectiveRoute.includes('mlx') ? 'mlx' : 'mps',
      telemetry: overrides.telemetry || null,
      ...(overrides.debug || {}),
    },
  };
}

export function composeTrackedHandSurface(packet = {}, options = {}) {
  const nowMs = finite(options.nowMs) ?? Date.now();
  const maxFreshnessMs = finite(options.maxFreshnessMs) ?? 180;
  const requestedEndpoint = options.requestedEndpoint || DEFAULT_PERCEPTASIA_HAND_ENDPOINT;
  const effectiveEndpoint = options.effectiveEndpoint || requestedEndpoint;
  const source = normalizePerceptasiaHandPacket(packet);
  const downgrades = [];
  const falseAuthorityViolations = [];

  const sourceBackend = source.sourceBackend || 'unknown';
  const effectiveRoute = source.effectiveRoute || sourceBackend;
  const isLiveWilor = LIVE_WILOR_RE.test(sourceBackend) && LIVE_WILOR_RE.test(effectiveRoute);
  if (!isLiveWilor) {
    downgrades.push({
      code: 'hand_backend_not_live_wilor',
      detail: `effective route ${effectiveRoute} from backend ${sourceBackend} is not live WiLoR sidecar authority`,
    });
    if (options.consumer?.schema) {
      falseAuthorityViolations.push('consumer_must_not_claim_live_from_replay_backend');
    }
  }

  const ageMs = source.timestampMs === null ? null : Math.max(0, nowMs - source.timestampMs);
  const freshnessStatus = ageMs === null ? 'unknown' : ageMs <= maxFreshnessMs ? 'fresh' : 'stale';
  if (freshnessStatus !== 'fresh') {
    downgrades.push({
      code: 'stale_hand_packet',
      detail: ageMs === null ? 'packet timestamp missing' : `packet age ${round(ageMs, 3)}ms exceeds ${maxFreshnessMs}ms`,
    });
  }

  const webcamStatus = classifyWebcam(options.webcam);
  if (webcamStatus === 'blank_or_hidden' || webcamStatus === 'missing') {
    downgrades.push({ code: 'blank_or_hidden_webcam', detail: `webcam status ${webcamStatus}` });
  } else if (webcamStatus === 'visible_synthetic_fixture') {
    downgrades.push({ code: 'synthetic_webcam_frame', detail: 'visual ground truth is synthetic, not the operator webcam' });
  }

  const denseMano = normalizeDenseMano(source.denseMano);
  const hasLandmarkSurface = source.landmarks2d.length >= 21 && source.worldLandmarks.length >= 21;
  const surfaceValid = denseMano.present || hasLandmarkSurface;
  if (!surfaceValid) {
    downgrades.push({
      code: 'missing_hand_surface_frame',
      detail: `need dense MANO or 21 2d/world landmarks, got ${source.landmarks2d.length} 2d and ${source.worldLandmarks.length} world`,
    });
  }

  const attachments = normalizeAttachments(options.attachments || [], source, surfaceValid, downgrades);
  const rejectedAttachment = attachments.some((attachment) => attachment.mode === 'screen_space_rejected');
  const sceneDepth = evaluateSceneDepth(options.sceneDepth || { requested: false });
  if (sceneDepth.status === 'requested_unavailable') {
    downgrades.push({ code: 'scene_depth_requested_unavailable', detail: 'scene depth was requested but no effective fresh route was supplied' });
  } else if (sceneDepth.status === 'stale') {
    downgrades.push({ code: 'scene_depth_stale', detail: `scene depth age ${sceneDepth.ageMs}ms exceeds ${sceneDepth.maxFreshnessMs}ms` });
  }

  const invalid = !surfaceValid || rejectedAttachment || webcamStatus === 'blank_or_hidden' || webcamStatus === 'missing';
  let authority = 'synthetic_or_replay_surface';
  if (invalid) {
    authority = 'invalid';
  } else if (isLiveWilor && freshnessStatus === 'fresh' && webcamStatus === 'visible_live') {
    authority = sceneDepth.status === 'requested_unavailable' || sceneDepth.status === 'stale'
      ? 'live_tracked_hand_surface_scene_depth_downgraded'
      : 'live_tracked_hand_surface';
  }

  return {
    schema: KAMINOS_TRACKED_HAND_SURFACE_SCHEMA,
    authority,
    sourceTruth: {
      owner: 'kaminos',
      sourceSchema: source.schema,
      sourceBranchHint: 'perceptasia:cc/palm-daddy-live-receipt-video-0609',
      endpoint: {
        requested: requestedEndpoint,
        effective: effectiveEndpoint,
        fallback: effectiveEndpoint !== requestedEndpoint,
      },
      backendIdentity: sourceBackend,
      effectiveRoute,
      modelRoute: source.modelRoute,
      deviceRoute: source.deviceRoute,
      packetFrameId: source.frameId,
      handedness: source.handedness,
      confidence: source.confidence,
      packetTimestampMs: source.timestampMs,
      routeTelemetry: source.telemetry,
    },
    freshness: {
      nowMs,
      packetTimestampMs: source.timestampMs,
      ageMs,
      maxFreshnessMs,
      status: freshnessStatus,
    },
    webcam: {
      status: webcamStatus,
      source: options.webcam?.source || 'missing',
      frameId: options.webcam?.frameId || null,
      dimensions: {
        width: Number(options.webcam?.width || 0),
        height: Number(options.webcam?.height || 0),
      },
    },
    surface: {
      status: surfaceValid ? 'valid' : 'invalid',
      surfaceSource: denseMano.present ? 'dense_mano' : hasLandmarkSurface ? 'landmark_surface' : 'none',
      palmCenter: source.palmCenter,
      palmNormal: source.palmNormal,
      basis: source.basis,
      landmarks2d: source.landmarks2d,
      worldLandmarks: source.worldLandmarks,
      faces: hasLandmarkSurface ? HAND_SURFACE_FACES.map((face) => [...face]) : [],
      denseMano,
      poseScalars: {
        openness: source.openness,
        pinchDistance: source.pinchDistance,
        fistScore: source.fistScore,
        spread: source.spread,
        modeSuggestion: source.modeSuggestion,
      },
    },
    attachments,
    sceneDepth,
    consumerBridge: {
      consumerId: options.consumer?.id || null,
      consumerSchema: options.consumer?.schema || null,
      ownership: options.consumer?.ownership || 'unspecified_consumer',
      sourceTruthOwner: 'kaminos',
      contractNote: 'Kaminos owns tracked webcam/hand-surface source truth; consumers attach inhabitants or gameplay semantics downstream.',
    },
    downgrades: uniqueDowngrades(downgrades),
    falseAuthorityViolations: uniqueStrings(falseAuthorityViolations),
  };
}

export function renderTrackedHandSurfaceWitnessSvg(report, size = {}) {
  const width = Math.max(420, Math.floor(size.width || 960));
  const height = Math.max(260, Math.floor(size.height || 540));
  const panelWidth = Math.max(310, Math.floor(width * 0.36));
  const frameWidth = width - panelWidth;
  const points = report.surface.landmarks2d
    .map((point) => `${scaleX(point.x, frameWidth).toFixed(1)},${scaleY(point.y, height).toFixed(1)}`)
    .join(' ');
  const facePolygons = report.surface.faces.slice(0, 16).map((face) => {
    const polygon = face
      .map((index) => report.surface.landmarks2d[index])
      .filter(Boolean)
      .map((point) => `${scaleX(point.x, frameWidth).toFixed(1)},${scaleY(point.y, height).toFixed(1)}`)
      .join(' ');
    return polygon ? `<polygon class="hand-face" points="${polygon}" />` : '';
  }).join('');
  const attachments = report.attachments.map((attachment) => {
    const x = scaleX(attachment.screen.x, frameWidth);
    const y = scaleY(attachment.screen.y, height);
    const fill = attachment.id.includes('yellow') ? '#f2d55d' : attachment.id.includes('blue') ? '#5fb6f0' : '#e85b4d';
    return [
      `<g id="${escapeXml(attachment.id)}" class="surface-inhabitant" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">`,
      `<ellipse rx="14" ry="7.5" fill="${fill}" stroke="#170c08" stroke-width="2" />`,
      '<circle cx="7" cy="-2" r="2" fill="#140b08" />',
      `<title>${escapeXml(attachment.id)} ${escapeXml(attachment.mode)} depth ${round(attachment.depth, 4)}</title>`,
      '</g>',
    ].join('');
  }).join('');
  const lines = [
    `schema: ${report.schema}`,
    `authority: ${report.authority}`,
    `endpoint: ${report.sourceTruth.endpoint.effective}`,
    `backend: ${report.sourceTruth.backendIdentity}`,
    `freshness: ${report.freshness.status} age=${report.freshness.ageMs ?? 'unknown'}ms`,
    `webcam: ${report.webcam.status} ${report.webcam.frameId || ''}`,
    `surface: ${report.surface.surfaceSource} ${report.surface.status}`,
    `dense mano: ${report.surface.denseMano.present ? `${report.surface.denseMano.vertexCount}v/${report.surface.denseMano.faceCount}f` : 'none'}`,
    `consumer: ${report.consumerBridge.consumerId || 'none'}`,
    ...report.downgrades.slice(0, 8).map((entry) => `downgrade: ${entry.code}`),
  ].map((line) => truncate(line, 48));
  const textRows = lines.map((line, index) => (
    `<text x="${frameWidth + 18}" y="${34 + index * 21}" class="receipt-line">${escapeXml(line)}</text>`
  )).join('');

  return [
    `<svg id="kaminos-tracked-hand-surface-witness" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Kaminos tracked hand surface witness">`,
    '<defs>',
    '<linearGradient id="webcam-ground-truth" x1="0" y1="0" x2="1" y2="1">',
    '<stop offset="0%" stop-color="#22344a" />',
    '<stop offset="46%" stop-color="#a67864" />',
    '<stop offset="100%" stop-color="#101418" />',
    '</linearGradient>',
    '<style>',
    '.receipt-line{font:14px ui-monospace,SFMono-Regular,Menlo,monospace;fill:#d7eee2}.hand-face{fill:rgba(92,214,190,0.18);stroke:rgba(220,255,240,0.62);stroke-width:1.2}.surface-inhabitant{filter:drop-shadow(0 2px 2px rgba(0,0,0,.4))}.label{font:700 14px ui-monospace,SFMono-Regular,Menlo,monospace;fill:#f0fff5}',
    '</style>',
    '</defs>',
    `<rect x="0" y="0" width="${frameWidth}" height="${height}" fill="url(#webcam-ground-truth)" />`,
    `<path d="M ${frameWidth * 0.18} ${height * 0.88} C ${frameWidth * 0.28} ${height * 0.44}, ${frameWidth * 0.47} ${height * 0.29}, ${frameWidth * 0.74} ${height * 0.46} C ${frameWidth * 0.88} ${height * 0.58}, ${frameWidth * 0.76} ${height * 0.82}, ${frameWidth * 0.57} ${height * 0.87} C ${frameWidth * 0.39} ${height * 0.93}, ${frameWidth * 0.26} ${height * 0.96}, ${frameWidth * 0.18} ${height * 0.88} Z" fill="rgba(229,182,146,0.52)" stroke="rgba(255,226,203,0.55)" stroke-width="3" />`,
    `<g id="hand-surface-frame">${facePolygons}<polyline points="${points}" fill="none" stroke="rgba(220,255,238,0.32)" stroke-width="1" /></g>`,
    attachments,
    `<rect x="${frameWidth}" y="0" width="${panelWidth}" height="${height}" fill="#101716" />`,
    `<text x="${frameWidth + 18}" y="18" class="label">Kaminos hand surface compositor</text>`,
    textRows,
    '</svg>',
  ].join('');
}

function normalizePerceptasiaHandPacket(packet = {}) {
  const event = packet.event && typeof packet.event === 'object' ? packet.event : packet;
  const debug = event.debug || {};
  const worldLandmarks = validVec3List(event.world_landmarks || event.landmarks_3d);
  const effectiveRoute = debug.evidence_route || event.effective_route || event.source_backend || 'unknown';
  return {
    schema: event.schema || PERCEPTASIA_HAND_CONTROL_SCHEMA,
    sourceBackend: event.source_backend || 'unknown',
    effectiveRoute,
    modelRoute: debug.model_route || null,
    deviceRoute: debug.device_route || null,
    timestampMs: finite(event.timestamp_ms) ?? finite(event.timestamp) ?? null,
    frameId: event.frame_id ?? null,
    handedness: event.handedness || 'unknown',
    confidence: finite(event.confidence),
    palmCenter: validVec2(event.palm_center) || { x: 0.5, y: 0.5 },
    landmarks2d: validVec2List(event.landmarks_2d),
    worldLandmarks,
    denseMano: event.mano || event.dense_mano || null,
    palmNormal: validVec3(event.palm_normal_proxy) || validVec3(event.hand_frame_basis?.z_axis) || null,
    basis: normalizeBasis(event.hand_frame_basis, effectiveRoute),
    openness: finite(event.openness),
    pinchDistance: finite(event.pinch_distance),
    fistScore: finite(event.fist_score),
    spread: finite(event.spread),
    modeSuggestion: event.mode_suggestion || null,
    telemetry: debug.telemetry || null,
  };
}

function normalizeDenseMano(input) {
  const vertices = Array.isArray(input?.vertices) ? validVec3List(input.vertices) : [];
  const faces = Array.isArray(input?.faces)
    ? input.faces
      .map((face) => Array.isArray(face) ? face.map((value) => Number(value)).filter(Number.isInteger) : [])
      .filter((face) => face.length >= 3)
    : [];
  const present = vertices.length >= 3 && faces.length >= 1;
  return {
    present,
    contract: input?.contract || input?.schema || null,
    coordinateSpace: input?.coordinateSpace || input?.coordinate_space || null,
    sourceCoordinateSpace: input?.sourceCoordinateSpace || input?.source_coordinate_space || null,
    vertexCount: finite(input?.vertex_count) ?? finite(input?.vertexCount) ?? vertices.length,
    faceCount: finite(input?.face_count) ?? finite(input?.faceCount) ?? faces.length,
    topologyStatus: input?.topology_status || input?.mesh_topology_status || (present ? 'faces_available' : 'faces_unavailable'),
    vertices,
    faces,
  };
}

function normalizeAttachments(attachments, source, surfaceValid, downgrades) {
  if (!attachments.length) return [];
  return attachments.map((attachment, index) => {
    if (attachment.mode === 'screen_space') {
      downgrades.push({
        code: 'screen_space_attachment_rejected',
        detail: `attachment ${attachment.id || index} supplied screen coordinates instead of hand surface coordinates`,
      });
      return {
        id: attachment.id || `attachment-${index}`,
        kind: attachment.kind || 'unknown',
        mode: 'screen_space_rejected',
        face: null,
        barycentric: null,
        screen: validVec2(attachment.screen) || { x: 0.5, y: 0.5 },
        world: null,
        depth: 0,
        reason: 'screen-space stickers do not satisfy tracked hand-surface composition',
      };
    }
    const face = attachment.face || HAND_SURFACE_FACES[index % HAND_SURFACE_FACES.length];
    const barycentric = normalizeBarycentric(attachment.barycentric || [0.33, 0.34, 0.33]);
    const screen = surfaceValid && source.landmarks2d.length >= 21
      ? barycentricPoint2(source.landmarks2d, face, barycentric)
      : { x: 0, y: 0 };
    const world = surfaceValid && source.worldLandmarks.length >= 21
      ? barycentricPoint3(source.worldLandmarks, face, barycentric)
      : null;
    return {
      id: attachment.id || `attachment-${index}`,
      kind: attachment.kind || 'surface_inhabitant',
      mode: 'hand_surface',
      face: [...face],
      barycentric,
      screen,
      world,
      depth: world?.z ?? 0,
      reason: surfaceValid ? 'attached by hand-face barycentric coordinates' : 'surface frame invalid',
    };
  });
}

function evaluateSceneDepth(input = {}) {
  const requested = input.requested === true;
  const maxFreshnessMs = finite(input.maxFreshnessMs) ?? 1000;
  if (!requested) {
    return { requested: false, status: 'not_requested', effectiveRoute: null, ageMs: null, maxFreshnessMs };
  }
  const ageMs = finite(input.ageMs);
  if (!input.effectiveRoute || ageMs === null) {
    return { requested: true, status: 'requested_unavailable', effectiveRoute: input.effectiveRoute || null, ageMs: null, maxFreshnessMs };
  }
  return {
    requested: true,
    status: ageMs <= maxFreshnessMs ? 'fresh_effective' : 'stale',
    effectiveRoute: input.effectiveRoute,
    ageMs,
    maxFreshnessMs,
  };
}

function classifyWebcam(webcam = {}) {
  if (!webcam || webcam.source === 'missing') return 'missing';
  const width = Number(webcam.width || 0);
  const height = Number(webcam.height || 0);
  if (!webcam.visible || webcam.blank || width <= 1 || height <= 1) return 'blank_or_hidden';
  return webcam.source === 'live_webcam' ? 'visible_live' : 'visible_synthetic_fixture';
}

function normalizeBasis(frame, fallbackSource) {
  if (!frame || typeof frame !== 'object') return null;
  return {
    source: frame.source || fallbackSource || 'unknown',
    xAxis: validVec3(frame.x_axis) || null,
    yAxis: validVec3(frame.y_axis) || null,
    zAxis: validVec3(frame.z_axis) || null,
  };
}

function normalizeBarycentric(values) {
  const raw = Array.isArray(values) ? values.slice(0, 3).map((value) => finite(value) ?? 0) : [0.33, 0.34, 0.33];
  while (raw.length < 3) raw.push(0);
  const sum = raw.reduce((acc, value) => acc + value, 0);
  if (!Number.isFinite(sum) || Math.abs(sum) < 0.000001) return [0.33, 0.34, 0.33];
  return raw.map((value) => value / sum);
}

function barycentricPoint2(points, face, barycentric) {
  return face.reduce((acc, pointIndex, faceIndex) => {
    const point = points[pointIndex] || { x: 0, y: 0 };
    const weight = barycentric[faceIndex] || 0;
    return { x: acc.x + point.x * weight, y: acc.y + point.y * weight };
  }, { x: 0, y: 0 });
}

function barycentricPoint3(points, face, barycentric) {
  return face.reduce((acc, pointIndex, faceIndex) => {
    const point = points[pointIndex] || { x: 0, y: 0, z: 0 };
    const weight = barycentric[faceIndex] || 0;
    return {
      x: acc.x + point.x * weight,
      y: acc.y + point.y * weight,
      z: acc.z + point.z * weight,
    };
  }, { x: 0, y: 0, z: 0 });
}

function validVec2List(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const point = validVec2(entry);
    return point ? [point] : [];
  });
}

function validVec3List(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const point = validVec3(entry);
    return point ? [point] : [];
  });
}

function validVec2(value) {
  if (!value || typeof value !== 'object') return null;
  const x = finite(value.x);
  const y = finite(value.y);
  return x === null || y === null ? null : { x, y };
}

function validVec3(value) {
  if (!value || typeof value !== 'object') return null;
  const x = finite(value.x);
  const y = finite(value.y);
  const z = finite(value.z);
  return x === null || y === null || z === null ? null : { x, y, z };
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function uniqueDowngrades(values) {
  const seen = new Set();
  return values.filter((entry) => {
    const key = `${entry.code}:${entry.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function round(value, digits = 4) {
  if (!Number.isFinite(Number(value))) return value;
  const scale = 10 ** digits;
  return Math.round(Number(value) * scale) / scale;
}

function scaleX(x, width) {
  return Math.max(0, Math.min(width, Number(x || 0) * width));
}

function scaleY(y, height) {
  return Math.max(0, Math.min(height, Number(y || 0) * height));
}

function truncate(value, max) {
  const text = String(value);
  return text.length <= max ? text : `${text.slice(0, max - 1)}...`;
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (char) => {
    switch (char) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      case "'": return '&apos;';
      default: return char;
    }
  });
}
