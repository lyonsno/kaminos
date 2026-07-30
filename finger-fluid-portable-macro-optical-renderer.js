export const KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_SCHEMA =
  'kaminos.finger-fluid.portable-macro-optical-renderer.v0';
export const KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_ROUTE =
  'kaminos/finger-fluid/portable-macro-screen-space-optics-v0';
export const KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_FAILURE_SCHEMA =
  'kaminos.finger-fluid.portable-macro-optical-renderer-failure.v0';
export const KAMINOS_PORTABLE_MACRO_OPTICAL_SHADER_ROUTE =
  'wgsl-portable-macro-fresnel-refraction-absorption-v0';
export const KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_REGULAR_GRID_DEBUG_ROUTE =
  'kaminos/finger-fluid/portable-macro-regular-grid-debug-v0';
export const KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_WET_BOUNDARY_CLIPPED_ROUTE =
  'kaminos/finger-fluid/portable-macro-wet-boundary-clipped-v0';
export const KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_CONTINUOUS_PATCH_ROUTE =
  'kaminos/finger-fluid/portable-macro-continuous-patch-v0';

const PORTABLE_UPLOAD_SCHEMA =
  'kaminos.finger-fluid.portable-macro-upload-snapshot.v1';
const MACRO_WET_BOUNDARY_SCHEMA = 'kaminos.fluid.macro-wet-boundary.v1';
const MACRO_WET_BOUNDARY_ROUTE = 'kaminos/fluid/macro-wet-boundary';
const CLIPPED_AMBIGUITY_ROUTE = 'asymptotic-decider-stable-cell-v1';
const CONTINUOUS_PATCH_SUBDIVISIONS = 4;
const VERTEX_STRIDE_FLOATS = 12;
const VERTEX_STRIDE_BYTES = VERTEX_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const UNIFORM_FLOATS = 44;
const UNIFORM_BYTES = UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function reportedFailure(message, diagnostics, details = {}) {
  const error = new Error(message);
  error.report = Object.freeze({
    schema: KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_FAILURE_SCHEMA,
    requestedRoute: diagnostics.requestedRoute ?? null,
    effectiveRoute: null,
    requestedTopologyRoute: diagnostics.requestedTopologyRoute ?? null,
    effectiveTopologyRoute: null,
    failurePhase: diagnostics.phase,
    lastTrustworthyEvidence: diagnostics.lastTrustworthyEvidence,
    primaryOutputWritten: false,
    partial: true,
    blank: true,
    ...details,
  });
  return error;
}

function fail(message, diagnostics, details) {
  throw reportedFailure(message, diagnostics, details);
}

function requireIdentity(snapshot, expectedIdentity, diagnostics) {
  diagnostics.phase = 'validate-source-identity';
  const fields = [
    ['geometry identity', 'geometryIdentity'],
    ['terrain id', 'terrainId'],
    ['source handle id', 'sourceHandleId'],
    ['producer revision', 'producerRevision'],
  ];
  for (const [label, field] of fields) {
    if (!isNonEmptyString(expectedIdentity?.[field])) {
      fail(`expected ${label} is missing`, diagnostics);
    }
    if (snapshot[field] !== expectedIdentity[field]) {
      fail(`${label} is stale or substituted`, diagnostics, {
        expected: expectedIdentity[field],
        actual: snapshot[field] ?? null,
      });
    }
  }
  for (const [label, field] of [
    ['terrain epoch', 'terrainEpoch'],
    ['fluid epoch', 'fluidEpoch'],
  ]) {
    if (!Number.isInteger(expectedIdentity?.[field]) || expectedIdentity[field] < 0) {
      fail(`expected ${label} is missing`, diagnostics);
    }
    if (snapshot[field] !== expectedIdentity[field]) {
      fail(`${label} is stale or substituted`, diagnostics, {
        expected: expectedIdentity[field],
        actual: snapshot[field] ?? null,
      });
    }
  }
  const snapshotSource = snapshot.source;
  const expectedSource = expectedIdentity.source;
  if (
    !snapshotSource
    || typeof snapshotSource !== 'object'
    || !expectedSource
    || typeof expectedSource !== 'object'
  ) {
    fail('portable terrain source identity is missing', diagnostics);
  }
  for (const field of ['requested', 'effective', 'producerId', 'producerRevision']) {
    if (!isNonEmptyString(expectedSource[field])) {
      fail(`expected terrain source ${field} is missing`, diagnostics);
    }
    if (snapshotSource[field] !== expectedSource[field]) {
      fail(`terrain source ${field} is stale or substituted`, diagnostics, {
        expected: expectedSource[field],
        actual: snapshotSource[field] ?? null,
      });
    }
  }
  if (
    snapshotSource.requested !== snapshotSource.effective
    || (
      snapshotSource.fallbackStatus != null
      && snapshotSource.fallbackStatus !== 'none'
    )
  ) {
    fail('terrain source route is fallback or substituted', diagnostics, {
      requested: snapshotSource.requested ?? null,
      effective: snapshotSource.effective ?? null,
      fallbackStatus: snapshotSource.fallbackStatus ?? null,
    });
  }
  diagnostics.lastTrustworthyEvidence = 'source-identity-exact';
}

function requireNumericArray(value, length, label, diagnostics) {
  if (
    value == null
    || typeof value.length !== 'number'
    || value.length !== length
  ) {
    fail(`${label} length is incomplete`, diagnostics, {
      expectedLength: length,
      actualLength: value?.length ?? null,
    });
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!isFiniteNumber(value[index])) {
      fail(`${label} contains a non-finite value`, diagnostics, { index });
    }
  }
}

function requireSourceGeometry(snapshot, diagnostics) {
  diagnostics.phase = 'validate-source-geometry';
  if (snapshot?.schema !== PORTABLE_UPLOAD_SCHEMA) {
    fail(`portable upload schema is unsupported: ${snapshot?.schema ?? 'missing'}`, diagnostics);
  }
  if (
    !Number.isInteger(snapshot.width)
    || snapshot.width < 2
    || !Number.isInteger(snapshot.height)
    || snapshot.height < 2
    || snapshot.sampleCount !== snapshot.width * snapshot.height
  ) {
    fail('portable upload grid dimensions are incomplete or inconsistent', diagnostics);
  }
  if (!isFiniteNumber(snapshot.worldMetersPerUnit) || snapshot.worldMetersPerUnit <= 0) {
    fail('portable upload world meters per unit must be finite and positive', diagnostics);
  }
  const scalarLength = snapshot.sampleCount;
  const vectorLength = snapshot.sampleCount * 3;
  requireNumericArray(snapshot.mappedDepth, scalarLength, 'mapped depth', diagnostics);
  requireNumericArray(snapshot.mappedMomentumU, scalarLength, 'mapped momentum U', diagnostics);
  requireNumericArray(snapshot.mappedMomentumV, scalarLength, 'mapped momentum V', diagnostics);
  requireNumericArray(snapshot.supportPosition, vectorLength, 'support position', diagnostics);
  requireNumericArray(snapshot.tangentU, vectorLength, 'tangent U', diagnostics);
  requireNumericArray(snapshot.tangentV, vectorLength, 'tangent V', diagnostics);
  requireNumericArray(snapshot.normal, vectorLength, 'normal', diagnostics);
  requireNumericArray(snapshot.jacobian, scalarLength, 'Jacobian', diagnostics);
  requireNumericArray(snapshot.supportVelocity, vectorLength, 'support velocity', diagnostics);
  for (let index = 0; index < snapshot.jacobian.length; index += 1) {
    if (snapshot.jacobian[index] <= 0) {
      fail('Jacobian must remain finite and positive', diagnostics, { index });
    }
    if (snapshot.mappedDepth[index] < 0) {
      fail('mapped depth must remain nonnegative', diagnostics, { index });
    }
  }
  const material = snapshot.physicalMaterial;
  if (
    !material
    || !isFiniteNumber(material.densityKgM3)
    || material.densityKgM3 <= 0
    || (
      material.dynamicViscosityPaS != null
      && (
        !isFiniteNumber(material.dynamicViscosityPaS)
        || material.dynamicViscosityPaS < 0
      )
    )
  ) {
    fail('portable physical material is incomplete', diagnostics);
  }
  requireNumericArray(
    material.absorptionPerMeter,
    3,
    'absorption per meter',
    diagnostics,
  );
  if (material.absorptionPerMeter.some(value => value < 0)) {
    fail('absorption per meter must remain nonnegative', diagnostics);
  }
  if (
    !isFiniteNumber(snapshot.confidence)
    || snapshot.confidence < 0
    || snapshot.confidence > 1
  ) {
    fail('portable source confidence must be finite and normalized', diagnostics);
  }
  diagnostics.lastTrustworthyEvidence = 'source-geometry-complete';
}

