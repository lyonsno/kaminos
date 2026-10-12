// UniMate demo: text-prompted skeletal motion generated on the visitor's GPU
// beside a live WebGPU scene on one device.
//
// The scene (ground grid and the skeleton, camera orbiting slowly) submits frames
// through the kit foreground service. A generation is a queued job on a kit route.
// Each drift evaluation of the dopri5 sampler is encoded as command duties sized
// to measured throughput, so pending frames submit between them; pause, resume
// and stop go through the kit inference control. The finished motion is decoded
// to world joints and loops at 30 fps. Frame gaps during each run are recorded.
//
// Text and skeleton conditioning come from an exported bundle (export-demo-bundle.py)
// until the browser T5 encoder and skeleton importer exist.
import { CooperativeUniMateDenoiser, UniMateDutyScheduler, createCooperativeCfgDrift } from './unimate-cooperative.js';
import { dopri5Solve } from './unimate-dopri5.js';
import { decodeUniMateMotion, groundedOffsets } from './unimate-decode.js';
import { createWebGpuForegroundService, createWebGpuInferenceControl, createWebGpuInferenceSession }
  from '../../webgpu-inference-kit/src/core.js';

export const UNIMATE_ROUTE_ID = 'unimate.text-to-motion.webgpu-local.v0';

const SCENE_SHADER = /* wgsl */`
struct Cam { viewProj: mat4x4f, invViewProj: mat4x4f, viewport: vec2f, boneWidth: f32, jointRadius: f32 };
@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<storage, read> joints: array<vec4f>;
@group(0) @binding(2) var<storage, read> bones: array<vec4u>;
@group(0) @binding(3) var<storage, read> palette: array<vec4f>;

struct BgOut { @builtin(position) position: vec4f, @location(0) ndc: vec2f };
@vertex fn bgVertex(@builtin(vertex_index) i: u32) -> BgOut {
  let p = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3))[i];
  return BgOut(vec4f(p, 0, 1), p);
}
@fragment fn bgFragment(v: BgOut) -> @location(0) vec4f {
  let a4 = cam.invViewProj * vec4f(v.ndc, 0.0, 1.0);
  let b4 = cam.invViewProj * vec4f(v.ndc, 1.0, 1.0);
  let a = a4.xyz / a4.w;
  let dir = normalize(b4.xyz / b4.w - a);
  let sky = mix(vec3f(0.10, 0.11, 0.13), vec3f(0.20, 0.23, 0.28), clamp(dir.y * 2.0 + 0.5, 0.0, 1.0));
  // Ground plane y = 0. Derivatives must run in uniform control flow, so the grid is
  // computed for every pixel and selected afterwards.
  let below = dir.y < -1e-4;
  let t = select(1e4, -a.y / min(dir.y, -1e-4), below);
  let g = (a + t * dir).xz / 0.25;
  let w = max(fwidth(g), vec2f(1e-4));
  let line = 1.0 - min(min(abs(fract(g.x - 0.5) - 0.5) / w.x, abs(fract(g.y - 0.5) - 0.5) / w.y), 1.0);
  let floorColor = mix(vec3f(0.13, 0.14, 0.15), vec3f(0.34, 0.37, 0.40), line);
  let color = select(sky, mix(sky, floorColor, exp(-t * 0.18)), below);
  return vec4f(color, 1.0);
}

struct BoneOut { @builtin(position) position: vec4f, @location(0) color: vec3f };
fn toScreen(p: vec4f) -> vec2f { return p.xy / p.w * cam.viewport * 0.5; }
fn toClip(s: vec2f, r4: vec4f) -> vec4f { return vec4f(s / (cam.viewport * 0.5) * r4.w, r4.z, r4.w); }
@vertex fn boneVertex(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> BoneOut {
  let b = bones[ii];
  let pa = cam.viewProj * vec4f(joints[b.y].xyz, 1.0);
  let pb = cam.viewProj * vec4f(joints[b.x].xyz, 1.0);
  let sa = toScreen(pa);
  let sb = toScreen(pb);
  var d = sb - sa;
  if (length(d) < 1e-3) { d = vec2f(1.0, 0.0); }
  let n = normalize(vec2f(-d.y, d.x)) * cam.boneWidth * 0.5;
  let corner = array(0u, 1u, 2u, 2u, 1u, 3u)[vi];
  var pos: vec4f;
  if (corner == 0u) { pos = toClip(sa - n, pa); }
  else if (corner == 1u) { pos = toClip(sa + n, pa); }
  else if (corner == 2u) { pos = toClip(sb - n, pb); }
  else { pos = toClip(sb + n, pb); }
  return BoneOut(pos, palette[b.z].rgb);
}
@fragment fn boneFragment(v: BoneOut) -> @location(0) vec4f { return vec4f(v.color, 1.0); }

struct DotOut { @builtin(position) position: vec4f, @location(0) uv: vec2f, @location(1) color: vec3f };
@vertex fn jointVertex(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DotOut {
  let p = cam.viewProj * vec4f(joints[ii].xyz, 1.0);
  let uv = array(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1))[vi];
  let s = toScreen(p) + uv * cam.jointRadius;
  return DotOut(toClip(s, p), uv, palette[u32(joints[ii].w)].rgb);
}
@fragment fn jointFragment(v: DotOut) -> @location(0) vec4f {
  if (dot(v.uv, v.uv) > 1.0) { discard; }
  return vec4f(mix(v.color, vec3f(1.0), 0.35), 1.0);
}`;

