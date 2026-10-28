import { validatePixal3dGenerationInputs } from './generation-inputs.js';
import {
  pixal3dGenerationPipelineType,
  pixal3dGenerationRoles,
} from './pixal3d-generation.js';
import { PIXAL3D_GLB_NODE_MATRIX } from './pixal3d-mesh.js';
import { buildSparseSamplerPlan } from '../trellis2/sparse-sampler.js';
import { buildSLatSamplerPlan } from '../trellis2/slat-sampler.js';
import { validateNativePrefixBackend } from '../trellis2/sparse-prefix-witness-checks.js';

export const PIXAL3D_GENERATION_ROUTE = 'pixal3d.image-generation.webgpu.v0';

export const PIXAL3D_GENERATION_PHASES = Object.freeze([
  'naf-feature-upsampling',
  'sparse-structure-sampling',
  'occupancy-decoding',
  'low-resolution-shape-sampling',
  'learned-cascade-support',
  'naf-hr-feature-upsampling',
  'high-resolution-shape-sampling',
  'learned-geometry-decoding',
  'shape-conditioned-texture-sampling',
  'shape-guided-material-decoding',
]);

export const PIXAL3D_GENERATION_FIELDS = Object.freeze([
  'conditioning',
  'highResolutionConditioning',
  'geometry.features',
  'geometry.coordinates',
  'material.features',
  'material.coordinates',
  'shapeCodes',
  'textureCodes',
  'noise.sparse',
  'noise.lowResolutionShape',
  'noise.highResolutionShape',
  'noise.texture',
  'geometry.subdivision0',
  'geometry.subdivision1',
  'geometry.subdivision2',
  'geometry.subdivision3',
]);

export function pixal3dGenerationPhases(manifest = {}) {
  const type = pixal3dGenerationPipelineType(manifest);
  if (type === '512') {
    return PIXAL3D_GENERATION_PHASES.filter(
      phase =>
        ![
          'learned-cascade-support',
          'naf-hr-feature-upsampling',
          'high-resolution-shape-sampling',
        ].includes(phase),
    );
  }
  const conditioningMode = manifest.conditioningMode ?? 'stage-specific-1024';
  return conditioningMode === 'stage-specific-1024'
    ? PIXAL3D_GENERATION_PHASES
    : PIXAL3D_GENERATION_PHASES.filter(phase => phase !== 'naf-hr-feature-upsampling');
}

export function pixal3dGenerationFields(manifest = {}) {
  const type = pixal3dGenerationPipelineType(manifest);
  const cascade = type === '1024_cascade';
  const conditioningMode =
    manifest.conditioningMode ?? (cascade ? 'stage-specific-1024' : 'source-512');
  const stageSpecific = cascade && conditioningMode === 'stage-specific-1024';
  const shapeLevels = manifest.models?.shapeDecoder?.config?.channels?.length ?? 5;
  const maxSubdiv = Math.max(0, shapeLevels - 1);
  return PIXAL3D_GENERATION_FIELDS.filter(field => {
    if (field === 'highResolutionConditioning' && !stageSpecific) return false;
    if (field === 'noise.highResolutionShape' && !cascade) return false;
    if (field.startsWith('geometry.subdivision')) {
      const idx = Number(field.slice('geometry.subdivision'.length));
      if (idx >= maxSubdiv) return false;
    }
    return true;
  });
}