function requireMatrix(value, label, diagnostics) {
  requireNumericArray(value, 16, label, diagnostics);
}

function requireAttachment(attachment, {
  label,
  frameId,
  width,
  height,
  formats,
  encoding,
  colorSpace,
  mapping,
  matchExtent = true,
}, diagnostics) {
  if (!attachment || typeof attachment !== 'object') {
    fail(`${label} attachment is missing`, diagnostics);
  }
  if (attachment.authority !== 'host_live_frame') {
    fail(`${label} authority is unsupported or fallback`, diagnostics);
  }
  if (!isNonEmptyString(attachment.attachmentId)) {
    fail(`${label} attachment identity is missing`, diagnostics);
  }
  if (attachment.frameId !== frameId) {
    fail(`${label} frame identity is stale or substituted`, diagnostics);
  }
  if (
    !Number.isInteger(attachment.width)
    || attachment.width < 1
    || !Number.isInteger(attachment.height)
    || attachment.height < 1
  ) {
    fail(`${label} extent is incomplete`, diagnostics);
  }
  if (matchExtent && (attachment.width !== width || attachment.height !== height)) {
    fail(`${label} extent does not match the host frame`, diagnostics);
  }
  if (!formats.includes(attachment.format)) {
    fail(`${label} format is unsupported: ${attachment.format ?? 'missing'}`, diagnostics);
  }
  if (encoding && attachment.encoding !== encoding) {
    fail(`${label} encoding is unsupported`, diagnostics);
  }
  if (colorSpace && attachment.colorSpace !== colorSpace) {
    fail(`${label} color space is unsupported`, diagnostics);
  }
  if (mapping && attachment.mapping !== mapping) {
    fail(`${label} mapping is unsupported`, diagnostics);
  }
}

function requireHostFrame(hostFrame, diagnostics) {
  diagnostics.phase = 'validate-host-attachments';
  if (!isNonEmptyString(hostFrame?.frameId)) {
    fail('host frame identity is missing', diagnostics);
  }
  if (
    !Number.isInteger(hostFrame.width)
    || hostFrame.width < 1
    || !Number.isInteger(hostFrame.height)
    || hostFrame.height < 1
  ) {
    fail('host frame extent is incomplete', diagnostics);
  }
  const camera = hostFrame.camera;
  if (!camera || typeof camera !== 'object') {
    fail('host camera is missing', diagnostics);
  }
  requireMatrix(camera.view, 'camera view matrix', diagnostics);
  requireMatrix(camera.viewProjection, 'camera view-projection matrix', diagnostics);
  requireMatrix(camera.inverseViewProjection, 'camera inverse view-projection matrix', diagnostics);
  requireNumericArray(camera.positionWorld, 3, 'camera world position', diagnostics);
  if (
    !isFiniteNumber(camera.nearMeters)
    || camera.nearMeters <= 0
    || !isFiniteNumber(camera.farMeters)
    || camera.farMeters <= camera.nearMeters
  ) {
    fail('camera near and far distances are invalid', diagnostics);
  }
  requireAttachment(hostFrame.sceneColor, {
    label: 'scene color',
    frameId: hostFrame.frameId,
    width: hostFrame.width,
    height: hostFrame.height,
    formats: ['rgba16float'],
    colorSpace: 'linear_hdr',
  }, diagnostics);
  requireAttachment(hostFrame.sceneDepth, {
    label: 'scene depth',
    frameId: hostFrame.frameId,
    width: hostFrame.width,
    height: hostFrame.height,
    formats: ['r32float'],
    encoding: 'linear_view_depth_meters',
  }, diagnostics);
  requireAttachment(hostFrame.environment, {
    label: 'environment',
    frameId: hostFrame.frameId,
    width: hostFrame.width,
    height: hostFrame.height,
    formats: ['rgba16float'],
    mapping: 'equirectangular_world_radiance',
    matchExtent: false,
  }, diagnostics);
  requireAttachment(hostFrame.target, {
    label: 'target',
    frameId: hostFrame.frameId,
    width: hostFrame.width,
    height: hostFrame.height,
    formats: ['bgra8unorm', 'rgba8unorm'],
  }, diagnostics);
  diagnostics.lastTrustworthyEvidence = 'host-attachments-exact';
}

function buildSurfaceVertexAttributes(snapshot, wetState = null) {
  const vertices = new Float32Array(snapshot.sampleCount * VERTEX_STRIDE_FLOATS);
  let wetSampleCount = 0;
  for (let index = 0; index < snapshot.sampleCount; index += 1) {
    const vectorOffset = index * 3;
    const vertexOffset = index * VERTEX_STRIDE_FLOATS;
    const mappedDepth = snapshot.mappedDepth[index];
    const physicalDepthMeters = mappedDepth / snapshot.jacobian[index];
    const worldDepth = physicalDepthMeters / snapshot.worldMetersPerUnit;
    const wet = wetState == null ? Number(mappedDepth > 0) : wetState[index];
    wetSampleCount += wet;
    for (let axis = 0; axis < 3; axis += 1) {
      vertices[vertexOffset + axis] = (
        snapshot.supportPosition[vectorOffset + axis]
        + snapshot.normal[vectorOffset + axis] * worldDepth
      );
    }
    vertices[vertexOffset + 6] = physicalDepthMeters;
    vertices[vertexOffset + 7] = mappedDepth;
    vertices[vertexOffset + 8] = snapshot.mappedMomentumU[index];
    vertices[vertexOffset + 9] = snapshot.mappedMomentumV[index];
    vertices[vertexOffset + 10] = snapshot.confidence;
    vertices[vertexOffset + 11] = wet > 0 ? 1 : -1;
  }
  for (let row = 0; row < snapshot.height; row += 1) {
    for (let column = 0; column < snapshot.width; column += 1) {
      const index = row * snapshot.width + column;
      const previousColumn = row * snapshot.width + Math.max(0, column - 1);
      const nextColumn = row * snapshot.width + Math.min(snapshot.width - 1, column + 1);
      const previousRow = Math.max(0, row - 1) * snapshot.width + column;
      const nextRow = Math.min(snapshot.height - 1, row + 1) * snapshot.width + column;
      const readPosition = sampleIndex => {
        const offset = sampleIndex * VERTEX_STRIDE_FLOATS;
        return [vertices[offset], vertices[offset + 1], vertices[offset + 2]];
      };
      const columnStart = readPosition(previousColumn);
      const columnEnd = readPosition(nextColumn);
      const rowStart = readPosition(previousRow);
      const rowEnd = readPosition(nextRow);
      const columnTangent = columnEnd.map((value, axis) => value - columnStart[axis]);
      const rowTangent = rowEnd.map((value, axis) => value - rowStart[axis]);
      let interfaceNormal = [
        rowTangent[1] * columnTangent[2] - rowTangent[2] * columnTangent[1],
        rowTangent[2] * columnTangent[0] - rowTangent[0] * columnTangent[2],
        rowTangent[0] * columnTangent[1] - rowTangent[1] * columnTangent[0],
      ];
      let normalLength = Math.hypot(...interfaceNormal);
      const sourceNormalOffset = index * 3;
      if (normalLength < 1e-9) {
        interfaceNormal = Array.from(
          snapshot.normal.subarray(sourceNormalOffset, sourceNormalOffset + 3),
        );
        normalLength = Math.hypot(...interfaceNormal);
      }
      interfaceNormal = interfaceNormal.map(value => value / Math.max(normalLength, 1e-9));
      const sourceAlignment = interfaceNormal.reduce(
        (sum, value, axis) => sum + value * snapshot.normal[sourceNormalOffset + axis],
        0,
      );
      if (sourceAlignment < 0) {
        interfaceNormal = interfaceNormal.map(value => -value);
      }
      const vertexOffset = index * VERTEX_STRIDE_FLOATS;
      vertices.set(interfaceNormal, vertexOffset + 3);
    }
  }
  return { vertices, wetSampleCount };
}

