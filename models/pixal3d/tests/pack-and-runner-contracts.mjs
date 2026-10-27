import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packScriptUrl = new URL('../pack-generation.py', import.meta.url);
const runnerModuleUrl = new URL('../generate-image.mjs', import.meta.url);
assert.ok(existsSync(packScriptUrl), 'Missing models/pixal3d/pack-generation.py');
assert.ok(existsSync(runnerModuleUrl), 'Missing models/pixal3d/generate-image.mjs');

const {
  PIXAL3D_LOCAL_CONFIG_SCHEMA,
  validatePixal3dBinaryGlb,
  validatePixal3dLocalGenerationConfig,
  resolvePixal3dGenerationFinishing,
  runPixal3dNativeGeneration,
  generatePixal3dImage,
} = await import(runnerModuleUrl);
const {
  validatePixal3dGenerationInputs,
  loadPixal3dGenerationInputs,
} = await import('../generation-inputs.js');
const { computePixal3dDistanceFromFov } = await import('../proj-grid.js');
const { PIXAL3D_GLB_NODE_MATRIX } = await import('../pixal3d-mesh.js');

assert.equal(PIXAL3D_LOCAL_CONFIG_SCHEMA, 'pixal3d.local-generation-config.v0');

// 1. Local generation config & finishing contract checks
const validConfig = {
  schema: 'pixal3d.local-generation-config.v0',
  repoRoot: '/source/kaminos',
  checkpointBase: '/weights/pixal3d',
  python: '/usr/bin/python3',
  memoryPython: '/usr/bin/python3',
  sourceRoot: '/source/pixal3d-mlx',
  chrome: '/opt/chrome',
  greenroomBin: '/opt/greenroom',
  queueDir: '/var/queue',
  expectedCommit: 'a'.repeat(40),
  expectedSourceCommit: 'b'.repeat(40),
  pipelineType: '1024_cascade',
  conditioningMode: 'stage-specific-1024',
  decoderActivationStorage: 'f16',
  steps: 12,
  seed: 42,
  targetFaces: 200000,
  gpuBufferBudgetMiB: 6144,
  processMemoryBudgetMiB: 10240,
  cameraAngleX: 0.5026548,
  meshScale: 1.0,
};

assert.equal(validatePixal3dLocalGenerationConfig(validConfig), validConfig);
assert.deepEqual(resolvePixal3dGenerationFinishing(validConfig), {
  sourceRoot: '/source/pixal3d-mlx',
  expectedSourceCommit: 'b'.repeat(40),
  cleanupMode: 'reference-cleanup',
});

for (const invalid of [
  { schema: 'wrong' },
  { repoRoot: 'relative/path' },
  { expectedCommit: 'not-a-sha' },
  { pipelineType: '256' },
  { conditioningMode: 'unknown-mode' },
  { pipelineType: '512', conditioningMode: 'stage-specific-1024' },
  { decoderActivationStorage: 'bf16' },
  { steps: 0 },
  { seed: -1 },
  { cameraAngleX: 0 },
  { cameraAngleX: Math.PI },
  { meshScale: 0 },
  { cleanupMode: 'unsupported' },
]) {
  assert.throws(
    () => validatePixal3dLocalGenerationConfig({ ...validConfig, ...invalid }),
    /required|supported|conditioningMode|cameraAngleX|meshScale|cleanup/,
  );
}