export function admitPixal3dGenerationGpuBudget(manifest, maxLiveBytes) {
  validatePixal3dGenerationInputs(manifest);
  if (
    maxLiveBytes !== undefined &&
    (!Number.isSafeInteger(maxLiveBytes) || maxLiveBytes < 1)
  ) {
    throw new TypeError('positive caller-selected GPU memory budget required');
  }
  const roles = pixal3dGenerationRoles(manifest);
  const checkpointBytes = {};
  for (const role of roles) {
    const keys = new Set(Object.values(manifest.models[role].tensors));
    checkpointBytes[role] = [...keys].reduce(
      (n, key) => n + manifest.tensors[key].byteLength,
      0,
    );
  }
  const plan = {
    schema: 'pixal3d.gpu-memory-admission.v0',
    maxLiveBytes: maxLiveBytes ?? null,
    checkpointBytes,
    meaning:
      'declared F32 checkpoint bytes per staged role; excludes activations, staging and driver-private memory; not whole-machine fit',
  };
  if (maxLiveBytes !== undefined) {
    const rejected = Object.entries(checkpointBytes).find(
      ([, bytes]) => bytes > maxLiveBytes,
    );
    if (rejected) {
      const error = new Error(
        `Pixal3D GPU memory budget cannot admit declared checkpoint ${rejected[0]}: ${rejected[1]} > ${maxLiveBytes}`,
      );
      error.name = 'Pixal3dMemoryBudgetError';
      error.memoryBudget = {
        ...plan,
        refusedRole: rejected[0],
        refusedBytes: rejected[1],
      };
      throw error;
    }
  }
  return plan;
}

export function pixal3dGenerationModelCallCounts(manifest) {
  const count = p => p.steps.reduce((n, s) => n + (s.guided ? 2 : 1), 0);
  const c = manifest.models;
  return {
    'sparse-structure-sampling': count(buildSparseSamplerPlan(c.sparseFlow.config)),
    'low-resolution-shape-sampling': count(
      buildSLatSamplerPlan({ ...c.lowResolutionShape.config, tokenRows: 1, mode: 'shape' }),
    ),
    ...(pixal3dGenerationPipelineType(manifest) === '1024_cascade'
      ? {
          'high-resolution-shape-sampling': count(
            buildSLatSamplerPlan({ ...c.highResolutionShape.config, tokenRows: 1, mode: 'shape' }),
          ),
        }
      : {}),
    'shape-conditioned-texture-sampling': count(
      buildSLatSamplerPlan({ ...c.textureFlow.config, tokenRows: 1, mode: 'texture' }),
    ),
  };
}