// Column-major 4x4 helpers (WGSL mat4x4f layout).
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far * nf, -1, 0, 0, far * near * nf, 0];
}
function lookAt(eye, target, up) {
  const sub = (a, b) => a.map((x, i) => x - b[i]);
  const norm = a => { const l = Math.hypot(...a); return a.map(x => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function invert(m) {
  const inv = new Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  return inv.map(x => x / det);
}

// Limb colour: front legs cyan (1), hind legs green (2), body, head and tail gold (0).
// Names cover the Unitree-style (FR_/RL_ ...) and Truebones/Biped (Clavicle/UpperArm
// vs Thigh/Calf/Foot) conventions; a joint with no match inherits its parent's limb.
function limbClasses(names, parents) {
  const own = name => {
    const n = name.toLowerCase();
    if (/(^|_)(fr|fl)_|front|fore|clavicle|upperarm|forearm|hand|finger|wing/.test(n)) return 1;
    if (/(^|_)(rr|rl)_|rear|hind|thigh|calf|horselink|foot|toe|knee/.test(n)) return 2;
    return 0;
  };
  const out = [];
  names.forEach((name, j) => { out[j] = own(name) || (parents[j] >= 0 ? out[parents[j]] : 0); });
  return out;
}

function frameStats(gaps) {
  if (!gaps?.length) return null;
  const s = [...gaps].sort((x, y) => x - y), q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { frames: gaps.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s.at(-1),
    over33ms: gaps.filter(g => g > 33.4).length, over100ms: gaps.filter(g => g > 100).length };
}

// Gaussian noise from a 32-bit seed (splitmix32 + Box-Muller). Not torch's generator:
// a browser seed names a browser draw, never the matching PyTorch seed.
function gaussianNoise(seed, n) {
  let s = seed >>> 0;
  const next = () => { s = (s + 0x9e3779b9) >>> 0; let z = s; z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0; z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0; return ((z ^ (z >>> 16)) >>> 0) / 4294967296; };
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u = Math.max(next(), 1e-12), v = next(), r = Math.sqrt(-2 * Math.log(u));
    out[i] = r * Math.cos(2 * Math.PI * v);
    if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * v);
  }
  return out;
}

function bundleArrays(index, bytes) {
  const out = {};
  for (const e of index.arrays) out[e.name] = new (e.dtype === 'int32' ? Int32Array : Float32Array)(bytes, e.offset, e.byteLength / 4);
  return out;
}

export async function createUniMateDemo({ canvas, weightsBase = '/weights/', bundleBase = '/demo/', onStatus = () => {} }) {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU is not available in this browser');
  const device = await adapter.requestDevice();
  const session = await createWebGpuInferenceSession({ sessionId: `unimate:${crypto.randomUUID()}`, device, adapterName: 'browser-primary-adapter' });
  const foreground = createWebGpuForegroundService({ routeId: UNIMATE_ROUTE_ID, device });

  onStatus({ phase: 'load', detail: 'skeleton and prompts' });
  const bundle = await (await fetch(`${bundleBase}demo.json`)).json();
  const arrays = bundleArrays(bundle, await (await fetch(`${bundleBase}demo.bin`)).arrayBuffer());
  const { joints: J, parents, jointNames, fps } = bundle.skeleton;
  const T = bundle.skeleton.frames, Fe = 12;
  const rest = Array.from({ length: J }, (_, j) => Array.from(arrays.restPositions.subarray(j * 3, j * 3 + 3)));
  const offsets = groundedOffsets(rest, parents);
  const minY = Math.min(...rest.map(p => p[1]));

  // Scene resources.
  const surface = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  surface.configure({ device, format, alphaMode: 'opaque' });
  const camBuf = device.createBuffer({ size: 144, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const jointBuf = device.createBuffer({ size: J * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const limbs = limbClasses(jointNames, parents);
  const boneList = parents.map((p, j) => (p < 0 ? null : [j, p, limbs[j], 0])).filter(Boolean);
  const boneBuf = device.createBuffer({ size: boneList.length * 16, usage: GPUBufferUsage.STORAGE, mappedAtCreation: true });
  new Uint32Array(boneBuf.getMappedRange()).set(boneList.flat());
  boneBuf.unmap();
  const paletteBuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.STORAGE, mappedAtCreation: true });
  new Float32Array(paletteBuf.getMappedRange()).set([0.95, 0.74, 0.28, 1, 0.30, 0.83, 0.95, 1, 0.42, 0.88, 0.45, 1]);
  paletteBuf.unmap();
  const module = device.createShaderModule({ code: SCENE_SHADER });
  const layout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ...[1, 2, 3].map(binding => ({ binding, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } })),
  ] });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const mk = (vs, fs) => device.createRenderPipelineAsync({ layout: pipelineLayout, vertex: { module, entryPoint: vs },
    fragment: { module, entryPoint: fs, targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
  const [bgPipe, bonePipe, jointPipe] = await Promise.all([mk('bgVertex', 'bgFragment'), mk('boneVertex', 'boneFragment'), mk('jointVertex', 'jointFragment')]);
  const bind = device.createBindGroup({ layout, entries: [camBuf, jointBuf, boneBuf, paletteBuf].map((buffer, binding) => ({ binding, resource: { buffer } })) });

  const jointFrame = new Float32Array(J * 4);
  const restFrame = () => { for (let j = 0; j < J; j++) jointFrame.set([rest[j][0], rest[j][1] - minY, rest[j][2], limbs[j]], j * 4); };
  restFrame();
  const view = { motion: null, startedAt: performance.now(), target: [jointFrame[0], 0.25, jointFrame[2]] };
  const scene = { frames: 0, lastFrameAt: null, gaps: null, running: true, frameIndex: -1 };
  let frameSeq = 0;
  const draw = time => {
    if (view.motion) {
      // rAF timestamps can precede startedAt by up to a frame; keep the index in range.
      const T = view.motion.frames;
      const f = ((Math.floor((Math.max(0, time - view.startedAt) / 1000) * fps) % T) + T) % T;
      scene.frameIndex = f;
      const p = view.motion.positions;
      for (let j = 0; j < J; j++) jointFrame.set([p[(f * J + j) * 3], p[(f * J + j) * 3 + 1], p[(f * J + j) * 3 + 2], limbs[j]], j * 4);
    }
    const root = [jointFrame[0], Math.max(0.25, 0.8 * jointFrame[1]), jointFrame[2]];   // follow the body up when it rears
    // A non-finite root must never enter the smoothed target: it would stick there.
    if (root.every(Number.isFinite)) view.target = view.target.map((v, i) => v + (root[i] - v) * 0.08);
    const ang = time / 1000 * 0.25, dist = 2.4, el = 0.38;
    // Aim a little to the subject's left (camera right vector) so the animal sits right of
    // centre, clear of the control panel.
    const aim = [view.target[0] - 0.32 * Math.cos(ang), view.target[1], view.target[2] + 0.32 * Math.sin(ang)];
    const eye = [aim[0] + dist * Math.cos(el) * Math.sin(ang), aim[1] + dist * Math.sin(el), aim[2] + dist * Math.cos(el) * Math.cos(ang)];
    const vp = mul(perspective(0.8, canvas.width / canvas.height, 0.05, 100), lookAt(eye, aim, [0, 1, 0]));
    const cam = new Float32Array(36);
    cam.set(vp, 0); cam.set(invert(vp), 16); cam.set([canvas.width, canvas.height, 5 * devicePixelRatio, 4.5 * devicePixelRatio], 32);
    device.queue.writeBuffer(camBuf, 0, cam);
    device.queue.writeBuffer(jointBuf, 0, jointFrame);
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: surface.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    pass.setBindGroup(0, bind);
    pass.setPipeline(bgPipe); pass.draw(3);
    pass.setPipeline(bonePipe); pass.draw(6, boneList.length);
    pass.setPipeline(jointPipe); pass.draw(6, J);
    pass.end();
    return enc.finish();
  };
  const requestFrame = time => {
    if (!scene.running) return;
    const handle = foreground.request({ requestId: `scene:${++frameSeq}`, run(opportunity) { opportunity.submit([draw(time)]); } });
    handle.completion.then(receipt => {
      const now = performance.now();
      if (receipt.status === 'completed') {
        scene.frames++;
        if (scene.gaps && scene.lastFrameAt !== null) scene.gaps.push(now - scene.lastFrameAt);
        scene.lastFrameAt = now;
      }
      requestAnimationFrame(requestFrame);
    });
  };
  requestAnimationFrame(requestFrame);

  // Model.
  onStatus({ phase: 'load', detail: 'weights' });
  const manifest = await (await fetch(`${weightsBase}manifest.json`)).json();
  const weightBytes = await (await fetch(`${weightsBase}${manifest.file}`)).arrayBuffer();
  const den = await CooperativeUniMateDenoiser.create(device, manifest, weightBytes);
  den.configure({ B: 2, J });
  const scheduler = new UniMateDutyScheduler(device, { label: 'unimate' });
  const zeros = new Float32Array(768);
  const conditioningFor = caption => {
    const two = a => { const o = new a.constructor(a.length * 2); o.set(a, 0); o.set(a, a.length); return o; };
    const cap = new Float32Array(2 * 768); cap.set(caption, 0); cap.set(zeros, 768);
    return { tpos: two(arrays.tpos), tposParents: two(arrays.tposParents), depths: two(arrays.depths), jointNamesEmb: two(arrays.jointNamesEmb),
      spectral: two(arrays.spectral), graphDist: two(arrays.graphDist), jointRelations: two(arrays.jointRelations), caption: cap,
      motionLength: [bundle.motionLength, bundle.motionLength] };
  };
  onStatus({ phase: 'ready', detail: `${manifest.parameterCount.toLocaleString()} parameters` });

  let active = null;
  async function solve({ promptIndex, noise, schedule, onEvaluation, onStep }) {
    const prompt = bundle.prompts[promptIndex];
    scheduler.setSchedule(schedule);
    den.writeConditioning(conditioningFor(arrays[prompt.caption]));
    den.encodePrepare(scheduler.encoder());
    await scheduler.flush('unimate.prepare');
    const drift = createCooperativeCfgDrift(device, den, scheduler, { prompts: 1, onEvaluation });
    try {
      const res = await dopri5Solve({ y0: noise, drift, outputTimes: bundle.outputTimes, rtol: 1e-3, atol: 1e-6, onStep });
      const final = res.solution.at(-1);
      // Denormalize (motion * std + mean, float32) into [T, J, 12] features, then decode.
      const features = new Float32Array(T * J * Fe);
      for (let t = 0; t < T; t++) for (let j = 0; j < J; j++) for (let d = 0; d < Fe; d++) {
        features[(t * J + j) * Fe + d] = Math.fround(Math.fround(final[(j * Fe + d) * T + t] * arrays.std[j * Fe + d]) + arrays.mean[j * Fe + d]);
      }
      const motion = decodeUniMateMotion({ features, frames: T, parents, offsets });
      return { motion, features, steps: res.steps, evaluations: drift.evaluations, duties: scheduler.stats.history.slice() };
    } finally {
      drift.dispose();
      await scheduler.discard();
    }
  }

  async function generate({ promptIndex = 0, seed = null, cooperative = true, targetDutyMs = 12, maxInFlight = 1, onEvaluation, onStep } = {}) {
    if (active) throw new Error('a generation is already running');
    const prompt = bundle.prompts[promptIndex];
    const noise = seed === null ? Float32Array.from(arrays[prompt.referenceNoise]) : gaussianNoise(seed, J * Fe * T);
    const runId = `unimate:${crypto.randomUUID()}`;
    const abort = new AbortController();
    active = { abort, control: null };
    scene.gaps = []; scene.lastFrameAt = null;
    scheduler.stats.history.length = 0;
    const started = performance.now();
    let frameRun = null, route = null, result;
    try {
      if (cooperative) {
        frameRun = await foreground.beginRun(runId);
        route = await session.registerRoute({ routeId: UNIMATE_ROUTE_ID, runtimeOptions: { runtimeLabel: 'unimate', foregroundOpportunities: frameRun.foregroundOpportunities } });
        const control = createWebGpuInferenceControl({ queue: device.queue, signal: abort.signal, withForeground: frameRun.withForeground });
        active.control = control;
        const job = route.enqueue({ jobId: runId, execute: invocation => solve({ promptIndex, noise, onEvaluation, onStep,
          schedule: { runtime: route.runtime, invocation, control, signal: abort.signal, targetDutyMs, maxInFlight } }) });
        const completion = await job.completion;
        if (completion.status !== 'succeeded') {
          const error = new Error(completion.failure?.message ?? completion.status);
          error.name = completion.failure?.name ?? 'Error';
          throw error;
        }
        result = completion.output;
      } else {
        result = await solve({ promptIndex, noise, schedule: null, onEvaluation, onStep });
      }
      result.prompt = prompt.text;
      result.noise = seed === null ? 'reference (accepted CPU run)' : `browser seed ${seed}`;
      result.wallMs = performance.now() - started;
      result.cooperative = cooperative;
      result.frameStats = frameStats(scene.gaps);
      result.dutyCount = result.duties.length;
      result.longestDutyMs = Math.max(0, ...result.duties.map(d => d.queueMs ?? 0));
      const ref = prompt.referencePositions && seed === null ? arrays[prompt.referencePositions] : null;
      if (ref) {
        let maxDev = 0;
        const p = result.motion.positions;
        for (let i = 0; i < T * J; i++) maxDev = Math.max(maxDev, Math.hypot(p[i * 3] - ref[i * 3], p[i * 3 + 1] - ref[i * 3 + 1], p[i * 3 + 2] - ref[i * 3 + 2]));
        result.referenceMaxJointDeviation = maxDev;
      }
      view.motion = result.motion;
      view.startedAt = performance.now();
      return result;
    } finally {
      try { await active.control?.close(); } catch { /* reported by the control */ }
      if (route) { await route.drain(); session.unregisterRoute(route.routeId); }
      if (frameRun) await frameRun.finish();
      scene.gaps = null;
      active = null;
    }
  }

  async function togglePause() {
    const control = active?.control;
    if (!control) return null;
    const snap = control.snapshot();
    if (snap.status === 'paused' || snap.pauseRequested) { await control.resume(); return 'running'; }
    await control.pause(); return 'paused';
  }
  function stop(reason = 'stopped by user') { active?.abort.abort(new Error(reason)); }
  function showRest() { view.motion = null; restFrame(); }

  return { device, bundle, generate, togglePause, stop, showRest, scene, forwardFlops: den.forwardFlops, parameterCount: manifest.parameterCount };
}