function buildRegularGridMesh(snapshot, diagnostics) {
  diagnostics.phase = 'build-surface-mesh';
  const { vertices, wetSampleCount } = buildSurfaceVertexAttributes(snapshot);
  const indices = new Uint32Array((snapshot.width - 1) * (snapshot.height - 1) * 6);
  let indexOffset = 0;
  for (let row = 0; row < snapshot.height - 1; row += 1) {
    for (let column = 0; column < snapshot.width - 1; column += 1) {
      const topLeft = row * snapshot.width + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + snapshot.width;
      const bottomRight = bottomLeft + 1;
      indices.set([
        topLeft, bottomLeft, topRight,
        topRight, bottomLeft, bottomRight,
      ], indexOffset);
      indexOffset += 6;
    }
  }
  let drawableWetTriangleCount = 0;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const triangle = [indices[offset], indices[offset + 1], indices[offset + 2]];
    if (!triangle.some(index => vertices[index * VERTEX_STRIDE_FLOATS + 11] > 0)) {
      continue;
    }
    const positions = triangle.map((index) => {
      const vertexOffset = index * VERTEX_STRIDE_FLOATS;
      return [
        vertices[vertexOffset],
        vertices[vertexOffset + 1],
        vertices[vertexOffset + 2],
      ];
    });
    const edgeA = positions[1].map((value, axis) => value - positions[0][axis]);
    const edgeB = positions[2].map((value, axis) => value - positions[0][axis]);
    const edgeALengthSquared = edgeA.reduce((sum, value) => sum + value * value, 0);
    const edgeBLengthSquared = edgeB.reduce((sum, value) => sum + value * value, 0);
    const cross = [
      edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1],
      edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2],
      edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0],
    ];
    const crossLengthSquared = cross.reduce((sum, value) => sum + value * value, 0);
    if (
      edgeALengthSquared > 0
      && edgeBLengthSquared > 0
      && crossLengthSquared > edgeALengthSquared * edgeBLengthSquared * 1e-12
    ) {
      drawableWetTriangleCount += 1;
    }
  }
  if (wetSampleCount === 0 || drawableWetTriangleCount === 0) {
    fail(
      wetSampleCount === 0
        ? 'portable macro optical surface is blank'
        : 'portable macro optical surface has no drawable nondegenerate wet triangles',
      diagnostics,
      {
        sampleCount: snapshot.sampleCount,
        wetSampleCount,
        drawableWetTriangleCount,
      },
    );
  }
  diagnostics.lastTrustworthyEvidence = 'surface-mesh-built';
  return { vertices, indices, wetSampleCount, drawableWetTriangleCount };
}

function requireWetBoundary(snapshot, diagnostics) {
  diagnostics.phase = 'validate-wet-boundary';
  const boundary = snapshot.wetBoundary;
  if (!boundary || typeof boundary !== 'object') {
    fail('wet boundary descriptor is missing', diagnostics);
  }
  if (boundary.schema !== MACRO_WET_BOUNDARY_SCHEMA) {
    fail(`wet boundary schema is unsupported: ${boundary.schema ?? 'missing'}`, diagnostics);
  }
  if (
    boundary.route?.requested !== MACRO_WET_BOUNDARY_ROUTE
    || boundary.route?.effective !== boundary.route.requested
    || boundary.sourceAuthority !== 'live_runtime'
    || boundary.fallbackStatus !== 'none'
  ) {
    fail('wet boundary route is unsupported, fallback, or substituted', diagnostics, {
      requested: boundary.route?.requested ?? null,
      effective: boundary.route?.effective ?? null,
      sourceAuthority: boundary.sourceAuthority ?? null,
      fallbackStatus: boundary.fallbackStatus ?? null,
    });
  }
  if (boundary.complete !== true) {
    fail('wet boundary descriptor is partial', diagnostics);
  }
  if (
    boundary.terrainEpoch !== snapshot.terrainEpoch
    || boundary.fluidEpoch !== snapshot.fluidEpoch
  ) {
    fail('wet boundary epoch is stale or substituted', diagnostics);
  }
  if (
    !isNonEmptyString(snapshot.topologyId)
    || boundary.topologyId !== snapshot.topologyId
  ) {
    fail('wet boundary topology identity is missing or substituted', diagnostics);
  }
  if (
    !isFiniteNumber(boundary.effectiveDryDepthMeters)
    || boundary.effectiveDryDepthMeters < 0
    || !isFiniteNumber(boundary.effectiveWetActivationDepthMeters)
    || boundary.effectiveWetActivationDepthMeters <= boundary.effectiveDryDepthMeters
  ) {
    fail('wet boundary thresholds are invalid', diagnostics);
  }
  requireNumericArray(
    boundary.physicalDepthMeters,
    snapshot.sampleCount,
    'wet boundary physical depth',
    diagnostics,
  );
  requireNumericArray(
    boundary.signedDryMarginMeters,
    snapshot.sampleCount,
    'wet boundary signed dry margin',
    diagnostics,
  );
  requireNumericArray(
    boundary.wetState,
    snapshot.sampleCount,
    'wet boundary wet state',
    diagnostics,
  );
  for (let index = 0; index < snapshot.sampleCount; index += 1) {
    const physicalDepth = snapshot.mappedDepth[index] / snapshot.jacobian[index];
    const tolerance = 1e-10 * Math.max(1, physicalDepth);
    if (
      Math.abs(boundary.physicalDepthMeters[index] - physicalDepth) > tolerance
      || Math.abs(
        boundary.signedDryMarginMeters[index]
        - (physicalDepth - boundary.effectiveDryDepthMeters)
      ) > tolerance
    ) {
      fail('wet boundary physical depth or signed margin disagrees with source geometry', diagnostics, {
        index,
      });
    }
    if (boundary.wetState[index] !== 0 && boundary.wetState[index] !== 1) {
      fail('wet boundary wet state is not binary', diagnostics, { index });
    }
    if (
      (physicalDepth <= boundary.effectiveDryDepthMeters && boundary.wetState[index] !== 0)
      || (
        physicalDepth >= boundary.effectiveWetActivationDepthMeters
        && boundary.wetState[index] !== 1
      )
    ) {
      fail('wet state disagrees with the producer-owned hysteretic margin', diagnostics, {
        index,
      });
    }
  }
  const cells = boundary.cells;
  const cellWidth = snapshot.width - 1;
  const cellHeight = snapshot.height - 1;
  const cellCount = cellWidth * cellHeight;
  if (
    !cells
    || cells.indexing !== 'row-major-quad-v1'
    || cells.width !== cellWidth
    || cells.height !== cellHeight
  ) {
    fail('wet boundary cell grid is missing or inconsistent', diagnostics);
  }
  for (const [value, label] of [
    [cells.stableId, 'wet boundary stable cell id'],
    [cells.activeState, 'wet boundary active cell state'],
    [cells.generation, 'wet boundary cell generation'],
  ]) {
    requireNumericArray(value, cellCount, label, diagnostics);
  }
  const reset = boundary.reset;
  if (
    !Number.isInteger(boundary.boundaryGeneration)
    || boundary.boundaryGeneration < 0
    || boundary.boundaryId
      !== `${boundary.topologyId}:boundary:${boundary.boundaryGeneration}`
    || !reset
    || !Number.isInteger(reset.generation)
    || reset.generation < 0
    || !Number.isInteger(reset.previousTerrainEpoch)
    || reset.terrainEpoch !== snapshot.terrainEpoch
    || reset.previousTerrainEpoch > reset.terrainEpoch
    || !['initial', 'ordinary_morph', 'phase_morph', 'shock_reset'].includes(reset.kind)
    || reset.boundaryGeneration > boundary.boundaryGeneration
    || reset.generation > boundary.boundaryGeneration
    || reset.discontinuous !== true
  ) {
    fail('wet boundary reset lineage is missing or stale', diagnostics);
  }
  const resetRemapIdentity = reset.remapReceiptId ?? 'initial';
  const expectedResetId = [
    `${boundary.topologyId}:reset:${reset.generation}`,
    `${reset.previousTerrainEpoch}->${reset.terrainEpoch}`,
    reset.kind,
    resetRemapIdentity,
  ].join(':');
  if (reset.id !== expectedResetId) {
    fail('wet boundary reset identity is stale or substituted', diagnostics);
  }
  for (let row = 0; row < cellHeight; row += 1) {
    for (let column = 0; column < cellWidth; column += 1) {
      const cellId = row * cellWidth + column;
      const topLeft = row * snapshot.width + column;
      const signature = boundary.wetState[topLeft]
        | (boundary.wetState[topLeft + 1] << 1)
        | (boundary.wetState[topLeft + snapshot.width + 1] << 2)
        | (boundary.wetState[topLeft + snapshot.width] << 3);
      const expectedActive = Number(signature !== 0 && signature !== 15);
      if (
        cells.stableId[cellId] !== cellId
        || cells.activeState[cellId] !== expectedActive
        || !Number.isInteger(cells.generation[cellId])
        || cells.generation[cellId] < reset.generation
      ) {
        fail('wet boundary stable cell identity, state, or generation disagrees', diagnostics, {
          cellId,
        });
      }
    }
  }
  if (
    boundary.derivation?.physicalDepth !== 'mappedDepth / supportGeometry.jacobian'
    || boundary.derivation?.signedMargin
      !== 'physicalDepthMeters - effectiveDryDepthMeters'
    || boundary.derivation?.hysteresis !== 'schmitt-trigger-v1'
  ) {
    fail('wet boundary derivation identity is unsupported', diagnostics);
  }
  diagnostics.lastTrustworthyEvidence = 'wet-boundary-source-exact';
  return boundary;
}