export function validatePixal3dGenerationResult(result, m) {
  validatePixal3dGenerationInputs(m);
  validateNativePrefixBackend(result.backend);
  const c = result.composition;
  const type = pixal3dGenerationPipelineType(m);
  const cascade = type === '1024_cascade';
  const conditioningMode =
    m.conditioningMode ?? (cascade ? 'stage-specific-1024' : 'source-512');
  const stageSpecific = cascade && conditioningMode === 'stage-specific-1024';

  if (
    result.status !== 'succeeded' ||
    result.effectiveRoute !== PIXAL3D_GENERATION_ROUTE ||
    result.requestedRoute !== PIXAL3D_GENERATION_ROUTE ||
    result.backend.isFallbackAdapter !== false ||
    result.profileStatus !== 'passed' ||
    result.profile?.evidence?.mode !== 'live' ||
    result.profile?.routeId !== PIXAL3D_GENERATION_ROUTE ||
    result.numericalStatus !== 'not-compared'
  ) {
    throw new Error(
      'complete native Pixal3D generation route/profile required; not matched-reference fidelity',
    );
  }
  if (
    c?.dinoBlocksExecuted !== 24 ||
    (stageSpecific && c.highResolutionDinoBlocksExecuted !== 24) ||
    c.featureBytesToCPUDuringServing !== 0 ||
    c.coordinateBytesToCPUDuringServing !== 0 ||
    c.sameInvocation !== true ||
    JSON.stringify(c.phases) !== JSON.stringify(pixal3dGenerationPhases(m)) ||
    (c.pipelineType ?? '1024_cascade') !== type ||
    (c.conditioningMode ?? (cascade ? 'stage-specific-1024' : 'source-512')) !==
      conditioningMode ||
    !(c.lowResolutionRows > 0) ||
    !(c.highResolutionRows > 0)
  ) {
    throw new Error('complete resident Pixal3D image-to-learned-fields composition required');
  }
  const roleByPhase = {
    'sparse-structure-sampling': 'sparseFlow',
    'low-resolution-shape-sampling': 'lowResolutionShape',
    'high-resolution-shape-sampling': 'highResolutionShape',
    'shape-conditioned-texture-sampling': 'textureFlow',
  };
  for (const [phase, calls] of Object.entries(pixal3dGenerationModelCallCounts(m))) {
    const expectedBlocks = m.models[roleByPhase[phase]].config.numBlocks;
    if (
      c.stageCounts?.[phase]?.['terminal-output-projection'] !== calls ||
      c.stageCounts?.[phase]?.['block-modulation'] !== calls * expectedBlocks
    ) {
      throw new Error(`complete flow block/source schedule execution required ${phase}`);
    }
  }
  if (
    type === '512' &&
    (c.highResolutionRows !== c.lowResolutionRows ||
      c.stageCounts?.['high-resolution-shape-sampling'] ||
      c.stageCounts?.['learned-cascade-support'])
  ) {
    throw new Error('actual no-cascade source route required; no hidden HR pass');
  }
  for (const name of pixal3dGenerationFields(m)) {
    const row = result.outputs?.[name];
    if (
      !row ||
      !Array.isArray(row.shape) ||
      !row.shape.every(n => Number.isSafeInteger(n) && n > 0) ||
      !['f32', 'i32'].includes(row.dtype) ||
      row.byteLength !== row.shape.reduce((n, x) => n * x, 4) ||
      row.finite !== true ||
      !/^[a-f0-9]{64}$/.test(row.sha256 ?? '')
    ) {
      throw new Error('complete finite retained generation field required ' + name);
    }
  }
  const out = result.outputs;
  const expectedShapes = {
    conditioning: [1, 1029, 1024],
    ...(stageSpecific ? { highResolutionConditioning: [1, 4101, 1024] } : {}),
    shapeCodes: [c.highResolutionRows, 32],
    textureCodes: [c.highResolutionRows, 32],
    'noise.sparse': [1, 8, 16, 16, 16],
    'noise.lowResolutionShape': [c.lowResolutionRows, 32],
    ...(cascade ? { 'noise.highResolutionShape': [c.highResolutionRows, 32] } : {}),
    'noise.texture': [c.highResolutionRows, 32],
  };
  for (const [name, shape] of Object.entries(expectedShapes)) {
    if (
      JSON.stringify(out[name].shape) !== JSON.stringify(shape) ||
      out[name].dtype !== 'f32'
    ) {
      throw new Error('complete source field/noise shape required ' + name);
    }
  }
  for (const [prefix, channels] of [
    ['geometry', 7],
    ['material', 6],
  ]) {
    const fields = out[prefix + '.features'];
    const coords = out[prefix + '.coordinates'];
    if (fields.dtype !== 'f32') {
      throw new Error('F32 learned ' + prefix + ' features required');
    }
    if (
      fields.shape.length !== 2 ||
      fields.shape[1] !== channels ||
      coords.dtype !== 'i32' ||
      coords.shape.length !== 2 ||
      coords.shape[1] !== 3 ||
      coords.shape[0] !== fields.shape[0]
    ) {
      throw new Error('complete learned ' + prefix + ' fields and coordinates required');
    }
    if (c[prefix + 'Resolution'] !== m.meshResolution) {
      throw new Error('canonical learned ' + prefix + ' resolution required');
    }
    const levels = c[prefix + 'Levels'];
    const config = m.models[prefix === 'geometry' ? 'shapeDecoder' : 'textureDecoder'].config;
    if (!Array.isArray(levels) || levels.length !== config.channels.length) {
      throw new Error('complete actual decoder level metadata required ' + prefix);
    }
    for (const [i, level] of levels.entries()) {
      const resolution = m.meshResolution / 2 ** (levels.length - 1 - i);
      if (
        !Number.isSafeInteger(level.rows) ||
        level.rows < 1 ||
        level.rows > resolution ** 3 ||
        level.resolution !== resolution ||
        level.channels !== config.channels[i] ||
        level.blocksExecuted !== config.numBlocks[i] ||
        (i === 0 ? level.rows !== c.highResolutionRows : level.rows > levels[i - 1].rows * 8) ||
        (i === levels.length - 1 && level.rows !== fields.shape[0]) ||
        (prefix === 'material' && level.rows !== c.geometryLevels[i].rows)
      ) {
        throw new Error(
          'actual decoder level row/resolution/block contract required ' + prefix + '.' + i,
        );
      }
      if (prefix === 'geometry' && i < levels.length - 1) {
        const guide = out['geometry.subdivision' + i];
        if (guide.dtype !== 'f32') {
          throw new Error('F32 geometry subdivision guide required ' + i);
        }
        if (JSON.stringify(guide.shape) !== JSON.stringify([level.rows, 8])) {
          throw new Error('actual parent-row subdivision guide required ' + i);
        }
      }
    }
  }
  if (out['geometry.coordinates'].sha256 !== out['material.coordinates'].sha256) {
    throw new Error('shape-guided material coordinate identity required');
  }
  return true;
}

