export const KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_SCHEMA =
  'kaminos.finger-fluid.portable-macro-optical-renderer.v0';
export const KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_ROUTE =
  'kaminos/finger-fluid/portable-macro-screen-space-optics-v0';
export const KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_FAILURE_SCHEMA =
  'kaminos.finger-fluid.portable-macro-optical-renderer-failure.v0';
export const KAMINOS_PORTABLE_MACRO_OPTICAL_SHADER_ROUTE =
  'wgsl-portable-macro-fresnel-refraction-absorption-v0';

const PORTABLE_UPLOAD_SCHEMA =
  'kaminos.finger-fluid.portable-macro-upload-snapshot.v1';
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

function buildMesh(snapshot, diagnostics) {
  diagnostics.phase = 'build-surface-mesh';
  const vertices = new Float32Array(snapshot.sampleCount * VERTEX_STRIDE_FLOATS);
  let wetSampleCount = 0;
  for (let index = 0; index < snapshot.sampleCount; index += 1) {
    const vectorOffset = index * 3;
    const vertexOffset = index * VERTEX_STRIDE_FLOATS;
    const mappedDepth = snapshot.mappedDepth[index];
    const physicalDepthMeters = mappedDepth / snapshot.jacobian[index];
    const worldDepth = physicalDepthMeters / snapshot.worldMetersPerUnit;
    const wet = mappedDepth > 0 ? 1 : 0;
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
    vertices[vertexOffset + 11] = wet;
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

export function createFingerFluidPortableMacroOpticalRenderPlan({
  snapshot,
  expectedIdentity,
  hostFrame,
  requestedRoute = KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_ROUTE,
} = {}) {
  const diagnostics = {
    phase: 'validate-route',
    requestedRoute,
    lastTrustworthyEvidence: 'renderer-request-received',
  };
  try {
    if (requestedRoute !== KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_ROUTE) {
      fail(`portable macro optical renderer route is unsupported: ${requestedRoute}`, diagnostics);
    }
    diagnostics.lastTrustworthyEvidence = 'renderer-route-exact';
    requireIdentity(snapshot ?? {}, expectedIdentity ?? {}, diagnostics);
    requireSourceGeometry(snapshot, diagnostics);
    requireHostFrame(hostFrame, diagnostics);
    const mesh = buildMesh(snapshot, diagnostics);
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
      vertexStrideFloats: VERTEX_STRIDE_FLOATS,
      vertexCount: snapshot.sampleCount,
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
  @location(3) wetSupport: f32,
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
  output.wetSupport = input.support.y;
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
  if (input.wetSupport <= 0.005 || input.physicalDepthMeters <= 0.0001) {
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
  let radiance = transmitted * (1.0 - fresnel) + reflected * fresnel;
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