function interpolateClippedVertex(start, end) {
  const denominator = start.ownershipMargin - end.ownershipMargin;
  const t = Math.min(1, Math.max(
    0,
    Math.abs(denominator) > 1e-20 ? start.ownershipMargin / denominator : 0.5,
  ));
  const attributes = start.attributes.map(
    (value, index) => value + (end.attributes[index] - value) * t,
  );
  attributes[11] = 1;
  const samplePair = [start.sampleIndex, end.sampleIndex].sort((left, right) => left - right);
  return {
    key: `edge:${samplePair[0]}:${samplePair[1]}`,
    sampleIndex: samplePair[0],
    attributes,
    ownershipMargin: 0,
    referenceNormal: [3, 4, 5].map(
      offset => start.referenceNormal[offset - 3]
        + (end.referenceNormal[offset - 3] - start.referenceNormal[offset - 3]) * t,
    ),
  };
}

function clipTriangleToWet(triangle) {
  const output = [];
  for (let index = 0; index < triangle.length; index += 1) {
    const current = triangle[index];
    const previous = triangle[(index + triangle.length - 1) % triangle.length];
    const currentInside = current.ownershipMargin >= 0;
    const previousInside = previous.ownershipMargin >= 0;
    if (currentInside !== previousInside) {
      output.push(interpolateClippedVertex(previous, current));
    }
    if (currentInside) {
      output.push(current);
    }
  }
  return output;
}

function buildClippedShorelineMesh(snapshot, boundary, diagnostics) {
  diagnostics.phase = 'build-clipped-shoreline-mesh';
  const source = buildSurfaceVertexAttributes(snapshot, boundary.wetState);
  const sourceVertices = Array.from({ length: snapshot.sampleCount }, (_, sampleIndex) => {
    const offset = sampleIndex * VERTEX_STRIDE_FLOATS;
    const attributes = Array.from(
      source.vertices.subarray(offset, offset + VERTEX_STRIDE_FLOATS),
    );
    const wet = boundary.wetState[sampleIndex] === 1;
    return {
      key: `sample:${sampleIndex}`,
      sampleIndex,
      attributes,
      ownershipMargin: wet
        ? boundary.signedDryMarginMeters[sampleIndex]
        : boundary.physicalDepthMeters[sampleIndex]
          - boundary.effectiveWetActivationDepthMeters,
      referenceNormal: attributes.slice(3, 6),
    };
  });
  const outputRecords = [];
  const outputIndices = [];
  const outputIndexByKey = new Map();
  const crossingKeys = new Set();
  const normalSums = [];
  let clippedCellCount = 0;
  let drawableWetTriangleCount = 0;
  let ambiguousCellCount = 0;
  let stableCellTieBreakCount = 0;

  const outputIndex = (record) => {
    const existing = outputIndexByKey.get(record.key);
    if (existing != null) {
      return existing;
    }
    const index = outputRecords.length;
    outputIndexByKey.set(record.key, index);
    outputRecords.push(record);
    normalSums.push([0, 0, 0]);
    if (record.key.startsWith('edge:')) {
      crossingKeys.add(record.key);
    }
    return index;
  };

  const appendTriangle = (triangle) => {
    const indices = triangle.map(outputIndex);
    const positions = triangle.map(record => record.attributes.slice(0, 3));
    const edgeA = positions[1].map((value, axis) => value - positions[0][axis]);
    const edgeB = positions[2].map((value, axis) => value - positions[0][axis]);
    const faceNormal = [
      edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1],
      edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2],
      edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0],
    ];
    if (Math.hypot(...faceNormal) <= 1e-12) {
      return;
    }
    outputIndices.push(...indices);
    for (const index of indices) {
      for (let axis = 0; axis < 3; axis += 1) {
        normalSums[index][axis] += faceNormal[axis];
      }
    }
    drawableWetTriangleCount += 1;
  };

  for (let row = 0; row < snapshot.height - 1; row += 1) {
    for (let column = 0; column < snapshot.width - 1; column += 1) {
      const cellId = row * (snapshot.width - 1) + column;
      const topLeftIndex = row * snapshot.width + column;
      const topRightIndex = topLeftIndex + 1;
      const bottomLeftIndex = topLeftIndex + snapshot.width;
      const bottomRightIndex = bottomLeftIndex + 1;
      const topLeft = sourceVertices[topLeftIndex];
      const topRight = sourceVertices[topRightIndex];
      const bottomLeft = sourceVertices[bottomLeftIndex];
      const bottomRight = sourceVertices[bottomRightIndex];
      const signature = boundary.wetState[topLeftIndex]
        | (boundary.wetState[topRightIndex] << 1)
        | (boundary.wetState[bottomRightIndex] << 2)
        | (boundary.wetState[bottomLeftIndex] << 3);
      const ambiguous = signature === 5 || signature === 10;
      let useTopLeftBottomRight = false;
      if (ambiguous) {
        ambiguousCellCount += 1;
        const determinant = (
          topLeft.ownershipMargin * bottomRight.ownershipMargin
          - topRight.ownershipMargin * bottomLeft.ownershipMargin
        );
        const scale = Math.max(
          1,
          ...[topLeft, topRight, bottomLeft, bottomRight].map(
            vertex => Math.abs(vertex.ownershipMargin),
          ),
        );
        if (Math.abs(determinant) <= 1e-12 * scale * scale) {
          stableCellTieBreakCount += 1;
          useTopLeftBottomRight = boundary.cells.stableId[cellId] % 2 === 0;
        } else {
          useTopLeftBottomRight = determinant > 0;
        }
      }
      const triangles = useTopLeftBottomRight
        ? [
          [topLeft, bottomLeft, bottomRight],
          [topLeft, bottomRight, topRight],
        ]
        : [
          [topLeft, bottomLeft, topRight],
          [topRight, bottomLeft, bottomRight],
        ];
      let cellProducedTriangle = false;
      for (const triangle of triangles) {
        const polygon = clipTriangleToWet(triangle);
        for (let vertex = 1; vertex + 1 < polygon.length; vertex += 1) {
          appendTriangle([polygon[0], polygon[vertex], polygon[vertex + 1]]);
          cellProducedTriangle = true;
        }
      }
      clippedCellCount += Number(
        boundary.cells.activeState[cellId] === 1 && cellProducedTriangle,
      );
    }
  }
  if (outputIndices.length === 0 || drawableWetTriangleCount === 0) {
    fail('portable macro clipped shoreline surface is blank', diagnostics, {
      sampleCount: snapshot.sampleCount,
      wetSampleCount: source.wetSampleCount,
      drawableWetTriangleCount,
    });
  }
  const vertices = new Float32Array(outputRecords.length * VERTEX_STRIDE_FLOATS);
  for (let index = 0; index < outputRecords.length; index += 1) {
    const record = outputRecords[index];
    const normal = normalSums[index];
    let length = Math.hypot(...normal);
    if (length <= 1e-12) {
      normal.splice(0, 3, ...record.referenceNormal);
      length = Math.hypot(...normal);
    }
    const normalized = normal.map(value => value / Math.max(length, 1e-12));
    const alignment = normalized.reduce(
      (sum, value, axis) => sum + value * record.referenceNormal[axis],
      0,
    );
    if (alignment < 0) {
      for (let axis = 0; axis < 3; axis += 1) {
        normalized[axis] *= -1;
      }
    }
    record.attributes.splice(3, 3, ...normalized);
    vertices.set(record.attributes, index * VERTEX_STRIDE_FLOATS);
  }
  diagnostics.lastTrustworthyEvidence = 'clipped-shoreline-mesh-built';
  return {
    vertices,
    indices: Uint32Array.from(outputIndices),
    wetSampleCount: source.wetSampleCount,
    drawableWetTriangleCount,
    topology: Object.freeze({
      boundary: Object.freeze({
        schema: boundary.schema,
        id: boundary.boundaryId,
        generation: boundary.boundaryGeneration,
        resetId: boundary.reset.id,
        topologyId: boundary.topologyId,
        route: Object.freeze({ ...boundary.route }),
        sourceAuthority: boundary.sourceAuthority,
        fallbackStatus: boundary.fallbackStatus,
      }),
      edgeCrossingRoute: 'hysteretic-ownership-margin-linear-edge-v1',
      shorelineCrossingCount: crossingKeys.size,
      clippedCellCount,
      minimumOutputSignedMarginMeters: Math.max(
        0,
        Math.min(...outputRecords.map(record => record.ownershipMargin)),
      ),
      ambiguityResolution: Object.freeze({
        route: CLIPPED_AMBIGUITY_ROUTE,
        ambiguousCellCount,
        stableCellTieBreakCount,
      }),
    }),
  };
}