export function admitPixal3dRetainedGenerationCompletion(
  n,
  m,
  { expectedNativeCommit, inputMode = 'completed-command' } = {},
) {
  if (!['completed-command', 'completed-model-fields'].includes(inputMode)) {
    throw new Error('explicit supported retained input mode required');
  }
  if (
    !['succeeded', 'failed'].includes(n.status) ||
    !Number.isFinite(Date.parse(n.finishedAt)) ||
    (inputMode === 'completed-command' && n.status !== 'succeeded') ||
    n.result?.status !== 'succeeded' ||
    n.commit !== expectedNativeCommit ||
    n.expectedCommit !== expectedNativeCommit ||
    n.dirty !== '' ||
    n.result.backend?.isFallbackAdapter !== false ||
    n.result.backend.vendor !== 'apple' ||
    n.result.backend.architecture !== 'metal-3' ||
    n.result.jobCompletion?.status !== 'succeeded' ||
    n.result.jobCompletion.outputPresent !== true
  ) {
    throw new Error(
      'completed exact-source native Apple WebGPU Pixal3D model fields required; command failure is not model completion',
    );
  }
  validatePixal3dGenerationResult(n.result, m);
  for (const name of pixal3dGenerationFields(m)) {
    const row = n.rawOutputs?.[name];
    const observed = n.result.outputs[name];
    if (
      !row ||
      row.sha256 !== observed.sha256 ||
      row.byteLength !== observed.byteLength ||
      row.dtype !== observed.dtype
    ) {
      throw new Error('conflicting retained field receipt: ' + name);
    }
  }
  return Object.freeze({
    inputMode,
    commandStatus: n.status,
    modelStatus: n.result.status,
    ...(n.status === 'failed'
      ? { commandFailure: { phase: n.phase, error: n.error } }
      : {}),
  });
}