// 2. Packager fail-first durable report on wrong commit
const repoRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const packScript = fileURLToPath(packScriptUrl);
const scratch = mkdtempSync(path.join(tmpdir(), 'pixal3d-pack-test-'));
try {
  const badOut = path.join(scratch, 'bad-out');
  const badRun = spawnSync(
    'python3',
    [
      packScript,
      '--repo-root',
      repoRoot,
      '--expected-commit',
      '0'.repeat(40),
      '--pixal-ckpts',
      path.join(scratch, 'missing-ckpts'),
      '--naf-weights',
      path.join(scratch, 'missing-naf.safetensors'),
      '--dino-weights',
      path.join(scratch, 'missing-dino.safetensors'),
      '--image',
      path.join(scratch, 'missing.png'),
      '--out',
      badOut,
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(badRun.status, 0, 'packager must fail on mismatched commit');
  const badManifest = JSON.parse(readFileSync(path.join(badOut, 'manifest.json'), 'utf8'));
  assert.equal(badManifest.schema, 'pixal3d.generation-inputs.v0');
  assert.equal(badManifest.status, 'failed');
  assert.equal(badManifest.phase, 'source-identity');
  assert.equal(badManifest.modelCalls, 0);
  assert.ok(badManifest.error?.message);

  // 2b. Packager pre-source configuration failure (e.g. --camera-angle-x 0) still writes durable manifest.json (S3-F5)
  const zeroFovOut = path.join(scratch, 'zero-fov-out');
  const zeroFovRun = spawnSync(
    'python3',
    [
      packScript,
      '--repo-root',
      repoRoot,
      '--expected-commit',
      '0'.repeat(40),
      '--pixal-ckpts',
      path.join(scratch, 'missing-ckpts'),
      '--naf-weights',
      path.join(scratch, 'missing-naf.safetensors'),
      '--dino-weights',
      path.join(scratch, 'missing-dino.safetensors'),
      '--image',
      path.join(scratch, 'missing.png'),
      '--out',
      zeroFovOut,
      '--camera-angle-x',
      '0',
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(zeroFovRun.status, 0, 'packager must fail on --camera-angle-x 0');
  const zeroFovManifest = JSON.parse(readFileSync(path.join(zeroFovOut, 'manifest.json'), 'utf8'));
  assert.equal(zeroFovManifest.schema, 'pixal3d.generation-inputs.v0');
  assert.equal(zeroFovManifest.status, 'failed');
  assert.equal(zeroFovManifest.phase, 'configuration');
  assert.equal(zeroFovManifest.modelCalls, 0);
  assert.match(zeroFovManifest.error?.message ?? '', /cameraAngleX/);

  // 2c. Nonfinite --camera-angle-x nan must serialize as strict parseable JSON without bare NaN
  const nanFovOut = path.join(scratch, 'nan-fov-out');
  const nanFovRun = spawnSync(
    'python3',
    [
      packScript,
      '--repo-root',
      repoRoot,
      '--expected-commit',
      '0'.repeat(40),
      '--pixal-ckpts',
      path.join(scratch, 'missing-ckpts'),
      '--naf-weights',
      path.join(scratch, 'missing-naf.safetensors'),
      '--dino-weights',
      path.join(scratch, 'missing-dino.safetensors'),
      '--image',
      path.join(scratch, 'missing.png'),
      '--out',
      nanFovOut,
      '--camera-angle-x',
      'nan',
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(nanFovRun.status, 0, 'packager must fail on --camera-angle-x nan');
  const nanFovManifest = JSON.parse(readFileSync(path.join(nanFovOut, 'manifest.json'), 'utf8'));
  assert.equal(nanFovManifest.status, 'failed');
  assert.equal(nanFovManifest.phase, 'configuration');
  assert.equal(nanFovManifest.camera.cameraAngleX, 'nan');

  // 3. Build a synthetic miniature safetensors checkpoint set & RGB ppm image, run pack-generation.py
  const synthDir = path.join(scratch, 'synth-ckpts');
  const outDir = path.join(scratch, 'packed-out');
  mkdirSync(synthDir, { recursive: true });
  const headCommit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();

  const buildSynth = spawnSync(
    'python3',
    [
      '-c',
      `
import json, struct, sys
from pathlib import Path
import numpy as np

root = Path(sys.argv[1])
pack_path = Path(sys.argv[2])
import importlib.util
spec = importlib.util.spec_from_file_location("pack_pixal", pack_path)
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)

def write_safetensors(path, tensors):
    header = {}
    blobs = []
    offset = 0
    for k, (arr, dtype_str) in sorted(tensors.items()):
        raw = arr.tobytes()
        header[k] = {"dtype": dtype_str, "shape": list(arr.shape), "data_offsets": [offset, offset + len(raw)]}
        blobs.append(raw)
        offset += len(raw)
    h_bytes = json.dumps(header).encode("utf-8")
    if len(h_bytes) % 8:
        h_bytes += b" " * (8 - (len(h_bytes) % 8))
    with open(path, "wb") as f:
        f.write(struct.pack("<Q", len(h_bytes)))
        f.write(h_bytes)
        for b in blobs:
            f.write(b)

# 1. NAF safetensors (37 keys)
naf_shapes = pack.naf_weight_shapes(dim=256, heads_rope=4, img_layers=2)
write_safetensors(root / "naf_release.safetensors", {
    k: (np.full(s, 0.01, dtype="<f4"), "F32") for k, s in naf_shapes.items()
})

# 2. Flow safetensors (num_blocks=1, miniature channels=128, heads=1, hidden=128 for fast test)
for stem, ci, co, proj_in, has_phases in [
    ("ss_flow_img_dit_1_3B_64_bf16", 8, 8, 1024, True),
    ("slat_flow_img2shape_dit_1_3B_512_bf16", 32, 32, 2048, False),
    ("slat_flow_img2shape_dit_1_3B_1024_bf16", 32, 32, 2048, False),
    ("slat_flow_imgshape2tex_dit_1_3B_1024_bf16", 64, 32, 2048, False),
]:
    f_tensors = {}
    for _, ckpt_k, shape in pack.flow_checkpoint_specs(
        channels=128, heads=1, context_channels=1024, proj_in_channels=proj_in,
        hidden=128, frequency_dim=256, num_blocks=1, in_channels=ci, out_channels=co
    ):
        f_tensors[ckpt_k] = (np.zeros(shape, dtype="<u2"), "BF16")
    if has_phases:
        phases = np.zeros((4096, 128), dtype="<f4")
        phases[:, 0::2] = 1.0
        f_tensors["rope_phases"] = (phases, "F32")
    write_safetensors(root / f"{stem}.safetensors", f_tensors)

# 3. Occupancy decoder (num_res_blocks=0, num_res_blocks_middle=0, channels=[16,8,4] for fast test)
occ_shapes = pack.occupancy_decoder_shapes(channels=[16, 8, 4], num_res_blocks=0, num_res_blocks_middle=0)
write_safetensors(root / "ss_dec_conv3d_16l8_fp16.safetensors", {
    k: (np.zeros(s, dtype="<f2"), "F16") for k, s in occ_shapes.items()
})

# 4. Shape & texture decoders (num_blocks=[0,0,0,0,0], channels=[64,32,16,8,4] for fast test)
for stem, out_c in [("shape_dec_next_dc_f16c32_fp16", 7), ("tex_dec_next_dc_f16c32_fp16", 6)]:
    dec_shapes = pack.slat_decoder_checkpoint_shapes(channels=[64, 32, 16, 8, 4], num_blocks=[0,0,0,0,0], out_channels=out_c)
    write_safetensors(root / f"{stem}.safetensors", {
        k: (np.zeros(s, dtype="<f2"), "F16") for k, s in dec_shapes.items()
    })

# 5. DINOv3 safetensors (24 layers)
dino_tensors = {
    "embeddings.cls_token": (np.zeros((1, 1, 1024), dtype="<f4"), "F32"),
    "embeddings.register_tokens": (np.zeros((1, 4, 1024), dtype="<f4"), "F32"),
    "embeddings.patch_embeddings.weight": (np.zeros((1024, 3, 16, 16), dtype="<f4"), "F32"),
    "embeddings.patch_embeddings.bias": (np.zeros((1024,), dtype="<f4"), "F32"),
}
for i in range(24):
    p = f"layer.{i}"
    for k, s in [
        ("norm1.weight", (1024,)), ("norm1.bias", (1024,)),
        ("norm2.weight", (1024,)), ("norm2.bias", (1024,)),
        ("attention.q_proj.weight", (1024, 1024)), ("attention.q_proj.bias", (1024,)),
        ("attention.k_proj.weight", (1024, 1024)),
        ("attention.v_proj.weight", (1024, 1024)), ("attention.v_proj.bias", (1024,)),
        ("attention.o_proj.weight", (1024, 1024)), ("attention.o_proj.bias", (1024,)),
        ("layer_scale1.lambda1", (1024,)), ("layer_scale2.lambda1", (1024,)),
        ("mlp.up_proj.weight", (4096, 1024)), ("mlp.up_proj.bias", (4096,)),
        ("mlp.down_proj.weight", (1024, 4096)), ("mlp.down_proj.bias", (1024,)),
    ]:
        dino_tensors[f"{p}.{k}"] = (np.zeros(s, dtype="<f4"), "F32")
write_safetensors(root / "dino_model.safetensors", dino_tensors)

# 6. Write a simple binary PPM image (16x16 RGB) so PIL or fallback reader can read it
ppm = root / "input.ppm"
with open(ppm, "wb") as f:
    f.write(b"P6\\n16 16\\n255\\n" + bytes([120, 140, 160] * (16 * 16)))
`,
      synthDir,
      packScript,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(buildSynth.status, 0, buildSynth.stderr || buildSynth.stdout);

  const packRun = spawnSync(
    'python3',
    [
      packScript,
      '--repo-root',
      repoRoot,
      '--expected-commit',
      headCommit,
      '--pixal-ckpts',
      synthDir,
      '--naf-weights',
      path.join(synthDir, 'naf_release.safetensors'),
      '--dino-weights',
      path.join(synthDir, 'dino_model.safetensors'),
      '--image',
      path.join(synthDir, 'input.ppm'),
      '--out',
      outDir,
      '--pipeline-type',
      '512',
      '--steps',
      '2',
      '--flow-blocks',
      '1',
      '--flow-channels',
      '128',
      '--flow-heads',
      '1',
      '--flow-hidden',
      '128',
      '--occ-res-blocks',
      '0',
      '--occ-mid-blocks',
      '0',
      '--occ-channels',
      '16,8,4',
      '--slat-dec-blocks',
      '0,0,0,0,0',
      '--slat-dec-channels',
      '64,32,16,8,4',
      '--skip-clean-check',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(packRun.status, 0, packRun.stderr || packRun.stdout);

  const packedManifest = JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  assert.equal(packedManifest.status, 'succeeded');
  assert.equal(packedManifest.modelCalls, 0);
  assert.deepEqual(packedManifest.tensors['sparse.phases']?.shape, [4096, 64, 2]);
  const plan = validatePixal3dGenerationInputs(packedManifest);
  assert.ok(plan.tensorCount > 400);

  // 3b. Malformed checkpoint tensor shape [1] must be rejected by packager with durable failure phase (S3-F4)
  const badShapeNaf = path.join(scratch, 'bad-shape-naf.safetensors');
  const writeBadNaf = spawnSync(
    'python3',
    [
      '-c',
      `
import json, struct, sys
from pathlib import Path
import numpy as np
pack_path = Path(sys.argv[1])
out_path = Path(sys.argv[2])
import importlib.util
spec = importlib.util.spec_from_file_location("pack_pixal", pack_path)
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)
naf_shapes = pack.naf_weight_shapes(dim=256, heads_rope=4, img_layers=2)
header = {}
blobs = []
offset = 0
for k in sorted(naf_shapes.keys()):
    raw = np.ones((1,), dtype="<f4").tobytes()
    header[k] = {"dtype": "F32", "shape": [1], "data_offsets": [offset, offset + len(raw)]}
    blobs.append(raw)
    offset += len(raw)
h_bytes = json.dumps(header).encode("utf-8")
if len(h_bytes) % 8:
    h_bytes += b" " * (8 - (len(h_bytes) % 8))
with open(out_path, "wb") as f:
    f.write(struct.pack("<Q", len(h_bytes)))
    f.write(h_bytes)
    for b in blobs:
        f.write(b)
`,
      packScript,
      badShapeNaf,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(writeBadNaf.status, 0, writeBadNaf.stderr);
  const badShapeOut = path.join(scratch, 'bad-shape-out');
  const badShapeRun = spawnSync(
    'python3',
    [
      packScript,
      '--repo-root',
      repoRoot,
      '--expected-commit',
      headCommit,
      '--pixal-ckpts',
      synthDir,
      '--naf-weights',
      badShapeNaf,
      '--dino-weights',
      path.join(synthDir, 'dino_model.safetensors'),
      '--image',
      path.join(synthDir, 'input.ppm'),
      '--out',
      badShapeOut,
      '--pipeline-type',
      '512',
      '--steps',
      '2',
      '--flow-blocks',
      '1',
      '--flow-channels',
      '128',
      '--flow-heads',
      '1',
      '--flow-hidden',
      '128',
      '--occ-res-blocks',
      '0',
      '--occ-mid-blocks',
      '0',
      '--occ-channels',
      '16,8,4',
      '--slat-dec-blocks',
      '0,0,0,0,0',
      '--slat-dec-channels',
      '64,32,16,8,4',
      '--skip-clean-check',
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(badShapeRun.status, 0, 'packager must reject malformed [1] checkpoint tensor shape');
  const badShapeManifest = JSON.parse(readFileSync(path.join(badShapeOut, 'manifest.json'), 'utf8'));
  assert.equal(badShapeManifest.status, 'failed');
  assert.equal(badShapeManifest.phase, 'naf-checkpoint-expansion');
  assert.match(badShapeManifest.error?.message ?? '', /shape mismatch/);

  const fetchDiskTensor = (() => {
    const cache = new Map();
    return async name => {
      if (cache.has(name)) return cache.get(name);
      const row = packedManifest.tensors[name];
      assert.ok(row, `Missing tensor descriptor ${name}`);
      const bytes = readFileSync(path.join(outDir, row.file));
      const arr = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
      cache.set(name, arr);
      return arr;
    };
  })();
  const loadedInputs = await loadPixal3dGenerationInputs(packedManifest, fetchDiskTensor);
  assert.equal(loadedInputs.pixelValues.length, 512 * 512 * 3);
  assert.equal(loadedInputs.rawImageValues.length, 512 * 512 * 3);

  // 4. Exercise runPixal3dNativeGeneration with a recording mock runtime -> PBR GLB
  const cellIndex = (x, y, z, r = 4) => (x * r + y) * r + z;
  const activeCells = [
    [1, 1, 1], [2, 1, 1], [1, 2, 1], [2, 2, 1],
    [1, 1, 2], [2, 1, 2], [1, 2, 2], [2, 2, 2],
  ];
  const center = [1.5, 1.5, 1.5];
  const geomFeatures = new Float32Array(activeCells.length * 7);
  const geomCoords = new Int32Array(activeCells.length * 3);
  const matFeatures = new Float32Array(activeCells.length * 6);
  for (let i = 0; i < activeCells.length; i++) {
    const [x, y, z] = activeCells[i];
    geomCoords.set([x, y, z], i * 3);
    const d = Math.hypot(x - center[0], y - center[1], z - center[2]) - 0.9;
    geomFeatures.set([0.5, 0.5, 0.5, d > 0 ? 1 : 0, 1, 1, 1], i * 7);
    matFeatures.set([0.7, 0.4, 0.2, 0.1, 0.8, 1.0], i * 6);
  }
  const mockRuntime = {
    device: {
      limits: { maxStorageBufferBindingSize: 2147483644, maxComputeWorkgroupsPerDimension: 65535 },
      queue: { onSubmittedWorkDone: async () => {} },
    },
    createTensor(d) {
      return {
        ...d,
        byteLength: d.shape.reduce((a, b) => a * b, 4),
        buffer: { destroy() {} },
        destroy() {},
      };
    },
    createManagedBuffer(d) { return { ...d, destroy() {} }; },
    createUniformBuffer(d) { return { ...d, buffer: { destroy() {} }, destroy() {} }; },
    uploadTensor() {},
    defineComputeKernel(d) { return d; },
    async runKernel() {},
    async readTensor(t) {
      if (t.dtype === 'u32' && t.byteLength === 4) {
        return new Uint32Array([t.name?.includes('hash-status') ? 0 : activeCells.length]).buffer;
      }
      if (t.shape?.[1] === 7) return geomFeatures.buffer.slice(0);
      if (t.shape?.[1] === 6) return matFeatures.buffer.slice(0);
      if (t.dtype === 'i32' && t.shape?.[1] === 3) return geomCoords.buffer.slice(0);
      return new Float32Array(t.shape.reduce((a, b) => a * b, 1)).buffer;
    },
  };
  const mockRoute = {
    routeId: 'pixal3d.native.runner.test',
    runtime: mockRuntime,
    enqueue({ execute }) {
      const invocation = { id: 'inv-test' };
      return {
        completion: Promise.resolve().then(async () => ({
          status: 'succeeded',
          output: await execute(invocation),
        })),
      };
    },
  };
  const nativeRun = await runPixal3dNativeGeneration({
    route: mockRoute,
    manifest: packedManifest,
    fetchTensor: fetchDiskTensor,
    assetMode: 'raw-glb',
    textureSize: 4,
    unwrapMesh: async mesh => {
      const triCount = mesh.triangles.length / 3;
      const vertices = new Float32Array(triCount * 9);
      const normals = new Float32Array(triCount * 9);
      const triangles = new Uint32Array(triCount * 3);
      const uvs = new Float32Array(triCount * 6);
      for (let f = 0; f < triCount; f++) {
        for (let k = 0; k < 3; k++) {
          const srcIdx = mesh.triangles[f * 3 + k] * 3;
          const dstIdx = f * 3 + k;
          vertices.set(mesh.vertices.subarray(srcIdx, srcIdx + 3), dstIdx * 3);
          normals.set([0, 0, 1], dstIdx * 3);
          triangles[dstIdx] = dstIdx;
        }
        uvs.set([0.1, 0.1, 0.8, 0.1, 0.1, 0.8], f * 6);
      }
      return {
        vertices,
        normals,
        triangles,
        uvs,
        metadata: mesh.metadata,
        uvMetadata: { route: 'synthetic-test-uv' },
      };
    },
  });
  assert.ok(nativeRun.asset?.glb instanceof ArrayBuffer);
  const view = new DataView(nativeRun.asset.glb);
  const jsonLen = view.getUint32(12, true);
  const gltf = JSON.parse(
    new TextDecoder().decode(new Uint8Array(nativeRun.asset.glb, 20, jsonLen)).trim(),
  );
  assert.deepEqual(gltf.nodes[0].matrix, [...PIXAL3D_GLB_NODE_MATRIX]);
  assert.equal(nativeRun.disposed, false);
  nativeRun.dispose();
  assert.equal(nativeRun.disposed, true);
  nativeRun.dispose(); // idempotent

  // 4b. Disposal custody on generation failure and asset-consumer failure (S3-F3)
  let destroyedBuffers = 0;
  const trackingRuntime = {
    ...mockRuntime,
    createTensor(d) {
      return {
        ...d,
        byteLength: d.shape.reduce((a, b) => a * b, 4),
        buffer: { destroy() { destroyedBuffers++; } },
        destroy() { destroyedBuffers++; },
      };
    },
  };
  const failingGenRoute = {
    routeId: 'pixal3d.native.fail-gen.test',
    runtime: trackingRuntime,
    enqueue({ execute }) {
      return {
        completion: Promise.resolve().then(async () => {
          await execute({ id: 'inv-fail' });
          return {
            status: 'failed',
            failure: { name: 'RuntimeError', message: 'simulated generation failure' },
          };
        }),
      };
    },
  };
  await assert.rejects(
    () =>
      runPixal3dNativeGeneration({
        route: failingGenRoute,
        manifest: packedManifest,
        fetchTensor: fetchDiskTensor,
      }),
    /simulated generation failure/,
  );
  assert.ok(destroyedBuffers > 0, 'generation failure must dispose producer tensors');

  destroyedBuffers = 0;
  await assert.rejects(
    () =>
      runPixal3dNativeGeneration({
        route: { ...mockRoute, runtime: trackingRuntime },
        manifest: packedManifest,
        fetchTensor: fetchDiskTensor,
        assetMode: 'raw-glb',
        unwrapMesh: async () => {
          throw new Error('simulated asset unwrap failure');
        },
      }),
    /simulated asset unwrap failure/,
  );
  assert.ok(destroyedBuffers > 0, 'asset consumer failure must dispose producer and consumer tensors');

  // 5. generatePixal3dImage command control-flow regressions (S3-F1, S3-F2)
  const cmdDir = path.join(scratch, 'cmd-test');
  mkdirSync(cmdDir, { recursive: true });
  const cfgPath = path.join(cmdDir, 'config.json');
  const nonDefaultConfig = {
    ...validConfig,
    repoRoot,
    expectedCommit: headCommit,
    pipelineType: '1024_cascade',
    conditioningMode: 'shared-512-preview',
    cameraAngleX: 0.65,
    meshScale: 1.75,
    dinoWeights: path.join(synthDir, 'dino_model.safetensors'),
    preparedPackageRoot: path.join(cmdDir, 'packages'),
  };
  writeFileSync(cfgPath, JSON.stringify(nonDefaultConfig));

  const stubManifest = {
    ...packedManifest,
    pipelineType: '1024_cascade',
    conditioningMode: 'shared-512-preview',
    meshResolution: 1024,
    samplingSteps: nonDefaultConfig.steps,
    seed: nonDefaultConfig.seed,
    camera: {
      cameraAngleX: nonDefaultConfig.cameraAngleX,
      meshScale: nonDefaultConfig.meshScale,
      distance: computePixal3dDistanceFromFov({
        cameraAngleX: nonDefaultConfig.cameraAngleX,
        meshScale: nonDefaultConfig.meshScale,
        imageResolution: 512,
      }),
    },
    models: {
      ...packedManifest.models,
      sparseFlow: {
        ...packedManifest.models.sparseFlow,
        config: { ...packedManifest.models.sparseFlow.config, steps: nonDefaultConfig.steps },
      },
      lowResolutionShape: {
        ...packedManifest.models.lowResolutionShape,
        config: { ...packedManifest.models.lowResolutionShape.config, steps: nonDefaultConfig.steps },
      },
      highResolutionShape: {
        ...packedManifest.models.lowResolutionShape,
        identity: {
          ...packedManifest.models.lowResolutionShape.identity,
          sha256: 'c'.repeat(64),
        },
        config: { ...packedManifest.models.lowResolutionShape.config, steps: nonDefaultConfig.steps },
      },
      textureFlow: {
        ...packedManifest.models.textureFlow,
        config: { ...packedManifest.models.textureFlow.config, steps: nonDefaultConfig.steps },
      },
    },
  };
  const writeStubManifest = preparedDir => {
    mkdirSync(preparedDir, { recursive: true });
    writeFileSync(path.join(preparedDir, 'manifest.json'), JSON.stringify(stubManifest));
  };

  const capturedArgvs = [];
  const stubDeps = {
    gitSourceIdentity: () => ({ commit: headCommit, dirty: false }),
    startProcessMemory: async () => ({
      stop: async () => ({ status: 'observed', peakFootprintBytes: 1024 }),
    }),
    createGenerationCommandRunner: ({ record }) => ({
      stop: async () => {},
      run: async (argv, label) => {
        capturedArgvs.push({ argv, label });
        record.commands.push({ argv, label, exit: { code: 0 } });
        const outIdx = argv.indexOf('--out');
        if (outIdx !== -1) writeStubManifest(argv[outIdx + 1]);
      },
    }),
  };

  // 5a. Without route / executeGeneration producing a GLB, generatePixal3dImage MUST fail (S3-F1)
  const failReportPath = path.join(cmdDir, 'fail-report.json');
  const failGlbPath = path.join(cmdDir, 'missing.glb');
  const failResult = await generatePixal3dImage(
    {
      config: cfgPath,
      input: path.join(synthDir, 'input.ppm'),
      output: failGlbPath,
      report: failReportPath,
      'run-id': 'run-no-route',
    },
    { ...stubDeps, route: null },
  );
  assert.equal(failResult.ok, false, 'packaging alone must never report ok: true');
  assert.equal(failResult.status, 'failed');
  assert.equal(existsSync(failGlbPath), false);
  assert.match(failResult.error?.message ?? '', /registered WebGPU route required/);

  // Verify S3-F2: nondefault conditioningMode, cameraAngleX, and meshScale were forwarded to pack-generation.py
  assert.equal(capturedArgvs.length, 1);
  const packArgv = capturedArgvs[0].argv;
  assert.equal(packArgv[packArgv.indexOf('--conditioning-mode') + 1], 'shared-512-preview');
  assert.equal(packArgv[packArgv.indexOf('--camera-angle-x') + 1], '0.65');
  assert.equal(packArgv[packArgv.indexOf('--mesh-scale') + 1], '1.75');

  // 5b. With a route that executes native generation and writes the GLB, generatePixal3dImage succeeds
  const okReportPath = path.join(cmdDir, 'ok-report.json');
  const okGlbPath = path.join(cmdDir, 'generated.glb');
  const okResult = await generatePixal3dImage(
    {
      config: cfgPath,
      input: path.join(synthDir, 'input.ppm'),
      output: okGlbPath,
      report: okReportPath,
      'run-id': 'run-with-route',
    },
    {
      ...stubDeps,
      executeGeneration: async ({ output }) => {
        writeFileSync(output, Buffer.from(nativeRun.asset.glb));
        return { routeId: 'synthetic-verified-route' };
      },
    },
  );
  assert.equal(okResult.ok, true, okResult.error?.message);
  assert.equal(okResult.status, 'succeeded');
  assert.equal(existsSync(okGlbPath), true);
  assert.equal(okResult.artifact?.byteLength, nativeRun.asset.glb.byteLength);

  // 5c. Malformed 20-byte GLB (magic + zeros) must be rejected (S3-F1)
  const badGlbHeader = Buffer.alloc(20);
  badGlbHeader.writeUInt32LE(0x46546c67, 0);
  assert.throws(() => validatePixal3dBinaryGlb(badGlbHeader), /container header and JSON chunk/);
  const malformedResult = await generatePixal3dImage(
    {
      config: cfgPath,
      input: path.join(synthDir, 'input.ppm'),
      output: path.join(cmdDir, 'malformed.glb'),
      report: path.join(cmdDir, 'malformed-report.json'),
      'run-id': 'run-malformed-glb',
    },
    {
      ...stubDeps,
      executeGeneration: async ({ output }) => {
        writeFileSync(output, badGlbHeader);
        return { routeId: 'malformed-route' };
      },
    },
  );
  assert.equal(malformedResult.ok, false, 'malformed 20-byte GLB must not report success');
  assert.equal(malformedResult.status, 'failed');

  // 5d. Pre-existing final output file must not be reused when executor writes nothing (S3-F1)
  const staleGlbPath = path.join(cmdDir, 'preexisting-stale.glb');
  writeFileSync(staleGlbPath, Buffer.from(nativeRun.asset.glb));
  const staleResult = await generatePixal3dImage(
    {
      config: cfgPath,
      input: path.join(synthDir, 'input.ppm'),
      output: staleGlbPath,
      report: path.join(cmdDir, 'stale-report.json'),
      'run-id': 'run-stale-output',
    },
    {
      ...stubDeps,
      executeGeneration: async () => ({ routeId: 'noop-route' }),
    },
  );
  assert.equal(staleResult.ok, false, 'executor returning without writing current run output must fail');
  assert.equal(staleResult.status, 'failed');
  assert.match(staleResult.error?.message ?? '', /did not produce its staged GLB/);

  // 5e. Packaged manifest omitting camera fields must be rejected when nondefault camera was requested (S3-F2)
  const noCamResult = await generatePixal3dImage(
    {
      config: cfgPath,
      input: path.join(synthDir, 'input.ppm'),
      output: path.join(cmdDir, 'nocam.glb'),
      report: path.join(cmdDir, 'nocam-report.json'),
      'run-id': 'run-missing-camera',
    },
    {
      ...stubDeps,
      createGenerationCommandRunner: ({ record }) => ({
        stop: async () => {},
        run: async (argv, label) => {
          record.commands.push({ argv, label, exit: { code: 0 } });
          const outIdx = argv.indexOf('--out');
          if (outIdx !== -1) {
            const preparedDir = argv[outIdx + 1];
            mkdirSync(preparedDir, { recursive: true });
            const { camera: _omitted, ...manifestWithoutCam } = stubManifest;
            writeFileSync(path.join(preparedDir, 'manifest.json'), JSON.stringify(manifestWithoutCam));
          }
        },
      }),
      executeGeneration: async ({ output }) => {
        writeFileSync(output, Buffer.from(nativeRun.asset.glb));
        return { routeId: 'should-not-run' };
      },
    },
  );
  assert.equal(noCamResult.ok, false, 'manifest omitting camera fields must fail config agreement');
  assert.equal(noCamResult.status, 'failed');
  assert.match(noCamResult.error?.message ?? '', /disagrees with requested config/);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('pack-and-runner-contracts.mjs: PASS');