function monotoneSlope(previous, current, next, hasPrevious, hasNext) {
  if (!hasPrevious) return next - current;
  if (!hasNext) return current - previous;
  const incoming = current - previous;
  const outgoing = next - current;
  if (incoming === 0 || outgoing === 0 || Math.sign(incoming) !== Math.sign(outgoing)) {
    return 0;
  }
  return 2 * incoming * outgoing / (incoming + outgoing);
}

function buildSharedFieldSlopes(values, width, height, componentCount) {
  const slopeU = new Float64Array(values.length);
  const slopeV = new Float64Array(values.length);
  const read = (row, column, component) => (
    values[(row * width + column) * componentCount + component]
  );
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const offset = (row * width + column) * componentCount;
      for (let component = 0; component < componentCount; component += 1) {
        slopeU[offset + component] = monotoneSlope(
          read(row, Math.max(0, column - 1), component),
          read(row, column, component),
          read(row, Math.min(width - 1, column + 1), component),
          column > 0,
          column + 1 < width,
        );
        slopeV[offset + component] = monotoneSlope(
          read(Math.max(0, row - 1), column, component),
          read(row, column, component),
          read(Math.min(height - 1, row + 1), column, component),
          row > 0,
          row + 1 < height,
        );
      }
    }
  }
  return { slopeU, slopeV };
}

function hermiteBasis(t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    value: [
      2 * t3 - 3 * t2 + 1,
      -2 * t3 + 3 * t2,
    ],
    slope: [
      t3 - 2 * t2 + t,
      t3 - t2,
    ],
    valueDerivative: [
      6 * t2 - 6 * t,
      -6 * t2 + 6 * t,
    ],
    slopeDerivative: [
      3 * t2 - 4 * t + 1,
      3 * t2 - 2 * t,
    ],
  };
}

function evaluateSharedHermiteField({
  values,
  slopeU,
  slopeV,
  width,
  componentCount,
  row,
  column,
  u,
  v,
}) {
  const basisU = hermiteBasis(u);
  const basisV = hermiteBasis(v);
  const value = new Float64Array(componentCount);
  const derivativeU = new Float64Array(componentCount);
  const derivativeV = new Float64Array(componentCount);
  for (let cornerV = 0; cornerV < 2; cornerV += 1) {
    for (let cornerU = 0; cornerU < 2; cornerU += 1) {
      const sourceOffset = (
        (row + cornerV) * width + column + cornerU
      ) * componentCount;
      const valueWeight = (
        basisU.value[cornerU] * basisV.value[cornerV]
      );
      const slopeUWeight = (
        basisU.slope[cornerU] * basisV.value[cornerV]
      );
      const slopeVWeight = (
        basisU.value[cornerU] * basisV.slope[cornerV]
      );
      const valueDerivativeUWeight = (
        basisU.valueDerivative[cornerU] * basisV.value[cornerV]
      );
      const slopeUDerivativeWeight = (
        basisU.slopeDerivative[cornerU] * basisV.value[cornerV]
      );
      const slopeVDerivativeUWeight = (
        basisU.valueDerivative[cornerU] * basisV.slope[cornerV]
      );
      const valueDerivativeVWeight = (
        basisU.value[cornerU] * basisV.valueDerivative[cornerV]
      );
      const slopeUDerivativeVWeight = (
        basisU.slope[cornerU] * basisV.valueDerivative[cornerV]
      );
      const slopeVDerivativeWeight = (
        basisU.value[cornerU] * basisV.slopeDerivative[cornerV]
      );
      for (let component = 0; component < componentCount; component += 1) {
        const sourceIndex = sourceOffset + component;
        value[component] += (
          values[sourceIndex] * valueWeight
          + slopeU[sourceIndex] * slopeUWeight
          + slopeV[sourceIndex] * slopeVWeight
        );
        derivativeU[component] += (
          values[sourceIndex] * valueDerivativeUWeight
          + slopeU[sourceIndex] * slopeUDerivativeWeight
          + slopeV[sourceIndex] * slopeVDerivativeUWeight
        );
        derivativeV[component] += (
          values[sourceIndex] * valueDerivativeVWeight
          + slopeU[sourceIndex] * slopeUDerivativeVWeight
          + slopeV[sourceIndex] * slopeVDerivativeWeight
        );
      }
    }
  }
  return { value, derivativeU, derivativeV };
}