export async function persistPixal3dGenerationPhase({
  report,
  row,
  kernelLogPath,
  append,
  persist,
}) {
  if (
    typeof row?.phase !== 'string' ||
    !row.phase ||
    row.effectiveRoute !== PIXAL3D_GENERATION_ROUTE ||
    typeof row.sessionId !== 'string' ||
    !row.sessionId
  ) {
    throw new Error('identified actual Pixal3D generation phase required');
  }
  if (report.nativeSessionId && report.nativeSessionId !== row.sessionId) {
    throw new Error('Pixal3D generation session identity changed');
  }
  if (row.kernel !== undefined && row.kernels !== undefined) {
    throw new Error('complete native kernel event required');
  }
  const kernelBatch =
    row.kernels !== undefined ? row.kernels : row.kernel !== undefined ? [row.kernel] : null;
  if (kernelBatch !== null) {
    if (!Array.isArray(kernelBatch) || kernelBatch.length < 1) {
      throw new Error('complete native kernel event required');
    }
    if (typeof kernelLogPath !== 'string' || !kernelLogPath || typeof append !== 'function') {
      throw new Error('caller-owned kernel journal required');
    }
    const now = new Date().toISOString();
    const baseRow = { ...row };
    delete baseRow.kernel;
    delete baseRow.kernels;
    let lastKernel;
    let lastPhase = row.phase;
    const lines =
      kernelBatch
        .map(item => {
          const hasWrapper = item && typeof item === 'object' && 'kernel' in item;
          const k = hasWrapper ? item.kernel : item;
          if (
            !k ||
            typeof k.stage !== 'string' ||
            !k.stage ||
            !Array.isArray(k.dispatch) ||
            k.dispatch.length < 1 ||
            k.dispatch.length > 3 ||
            !k.dispatch.every(v => Number.isSafeInteger(v) && v >= 0) ||
            !['before-native-kernel', 'native-kernel-returned'].includes(k.point)
          ) {
            throw new Error('complete native kernel event required');
          }
          const itemPhase =
            hasWrapper && typeof item.phase === 'string' && item.phase ? item.phase : row.phase;
          const itemModelRole =
            hasWrapper && 'modelRole' in item ? item.modelRole : baseRow.modelRole;
          const itemObservedAt =
            hasWrapper && typeof item.observedAt === 'string' && item.observedAt
              ? item.observedAt
              : now;
          lastKernel = k;
          lastPhase = itemPhase;
          return JSON.stringify({
            ...baseRow,
            phase: itemPhase,
            ...(itemModelRole !== undefined ? { modelRole: itemModelRole } : {}),
            kernel: k,
            observedAt: itemObservedAt,
          });
        })
        .join('\n') + '\n';
    await append(kernelLogPath, lines);
    report.nativeSessionId = row.sessionId;
    report.lastKernel = lastKernel;
    report.lastBrowserPhase = lastPhase;
    report.kernelEvidence = {
      path: kernelLogPath,
      count: (report.kernelEvidence?.count ?? 0) + kernelBatch.length,
      retention: 'complete append-only events; no cap',
    };
    return;
  }
  if (row.noiseInput) {
    const n = row.noiseInput;
    if (
      typeof n.stage !== 'string' ||
      !n.stage ||
      n.dtype !== 'f32' ||
      !Array.isArray(n.shape) ||
      !n.shape.length ||
      !n.shape.every(v => Number.isSafeInteger(v) && v > 0) ||
      n.shape.reduce((a, b) => a * b, 4) !== n.byteLength ||
      typeof n.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(n.sha256)
    ) {
      throw new Error('complete replay noise input observation required');
    }
  }
  report.nativeSessionId = row.sessionId;
  report.livePhases ??= [];
  report.livePhases.push({ ...row, observedAt: new Date().toISOString() });
  report.lastBrowserPhase = row.phase;
  await persist();
}