function buildContinuousPatchMesh(snapshot, boundary, diagnostics) {
  diagnostics.phase = 'build-continuous-patch-mesh';
  const source = buildSurfaceVertexAttributes(snapshot, boundary.wetState);
  const componentCount = 8;
  const field = new Float64Array(snapshot.sampleCount * componentCount);
  for (let sampleIndex = 0; sampleIndex < snapshot.sampleCount; sampleIndex += 1) {
    const sourceOffset = sampleIndex * VERTEX_STRIDE_FLOATS;
    const fieldOffset = sampleIndex * componentCount;
    field.set(source.vertices.subarray(sourceOffset, sourceOffset + 3), fieldOffset);
    field[fieldOffset + 3] = boundary.physicalDepthMeters[sampleIndex];
    field[fieldOffset + 4] = snapshot.mappedDepth[sampleIndex];
    field[fieldOffset + 5] = snapshot.mappedMomentumU[sampleIndex];
    field[fieldOffset + 6] = snapshot.mappedMomentumV[sampleIndex];
    field[fieldOffset + 7] = boundary.signedDryMarginMeters[sampleIndex];
  }
  const slopes = buildSharedFieldSlopes(
    field,
    snapshot.width,
    snapshot.height,
    componentCount,
  );
  const microWidth = (snapshot.width - 1) * CONTINUOUS_PATCH_SUBDIVISIONS + 1;
  const microHeight = (snapshot.height - 1) * CONTINUOUS_PATCH_SUBDIVISIONS + 1;
  const vertices = new Float32Array(microWidth * microHeight * VERTEX_STRIDE_FLOATS);
  let minimumOutputSignedMarginMeters = Number.POSITIVE_INFINITY;
  for (let microRow = 0; microRow < microHeight; microRow += 1) {
    const row = Math.min(
      snapshot.height - 2,
      Math.floor(microRow / CONTINUOUS_PATCH_SUBDIVISIONS),
    );
    const v = (
      microRow === microHeight - 1
        ? 1
        : (microRow % CONTINUOUS_PATCH_SUBDIVISIONS) / CONTINUOUS_PATCH_SUBDIVISIONS
    );
    for (let microColumn = 0; microColumn < microWidth; microColumn += 1) {
      const column = Math.min(
        snapshot.width - 2,
        Math.floor(microColumn / CONTINUOUS_PATCH_SUBDIVISIONS),
      );
      const u = (
        microColumn === microWidth - 1
          ? 1
          : (microColumn % CONTINUOUS_PATCH_SUBDIVISIONS)
            / CONTINUOUS_PATCH_SUBDIVISIONS
      );
      const evaluated = evaluateSharedHermiteField({
        values: field,
        ...slopes,
        width: snapshot.width,
        componentCount,
        row,
        column,
        u,
        v,
      });
      const derivativeU = evaluated.derivativeU;
      const derivativeV = evaluated.derivativeV;
      let normal = [
        derivativeV[1] * derivativeU[2] - derivativeV[2] * derivativeU[1],
        derivativeV[2] * derivativeU[0] - derivativeV[0] * derivativeU[2],
        derivativeV[0] * derivativeU[1] - derivativeV[1] * derivativeU[0],
      ];
      const cornerWeights = [
        (1 - u) * (1 - v),
        u * (1 - v),
        (1 - u) * v,
        u * v,
      ];
      const cornerIndices = [
        row * snapshot.width + column,
        row * snapshot.width + column + 1,
        (row + 1) * snapshot.width + column,
        (row + 1) * snapshot.width + column + 1,
      ];
      const referenceNormal = [0, 0, 0];
      for (let corner = 0; corner < 4; corner += 1) {
        const normalOffset = cornerIndices[corner] * 3;
        for (let axis = 0; axis < 3; axis += 1) {
          referenceNormal[axis] += (
            snapshot.normal[normalOffset + axis] * cornerWeights[corner]
          );
        }
      }
      let normalLength = Math.hypot(...normal);
      if (normalLength <= 1e-12) {
        normal = referenceNormal;
        normalLength = Math.hypot(...normal);
      }
      normal = normal.map(value => value / Math.max(normalLength, 1e-12));
      if (
        normal.reduce(
          (sum, value, axis) => sum + value * referenceNormal[axis],
          0,
        ) < 0
      ) {
        normal = normal.map(value => -value);
      }
      const vertexOffset = (
        microRow * microWidth + microColumn
      ) * VERTEX_STRIDE_FLOATS;
      vertices.set(evaluated.value.subarray(0, 3), vertexOffset);
      vertices.set(normal, vertexOffset + 3);
      vertices[vertexOffset + 6] = Math.max(0, evaluated.value[3]);
      vertices[vertexOffset + 7] = Math.max(0, evaluated.value[4]);
      vertices[vertexOffset + 8] = evaluated.value[5];
      vertices[vertexOffset + 9] = evaluated.value[6];
      vertices[vertexOffset + 10] = snapshot.confidence;
      vertices[vertexOffset + 11] = evaluated.value[7];
      minimumOutputSignedMarginMeters = Math.min(
        minimumOutputSignedMarginMeters,
        evaluated.value[7],
      );
    }
  }

  const indices = new Uint32Array((microWidth - 1) * (microHeight - 1) * 6);
  let indexOffset = 0;
  let drawableWetTriangleCount = 0;
  for (let row = 0; row < microHeight - 1; row += 1) {
    for (let column = 0; column < microWidth - 1; column += 1) {
      const topLeft = row * microWidth + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + microWidth;
      const bottomRight = bottomLeft + 1;
      indices.set([
        topLeft, bottomLeft, topRight,
        topRight, bottomLeft, bottomRight,
      ], indexOffset);
      indexOffset += 6;
      for (const triangle of [
        [topLeft, bottomLeft, topRight],
        [topRight, bottomLeft, bottomRight],
      ]) {
        const margins = triangle.map(
          index => vertices[index * VERTEX_STRIDE_FLOATS + 11],
        );
        if (Math.max(...margins) > 0) {
          drawableWetTriangleCount += 1;
        }
      }
    }
  }
  if (source.wetSampleCount === 0 || drawableWetTriangleCount === 0) {
    fail('portable macro continuous patch surface is blank', diagnostics, {
      sampleCount: snapshot.sampleCount,
      wetSampleCount: source.wetSampleCount,
      drawableWetTriangleCount,
    });
  }
  diagnostics.lastTrustworthyEvidence = 'continuous-patch-mesh-built';
  return {
    vertices,
    indices,
    wetSampleCount: source.wetSampleCount,
    drawableWetTriangleCount,
    topology: Object.freeze({
      boundary: Object.freeze({
        schema: boundary.schema,
        id: boundary.boundaryId,
        generation: boundary.boundaryGeneration,
        resetId: boundary.reset.id,
        topologyId: boundary.topologyId,
        route: Object.freeze({ ...boundary.route }),
        sourceAuthority: boundary.sourceAuthority,
        fallbackStatus: boundary.fallbackStatus,
      }),
      reconstruction: Object.freeze({
        position: 'shared-c1-hermite-patch-v0',
        normal: 'analytic-position-derivative-v0',
        coverage: 'fragment-signed-wet-margin-aa-v0',
        subdivisionsPerCell: CONTINUOUS_PATCH_SUBDIVISIONS,
        stableCarrier: true,
      }),
      minimumOutputSignedMarginMeters,
    }),
  };
}

export function createFingerFluidPortableMacroOpticalRenderPlan({
  snapshot,
  expectedIdentity,
  hostFrame,
  requestedRoute = KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_ROUTE,
  requestedTopologyRoute =
    KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_REGULAR_GRID_DEBUG_ROUTE,
} = {}) {
  const diagnostics = {
    phase: 'validate-route',
    requestedRoute,
    requestedTopologyRoute,
    lastTrustworthyEvidence: 'renderer-request-received',
  };
  try {
    if (requestedRoute !== KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_ROUTE) {
      fail(`portable macro optical renderer route is unsupported: ${requestedRoute}`, diagnostics);
    }
    if (![
      KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_REGULAR_GRID_DEBUG_ROUTE,
      KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_WET_BOUNDARY_CLIPPED_ROUTE,
      KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_CONTINUOUS_PATCH_ROUTE,
    ].includes(requestedTopologyRoute)) {
      fail(
        `portable macro optical topology route is unsupported: ${requestedTopologyRoute}`,
        diagnostics,
      );
    }
    diagnostics.lastTrustworthyEvidence = 'renderer-route-exact';
    requireIdentity(snapshot ?? {}, expectedIdentity ?? {}, diagnostics);
    requireSourceGeometry(snapshot, diagnostics);
    requireHostFrame(hostFrame, diagnostics);
    const boundary = requestedTopologyRoute
      !== KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_REGULAR_GRID_DEBUG_ROUTE
      ? requireWetBoundary(snapshot, diagnostics)
      : null;
    const mesh = requestedTopologyRoute
      === KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_REGULAR_GRID_DEBUG_ROUTE
      ? buildRegularGridMesh(snapshot, diagnostics)
      : requestedTopologyRoute
        === KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_WET_BOUNDARY_CLIPPED_ROUTE
        ? buildClippedShorelineMesh(snapshot, boundary, diagnostics)
        : buildContinuousPatchMesh(snapshot, boundary, diagnostics);
    const topology = Object.freeze({
      route: Object.freeze({
        requested: requestedTopologyRoute,
        effective: requestedTopologyRoute,
        fallback: null,
      }),
      boundary: mesh.topology?.boundary ?? null,
      edgeCrossingRoute: mesh.topology?.edgeCrossingRoute ?? null,
      shorelineCrossingCount: mesh.topology?.shorelineCrossingCount ?? 0,
      clippedCellCount: mesh.topology?.clippedCellCount ?? 0,
      minimumOutputSignedMarginMeters:
        mesh.topology?.minimumOutputSignedMarginMeters ?? null,
      ambiguityResolution: mesh.topology?.ambiguityResolution ?? null,
      reconstruction: mesh.topology?.reconstruction ?? null,
    });
    return Object.freeze({
      schema: KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_SCHEMA,
      route: Object.freeze({
        requested: requestedRoute,
        effective: KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_ROUTE,
        fallback: null,
      }),
      shaderRoute: KAMINOS_PORTABLE_MACRO_OPTICAL_SHADER_ROUTE,
      source: Object.freeze({
        geometryIdentity: snapshot.geometryIdentity,
        terrainId: snapshot.terrainId,
        sourceHandleId: snapshot.sourceHandleId,
        terrain: Object.freeze({
          requested: snapshot.source.requested,
          effective: snapshot.source.effective,
          producerId: snapshot.source.producerId,
          producerRevision: snapshot.source.producerRevision,
        }),
        producerRevision: snapshot.producerRevision,
        terrainEpoch: snapshot.terrainEpoch,
        fluidEpoch: snapshot.fluidEpoch,
      }),
      host: Object.freeze({
        frameId: hostFrame.frameId,
        width: hostFrame.width,
        height: hostFrame.height,
        sceneColor: Object.freeze({ ...hostFrame.sceneColor }),
        sceneDepth: Object.freeze({ ...hostFrame.sceneDepth }),
        environment: Object.freeze({ ...hostFrame.environment }),
        target: Object.freeze({ ...hostFrame.target }),
      }),
      camera: Object.freeze({
        view: Float32Array.from(hostFrame.camera.view),
        viewProjection: Float32Array.from(hostFrame.camera.viewProjection),
        inverseViewProjection: Float32Array.from(hostFrame.camera.inverseViewProjection),
        positionWorld: Float32Array.from(hostFrame.camera.positionWorld),
        nearMeters: hostFrame.camera.nearMeters,
        farMeters: hostFrame.camera.farMeters,
      }),
      absorptionPerMeter: Object.freeze([...snapshot.physicalMaterial.absorptionPerMeter]),
      topology,
      vertexStrideFloats: VERTEX_STRIDE_FLOATS,
      vertexCount: mesh.vertices.length / VERTEX_STRIDE_FLOATS,
      indexCount: mesh.indices.length,
      vertices: mesh.vertices,
      indices: mesh.indices,
      wetSampleCount: mesh.wetSampleCount,
      drawableWetTriangleCount: mesh.drawableWetTriangleCount,
      blank: false,
      partial: false,
    });
  } catch (error) {
    if (error?.report?.schema === KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_FAILURE_SCHEMA) {
      throw error;
    }
    throw reportedFailure(error?.message || String(error), diagnostics);
  }
}

function attachmentIdentity(attachment) {
  return Object.freeze(Object.fromEntries(
    Object.entries(attachment).filter(([key]) => key !== 'view'),
  ));
}

function requireEffectiveAttachment(actual, expected, label, diagnostics) {
  if (!actual || typeof actual !== 'object') {
    fail(`${label} effective attachment is missing`, diagnostics);
  }
  requireGpuResource(actual.view, `${label} view`);
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (actual[field] !== expectedValue) {
      fail(`${label} effective attachment is stale or substituted`, diagnostics, {
        field,
        expected: expectedValue,
        actual: actual[field] ?? null,
      });
    }
  }
}

export function validateFingerFluidPortableMacroOpticalRenderAttachments({
  plan,
  target,
  sceneColor,
  sceneDepth,
  environment,
  pipelineFormat,
} = {}) {
  const diagnostics = {
    phase: 'validate-render-attachments',
    requestedRoute: plan?.route?.requested ?? null,
    requestedTopologyRoute: plan?.topology?.route?.requested ?? null,
    lastTrustworthyEvidence: 'render-plan-received',
  };
  if (
    plan?.schema !== KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_SCHEMA
    || plan?.route?.effective !== KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_ROUTE
    || plan?.route?.fallback !== null
    || plan.blank
    || plan.partial
  ) {
    fail('portable macro optical render plan is missing, fallback, blank, or partial', diagnostics);
  }
  if (pipelineFormat != null) {
    diagnostics.phase = 'validate-pipeline-target-format';
    if (!isNonEmptyString(pipelineFormat) || plan.host.target.format !== pipelineFormat) {
      fail('target format does not match the renderer pipeline format', diagnostics, {
        targetFormat: plan.host.target.format ?? null,
        pipelineFormat: pipelineFormat ?? null,
      });
    }
    diagnostics.lastTrustworthyEvidence = 'pipeline-target-format-exact';
  }
  diagnostics.phase = 'validate-render-attachments';
  requireEffectiveAttachment(target, plan.host.target, 'target', diagnostics);
  requireEffectiveAttachment(sceneColor, plan.host.sceneColor, 'scene color', diagnostics);
  requireEffectiveAttachment(sceneDepth, plan.host.sceneDepth, 'scene depth', diagnostics);
  requireEffectiveAttachment(environment, plan.host.environment, 'environment', diagnostics);
  diagnostics.lastTrustworthyEvidence = 'effective-render-attachments-exact';
  return Object.freeze({
    target: Object.freeze({ view: target.view, identity: attachmentIdentity(target) }),
    sceneColor: Object.freeze({ view: sceneColor.view, identity: attachmentIdentity(sceneColor) }),
    sceneDepth: Object.freeze({ view: sceneDepth.view, identity: attachmentIdentity(sceneDepth) }),
    environment: Object.freeze({ view: environment.view, identity: attachmentIdentity(environment) }),
  });
}

const shaderSource = /* wgsl */ `
struct FrameUniforms {
  viewProjection: mat4x4<f32>,
  view: mat4x4<f32>,
  cameraWorld: vec4<f32>,
  absorptionIor: vec4<f32>,
  viewportNearFar: vec4<f32>,
};

struct VertexInput {
  @location(0) positionWorld: vec3<f32>,
  @location(1) normalWorld: vec3<f32>,
  @location(2) optics: vec4<f32>,
  @location(3) support: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) positionWorld: vec3<f32>,
  @location(1) normalWorld: vec3<f32>,
  @location(2) physicalDepthMeters: f32,
  @location(3) signedWetSupport: f32,
  @location(4) viewDepthMeters: f32,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var sceneColor: texture_2d<f32>;
@group(0) @binding(2) var sceneDepth: texture_2d<f32>;
@group(0) @binding(3) var environmentRadiance: texture_2d<f32>;
@group(0) @binding(4) var linearSampler: sampler;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  let viewPosition = frame.view * vec4<f32>(input.positionWorld, 1.0);
  output.position = frame.viewProjection * vec4<f32>(input.positionWorld, 1.0);
  output.positionWorld = input.positionWorld;
  output.normalWorld = input.normalWorld;
  output.physicalDepthMeters = input.optics.x;
  output.signedWetSupport = input.support.y;
  output.viewDepthMeters = max(0.0, -viewPosition.z);
  return output;
}

fn environmentUv(direction: vec3<f32>) -> vec2<f32> {
  let normalized = normalize(direction);
  let u = atan2(normalized.z, normalized.x) * 0.15915494309189535 + 0.5;
  let v = acos(clamp(normalized.y, -1.0, 1.0)) * 0.3183098861837907;
  return vec2<f32>(fract(u), clamp(v, 0.0, 1.0));
}

fn schlickFresnel(cosineTheta: f32, f0: f32) -> f32 {
  return f0 + (1.0 - f0) * pow(1.0 - clamp(cosineTheta, 0.0, 1.0), 5.0);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let coverageWidth = max(abs(fwidth(input.signedWetSupport)), 1e-5);
  let wetCoverage = smoothstep(
    -coverageWidth,
    coverageWidth,
    input.signedWetSupport
  );
  if (wetCoverage <= 0.001 || input.physicalDepthMeters <= 0.0001) {
    discard;
  }
  let pixel = vec2<i32>(input.position.xy);
  let extent = vec2<i32>(textureDimensions(sceneDepth));
  if (any(pixel < vec2<i32>(0)) || any(pixel >= extent)) {
    discard;
  }
  let hostDepth = textureLoad(sceneDepth, pixel, 0).x;
  if (hostDepth > 0.0 && input.viewDepthMeters >= hostDepth - 0.002) {
    discard;
  }

  let viewport = frame.viewportNearFar.xy;
  let uv = (input.position.xy + vec2<f32>(0.5)) / viewport;
  let normal = normalize(input.normalWorld);
  let viewDirection = normalize(frame.cameraWorld.xyz - input.positionWorld);
  let cosineTheta = abs(dot(normal, viewDirection));
  let f0 = frame.absorptionIor.w;
  let fresnel = schlickFresnel(cosineTheta, f0);

  let projectedSurface = frame.viewProjection * vec4<f32>(input.positionWorld, 1.0);
  let projectedNormal = frame.viewProjection * vec4<f32>(
    input.positionWorld + normal * 0.25,
    1.0
  );
  let surfaceNdc = projectedSurface.xy / max(abs(projectedSurface.w), 1e-5);
  let normalNdc = projectedNormal.xy / max(abs(projectedNormal.w), 1e-5);
  let screenNormal = normalNdc - surfaceNdc;
  let refractionScale = min(
    0.08,
    input.physicalDepthMeters / max(input.viewDepthMeters, 0.25) * 0.18
  );
  let refractedUv = clamp(uv - screenNormal * refractionScale, vec2<f32>(0.001), vec2<f32>(0.999));
  let transmittedScene = textureSampleLevel(sceneColor, linearSampler, refractedUv, 0.0).rgb;

  let pathMeters = input.physicalDepthMeters / max(cosineTheta, 0.2);
  let transmittance = exp(-frame.absorptionIor.xyz * pathMeters);
  let waterScatter = vec3<f32>(0.006, 0.035, 0.052) * (1.0 - transmittance);
  let transmitted = transmittedScene * transmittance + waterScatter;

  let reflectedDirection = reflect(-viewDirection, normal);
  let reflected = textureSampleLevel(
    environmentRadiance,
    linearSampler,
    environmentUv(reflectedDirection),
    0.0
  ).rgb;
  let waterRadiance = transmitted * (1.0 - fresnel) + reflected * fresnel;
  let radiance = mix(transmittedScene, waterRadiance, wetCoverage);
  let display = radiance / (vec3<f32>(1.0) + radiance);
  return vec4<f32>(pow(max(display, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2)), 1.0);
}
`;