export async function persistPixal3dGenerationAsset({
  report,
  bytes,
  outputPath,
  write,
  persist,
}) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 28) {
    throw new Error('complete learned GLB2 asset required');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = view.getUint32(12, true);
  const binStart = 28 + n;
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length ||
    n % 4 ||
    view.getUint32(16, true) !== 0x4e4f534a ||
    binStart > bytes.length ||
    view.getUint32(24 + n, true) !== 0x004e4942 ||
    view.getUint32(20 + n, true) !== bytes.length - binStart
  ) {
    throw new Error('complete learned GLB2 document and binary required');
  }
  const doc = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + n)).trim());
  const info = doc.extras?.pixal3d;
  const provenance = info?.provenance;
  const binLength = bytes.length - binStart;
  const primitive = doc.meshes?.[0]?.primitives?.[0];
  if (
    info?.stage !== 'learned-geometry-and-material' ||
    !report.nativeSessionId ||
    provenance?.sessionId !== report.nativeSessionId ||
    provenance?.inputManifestSha256 !== report.fixtureSha256 ||
    provenance?.route !== PIXAL3D_GENERATION_ROUTE ||
    JSON.stringify(doc.nodes?.[0]?.matrix) !== JSON.stringify(PIXAL3D_GLB_NODE_MATRIX)
  ) {
    throw new Error('identified current Pixal3D generation PBR asset required');
  }
  if (
    doc.asset?.version !== '2.0' ||
    doc.buffers?.length !== 1 ||
    doc.buffers[0].uri !== undefined ||
    doc.buffers[0].byteLength !== binLength ||
    !primitive
  ) {
    throw new Error('complete embedded PBR surface required');
  }
  const bufferView = index => {
    const b = Number.isSafeInteger(index) ? doc.bufferViews?.[index] : undefined;
    const offset = b?.byteOffset ?? 0;
    if (
      !b ||
      b.buffer !== 0 ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(b.byteLength) ||
      b.byteLength < 1 ||
      offset + b.byteLength > binLength
    ) {
      throw new Error('complete embedded asset buffer view required');
    }
    return { ...b, byteOffset: offset };
  };
  const accessor = (index, type, componentType, width) => {
    const a = Number.isSafeInteger(index) ? doc.accessors?.[index] : undefined;
    const offset = a?.byteOffset ?? 0;
    if (
      !a ||
      a.type !== type ||
      a.componentType !== componentType ||
      !Number.isSafeInteger(a.count) ||
      a.count < 1 ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      a.sparse
    ) {
      throw new Error('complete PBR geometry accessor required');
    }
    const b = bufferView(a.bufferView);
    const stride = b.byteStride ?? width;
    if (
      !Number.isSafeInteger(stride) ||
      stride < width ||
      offset + (a.count - 1) * stride + width > b.byteLength
    ) {
      throw new Error('complete PBR accessor bytes required');
    }
    return a;
  };
  const positions = accessor(primitive.attributes?.POSITION, 'VEC3', 5126, 12);
  const normals = accessor(primitive.attributes?.NORMAL, 'VEC3', 5126, 12);
  const uv = accessor(primitive.attributes?.TEXCOORD_0, 'VEC2', 5126, 8);
  const indices = accessor(primitive.indices, 'SCALAR', 5125, 4);
  if (positions.count !== normals.count || positions.count !== uv.count || indices.count % 3) {
    throw new Error('complete PBR triangle/UV surface required');
  }
  const material = doc.materials?.[primitive.material];
  const pbr = material?.pbrMetallicRoughness;
  if (material?.alphaMode !== 'OPAQUE' || !pbr || doc.images?.length !== 2) {
    throw new Error('complete learned PBR material required');
  }
  const imageIndices = new Set();
  for (const texture of [pbr.baseColorTexture, pbr.metallicRoughnessTexture]) {
    const t = Number.isSafeInteger(texture?.index) ? doc.textures?.[texture.index] : undefined;
    const image = Number.isSafeInteger(t?.source) ? doc.images?.[t.source] : undefined;
    if (!image || image.uri !== undefined || image.mimeType !== 'image/png') {
      throw new Error('embedded learned PBR PNG required');
    }
    imageIndices.add(t.source);
    const b = bufferView(image.bufferView);
    const start = binStart + b.byteOffset;
    const end = start + b.byteLength;
    if (
      b.byteLength < 45 ||
      !bytes.subarray(start, start + 8).every((v, i) => v === [137, 80, 78, 71, 13, 10, 26, 10][i])
    ) {
      throw new Error('complete embedded PNG required');
    }
    let offset = start + 8;
    let header = false;
    let data = false;
    let ended = false;
    while (offset + 12 <= end) {
      const length = view.getUint32(offset);
      const type = view.getUint32(offset + 4);
      if (offset + length + 12 > end) throw new Error('complete embedded PNG chunk required');
      if (!header) {
        if (type !== 0x49484452 || length !== 13 || !view.getUint32(offset + 8) || !view.getUint32(offset + 12)) {
          throw new Error('complete embedded PNG header required');
        }
        header = true;
      }
      if (type === 0x49444154 && length > 0) data = true;
      offset += length + 12;
      if (type === 0x49454e44) {
        ended = length === 0 && offset === end;
        break;
      }
    }
    if (!header || !data || !ended) throw new Error('complete embedded PNG data/end required');
  }
  if (imageIndices.size !== 2) {
    throw new Error('complete distinct base-color and metallic-roughness images required');
  }
  const sha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    v => v.toString(16).padStart(2, '0'),
  ).join('');
  await write(outputPath, bytes);
  report.assetArtifact = {
    path: outputPath,
    byteLength: bytes.length,
    sha256,
    class: 'learned-geometry-and-material/PBR-textures',
  };
  await persist();
  return report.assetArtifact;
}