function requireGpuResource(value, label) {
  if (!value || typeof value !== 'object') {
    throw new TypeError(`${label} GPU resource is missing`);
  }
}

export function createWebGPUFingerFluidPortableMacroOpticalRenderer({
  device,
  colorFormat = 'bgra8unorm',
  label = 'kaminos-portable-macro-optical-renderer',
} = {}) {
  if (!device?.createShaderModule || !device?.createRenderPipeline) {
    throw new TypeError('a live WebGPU device is required');
  }
  if (!['bgra8unorm', 'rgba8unorm'].includes(colorFormat)) {
    throw new Error(`portable macro optical target format is unsupported: ${colorFormat}`);
  }

  const shader = device.createShaderModule({
    label: `${label}-shader`,
    code: shaderSource,
  });
  const bindGroupLayout = device.createBindGroupLayout({
    label: `${label}-bind-group-layout`,
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });
  const pipeline = device.createRenderPipeline({
    label: `${label}-pipeline`,
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: {
      module: shader,
      entryPoint: 'vertexMain',
      buffers: [{
        arrayStride: VERTEX_STRIDE_BYTES,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
          { shaderLocation: 2, offset: 24, format: 'float32x4' },
          { shaderLocation: 3, offset: 40, format: 'float32x2' },
        ],
      }],
    },
    fragment: {
      module: shader,
      entryPoint: 'fragmentMain',
      targets: [{ format: colorFormat }],
    },
    primitive: {
      topology: 'triangle-list',
      frontFace: 'ccw',
      cullMode: 'none',
    },
  });
  const uniformBuffer = device.createBuffer({
    label: `${label}-uniforms`,
    size: UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const sampler = device.createSampler({
    label: `${label}-linear-sampler`,
    magFilter: 'linear',
    minFilter: 'linear',
  });
  let vertexBuffer = null;
  let indexBuffer = null;
  let vertexCapacity = 0;
  let indexCapacity = 0;
  let frameCount = 0;
  let destroyed = false;
  let lastEvidence = null;

  function ensureGeometryCapacity(plan) {
    if (plan.vertices.byteLength > vertexCapacity) {
      vertexBuffer?.destroy();
      vertexCapacity = Math.max(plan.vertices.byteLength, 256);
      vertexBuffer = device.createBuffer({
        label: `${label}-vertices`,
        size: vertexCapacity,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
    if (plan.indices.byteLength > indexCapacity) {
      indexBuffer?.destroy();
      indexCapacity = Math.max(plan.indices.byteLength, 256);
      indexBuffer = device.createBuffer({
        label: `${label}-indices`,
        size: indexCapacity,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      });
    }
  }

  function writeUniforms(plan) {
    const uniforms = new Float32Array(UNIFORM_FLOATS);
    uniforms.set(plan.camera.viewProjection, 0);
    uniforms.set(plan.camera.view, 16);
    uniforms.set([...plan.camera.positionWorld, 1], 32);
    uniforms.set([...plan.absorptionPerMeter, 0.02037], 36);
    uniforms.set([
      plan.host.width,
      plan.host.height,
      plan.camera.nearMeters,
      plan.camera.farMeters,
    ], 40);
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);
  }

  function render({
    plan,
    commandEncoder,
    target,
    sceneColor,
    sceneDepth,
    environment,
  } = {}) {
    if (destroyed) {
      throw new Error('portable macro optical renderer is destroyed');
    }
    const attachments = validateFingerFluidPortableMacroOpticalRenderAttachments({
      plan,
      target,
      sceneColor,
      sceneDepth,
      environment,
      pipelineFormat: colorFormat,
    });
    requireGpuResource(commandEncoder, 'command encoder');
    ensureGeometryCapacity(plan);
    device.queue.writeBuffer(vertexBuffer, 0, plan.vertices);
    device.queue.writeBuffer(indexBuffer, 0, plan.indices);
    writeUniforms(plan);
    const bindGroup = device.createBindGroup({
      label: `${label}-frame-${frameCount}-bind-group`,
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: attachments.sceneColor.view },
        { binding: 2, resource: attachments.sceneDepth.view },
        { binding: 3, resource: attachments.environment.view },
        { binding: 4, resource: sampler },
      ],
    });
    const pass = commandEncoder.beginRenderPass({
      label: `${label}-frame-${frameCount}`,
      colorAttachments: [{
        view: attachments.target.view,
        loadOp: 'load',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.setIndexBuffer(indexBuffer, 'uint32');
    pass.drawIndexed(plan.indexCount);
    pass.end();
    frameCount += 1;
    lastEvidence = Object.freeze({
      schema: 'kaminos.finger-fluid.portable-macro-optical-render-evidence.v0',
      requestedRoute: plan.route.requested,
      effectiveRoute: plan.route.effective,
      fallback: null,
      requestedTopologyRoute: plan.topology.route.requested,
      effectiveTopologyRoute: plan.topology.route.effective,
      topologyFallback: plan.topology.route.fallback,
      topology: Object.freeze({
        boundaryId: plan.topology.boundary?.id ?? null,
        resetId: plan.topology.boundary?.resetId ?? null,
        edgeCrossingRoute: plan.topology.edgeCrossingRoute,
        shorelineCrossingCount: plan.topology.shorelineCrossingCount,
        clippedCellCount: plan.topology.clippedCellCount,
        ambiguityRoute: plan.topology.ambiguityResolution?.route ?? null,
        reconstruction: plan.topology.reconstruction,
      }),
      shaderRoute: KAMINOS_PORTABLE_MACRO_OPTICAL_SHADER_ROUTE,
      source: plan.source,
      hostFrameId: plan.host.frameId,
      attachments: Object.freeze({
        target: attachments.target.identity,
        sceneColor: attachments.sceneColor.identity,
        sceneDepth: attachments.sceneDepth.identity,
        environment: attachments.environment.identity,
      }),
      vertexCount: plan.vertexCount,
      indexCount: plan.indexCount,
      wetSampleCount: plan.wetSampleCount,
      drawableWetTriangleCount: plan.drawableWetTriangleCount,
      frameCount,
      primaryCommandEncoded: true,
      primaryOutputWritten: false,
      partial: false,
      blank: false,
    });
    return lastEvidence;
  }

  function getDebugState() {
    return {
      schema: KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_SCHEMA,
      requestedRoute: KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_ROUTE,
      effectiveRoute: KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_ROUTE,
      fallback: null,
      shaderRoute: KAMINOS_PORTABLE_MACRO_OPTICAL_SHADER_ROUTE,
      frameCount,
      lastEvidence,
      destroyed,
    };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    vertexBuffer?.destroy();
    indexBuffer?.destroy();
    uniformBuffer.destroy();
  }

  return Object.freeze({
    schema: KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_SCHEMA,
    route: Object.freeze({
      requested: KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_ROUTE,
      effective: KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_ROUTE,
      fallback: null,
    }),
    shaderRoute: KAMINOS_PORTABLE_MACRO_OPTICAL_SHADER_ROUTE,
    render,
    getDebugState,
    destroy,
  });
}
