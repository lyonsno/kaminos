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
// Pre-generated clips (clips/, from generate-clips.mjs) can play on any skeleton while
// the model downloads. Skeleton conditioning comes from an exported bundle
// (export-demo-bundle.py); prompts are encoded in the browser by Flan-T5.
import { CooperativeUniMateDenoiser, UniMateDutyScheduler, createCooperativeCfgDrift } from './unimate-cooperative.js';
import { dopri5Solve } from './unimate-dopri5.js';
import { decodeUniMateMotion, groundedOffsets } from './unimate-decode.js';
import { requestUniMateDevice } from './unimate-denoiser.js';
import { T5Encoder } from './unimate-t5.js';
import { createWebGpuForegroundService, createWebGpuInferenceControl, createWebGpuInferenceSession }
  from '../../webgpu-inference-kit/src/core.js';

export const UNIMATE_ROUTE_ID = 'unimate.text-to-motion.webgpu-local.v0';

const SCENE_SHADER = /* wgsl */`
struct Cam {
  viewProj: mat4x4f,
  invViewProj: mat4x4f,
  viewport: vec2f,     // pixels
  radius: f32,         // bone radius, world units
  focal: f32,          // projection y scale, 1 / tan(fovy / 2)
  eye: vec3f,
  size: f32,           // body extent, world units
  light: vec3f,        // direction towards the light (world, normalized), for ground shadows
  time: f32,
  focus: vec4f,        // ground point the camera follows (x, z) and the stage-light radius
};
@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<storage, read> joints: array<vec4f>;
@group(0) @binding(2) var<storage, read> bones: array<vec4u>;
@group(0) @binding(3) var<storage, read> palette: array<vec4f>;
@group(1) @binding(0) var shadowTex: texture_2d<f32>;
@group(1) @binding(1) var shadowSampler: sampler;

fn sky(dir: vec3f) -> vec3f {
  let h = clamp(dir.y, 0.0, 1.0);
  return mix(vec3f(0.30, 0.32, 0.36), vec3f(0.10, 0.12, 0.16), pow(h, 0.55));
}

// Box-filtered checker: tiles stay crisp near the camera and settle to grey before they alias.
fn checker(p: vec2f) -> f32 {
  let w = max(abs(dpdx(p)), abs(dpdy(p))) + vec2f(1e-4);
  let i = 2.0 * (abs(fract((p - 0.5 * w) * 0.5) - 0.5) - abs(fract((p + 0.5 * w) * 0.5) - 0.5)) / w;
  return 0.5 - 0.5 * i.x * i.y;
}

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
  // Ground plane y = 0. Derivatives and sampling run for every pixel (uniform control flow);
  // sky pixels are selected afterwards.
  let below = dir.y < -1e-4;
  let t = select(1e4, -a.y / min(dir.y, -1e-4), below);
  let p = (a + t * dir).xz;
  let tiles = checker(p / 0.5);
  let shadow = textureSample(shadowTex, shadowSampler, v.position.xy / cam.viewport).r;
  let d = p - cam.focus.xy;
  let stage = exp(-dot(d, d) / (cam.focus.z * cam.focus.z));
  var ground = mix(vec3f(0.185, 0.195, 0.215), vec3f(0.225, 0.235, 0.255), tiles);
  ground = ground * (0.78 + 0.42 * stage) * (1.0 - 0.7 * shadow);
  let fog = 1.0 - exp(-t * 0.09 / max(cam.size, 0.3));
  var color = select(sky(dir), mix(ground, sky(dir), clamp(fog, 0.0, 1.0)), below);
  color = color * (1.0 - 0.22 * dot(v.ndc, v.ndc) * 0.5);   // vignette
  return vec4f(color, 1.0);
}

// Ground shadows: each bone's segment, projected along the light, drawn as a soft capsule into
// a coverage texture (max blend, so overlaps do not stack). The penumbra widens and fades with
// height, so planted feet print dark and lifted ones blur away.
struct ShOut { @builtin(position) position: vec4f, @location(0) p: vec2f, @location(1) a: vec2f, @location(2) b: vec2f, @location(3) k: vec3f };
fn onGround(q: vec3f) -> vec2f { return q.xz - cam.light.xz * (max(q.y, 0.0) / cam.light.y); }
@vertex fn shadowVertex(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> ShOut {
  let bn = bones[ii];
  let qa = joints[bn.y].xyz;
  let qb = joints[bn.x].xyz;
  let ga = onGround(qa);
  let gb = onGround(qb);
  let h = max(0.0, 0.5 * (qa.y + qb.y));
  let core = cam.radius * 1.6;
  let soft = cam.radius * 2.0 + 0.30 * h;
  let strength = mix(0.9, 0.12, clamp(h / (0.9 * cam.size), 0.0, 1.0));
  let r = core + soft;
  var u = gb - ga;
  let len = length(u);
  u = select(vec2f(1.0, 0.0), u / max(len, 1e-6), len > 1e-6);
  let n = vec2f(-u.y, u.x);
  let c = array(vec2f(-1, -1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(1, 1))[vi];
  let pos = select(ga, gb, c.x > 0.0) + u * c.x * r + n * c.y * r;
  return ShOut(cam.viewProj * vec4f(pos.x, 0.0, pos.y, 1.0), pos, ga, gb, vec3f(core, soft, strength));
}
@fragment fn shadowFragment(v: ShOut) -> @location(0) vec4f {
  let ab = v.b - v.a;
  let s = clamp(dot(v.p - v.a, ab) / max(dot(ab, ab), 1e-12), 0.0, 1.0);
  let dist = length(v.p - (v.a + s * ab));
  return vec4f(v.k.z * (1.0 - smoothstep(v.k.x * 0.3, v.k.x + v.k.y, dist)), 0.0, 0.0, 1.0);
}

fn toScreen(p: vec4f) -> vec2f { return p.xy / p.w * cam.viewport * 0.5; }
fn toClip(s: vec2f, r4: vec4f) -> vec4f { return vec4f(s / (cam.viewport * 0.5) * r4.w, r4.z, r4.w); }
fn pixels(worldRadius: f32, w: f32) -> f32 { return worldRadius * cam.focal * cam.viewport.y * 0.5 / w; }

// Key light from the upper left, in view space, with a soft rim so limbs separate from the ground.
fn shade(base: vec3f, n: vec3f) -> vec3f {
  let l = normalize(vec3f(-0.35, 0.65, 0.68));
  let diffuse = max(dot(n, l), 0.0);
  let spec = pow(max(dot(n, normalize(l + vec3f(0.0, 0.0, 1.0))), 0.0), 36.0);
  let rim = pow(1.0 - clamp(n.z, 0.0, 1.0), 3.0);
  return base * (0.30 + 0.80 * diffuse) + vec3f(0.30) * spec + base * 0.30 * rim;
}

// Bones: camera-facing quads with world-space thickness, shaded as round tubes.
struct BoneOut { @builtin(position) position: vec4f, @location(0) color: vec3f, @location(1) side: f32, @location(2) n: vec2f };
@vertex fn boneVertex(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> BoneOut {
  let b = bones[ii];
  let pa = cam.viewProj * vec4f(joints[b.y].xyz, 1.0);
  let pb = cam.viewProj * vec4f(joints[b.x].xyz, 1.0);
  let sa = toScreen(pa);
  let sb = toScreen(pb);
  var d = sb - sa;
  if (length(d) < 1e-3) { d = vec2f(1.0, 0.0); }
  let n = normalize(vec2f(-d.y, d.x));
  let ra = max(1.2, pixels(cam.radius, pa.w));
  let rb = max(1.2, pixels(cam.radius, pb.w));
  let corner = array(0u, 1u, 2u, 2u, 1u, 3u)[vi];
  let side = select(-1.0, 1.0, corner == 1u || corner == 3u);
  var pos: vec4f;
  if (corner < 2u) { pos = toClip(sa + n * side * ra, pa); } else { pos = toClip(sb + n * side * rb, pb); }
  return BoneOut(pos, palette[b.z].rgb, side, n);
}
@fragment fn boneFragment(v: BoneOut) -> @location(0) vec4f {
  let s = clamp(v.side, -1.0, 1.0);
  return vec4f(shade(v.color, vec3f(normalize(v.n) * s, sqrt(max(0.0, 1.0 - s * s)))), 1.0);
}

// Joints: shaded spheres a little wider than the bones, nudged towards the camera so they win
// depth ties with the bone ends they cover. Alpha-to-coverage smooths their edges.
struct DotOut { @builtin(position) position: vec4f, @location(0) uv: vec2f, @location(1) color: vec3f };
@vertex fn jointVertex(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DotOut {
  let p = cam.viewProj * vec4f(joints[ii].xyz, 1.0);
  let uv = array(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1))[vi];
  let r = max(1.8, pixels(cam.radius * 1.35, p.w));
  var c = toClip(toScreen(p) + uv * r, p);
  c.z = c.z - 2e-4 * c.w;
  return DotOut(c, uv, palette[u32(joints[ii].w)].rgb);
}
@fragment fn jointFragment(v: DotOut) -> @location(0) vec4f {
  let r2 = dot(v.uv, v.uv);
  let edge = clamp((1.0 - r2) / max(fwidth(r2), 1e-4), 0.0, 1.0);
  let n = vec3f(v.uv, sqrt(max(0.0, 1.0 - r2)));
  return vec4f(shade(mix(v.color, vec3f(1.0), 0.12), n), edge);
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

// Fetch with byte progress (content-length when the server sends it).
async function fetchBytes(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || null;
  if (!res.body || !onBytes) return res.arrayBuffer();
  const reader = res.body.getReader(), chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); loaded += value.byteLength;
    onBytes(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out.buffer;
}

// The largest extent of any frame's pose, so a body that rears up still fits the camera.
function motionSize(p, frames, J) {
  let size = 0.3;
  for (let t = 0; t < frames; t++) for (let a = 0; a < 3; a++) {
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < J; j++) { const v = p[(t * J + j) * 3 + a]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    size = Math.max(size, hi - lo);
  }
  return size;
}

// A clip file (generate-clips.mjs): a finished animation for one skeleton.
export function decodeClip(clip) {
  const bin = atob(clip.positions);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { ...clip, positions: new Float32Array(bytes.buffer) };
}

// The scene: ground, sky and one skeleton, drawn through the kit foreground service.
// The skeleton can be swapped (a clip of another animal, or the generation skeleton).
// Drag to orbit, wheel or pinch to zoom; the camera drifts slowly when left alone.
async function createSkeletonScene({ device, canvas, foreground }) {
  const surface = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  surface.configure({ device, format, alphaMode: 'opaque' });
  const camBuf = device.createBuffer({ size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const paletteBuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.STORAGE, mappedAtCreation: true });
  new Float32Array(paletteBuf.getMappedRange()).set([0.95, 0.74, 0.28, 1, 0.30, 0.83, 0.95, 1, 0.42, 0.88, 0.45, 1]);
  paletteBuf.unmap();
  const module = device.createShaderModule({ code: SCENE_SHADER });
  const layout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ...[1, 2, 3].map(binding => ({ binding, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } })),
  ] });
  const groundLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
  ] });
  // The main pass is 4x multisampled with depth; ground shadows go first into a half-size
  // coverage texture that the ground samples.
  const SAMPLES = 4, DEPTH = 'depth24plus', SHADOW = 'r8unorm';
  const pipe = (vs, fs, { layouts = [layout], target = { format }, depth = { depthWriteEnabled: true, depthCompare: 'less' }, samples = SAMPLES, coverage = false } = {}) =>
    device.createRenderPipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: layouts }), vertex: { module, entryPoint: vs },
      fragment: { module, entryPoint: fs, targets: [target] }, primitive: { topology: 'triangle-list' },
      depthStencil: depth ? { format: DEPTH, ...depth } : undefined, multisample: { count: samples, alphaToCoverageEnabled: coverage } });
  const [bgPipe, shadowPipe, bonePipe, jointPipe] = await Promise.all([
    pipe('bgVertex', 'bgFragment', { layouts: [layout, groundLayout], depth: { depthWriteEnabled: false, depthCompare: 'always' } }),
    pipe('shadowVertex', 'shadowFragment', { target: { format: SHADOW, blend: { color: { operation: 'max', srcFactor: 'one', dstFactor: 'one' },
      alpha: { operation: 'max', srcFactor: 'one', dstFactor: 'one' } } }, depth: null, samples: 1 }),
    pipe('boneVertex', 'boneFragment'),
    pipe('jointVertex', 'jointFragment', { coverage: true }),
  ]);
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  let targets = null;
  function ensureTargets() {
    const w = Math.max(1, canvas.width), h = Math.max(1, canvas.height);
    if (targets?.w === w && targets?.h === h) return targets;
    if (targets) for (const t of [targets.color, targets.depth, targets.shadow]) t.destroy();
    const tex = (size, fmt, samples, extra = 0) => device.createTexture({ size, format: fmt, sampleCount: samples, usage: GPUTextureUsage.RENDER_ATTACHMENT | extra });
    const shadow = tex([Math.ceil(w / 2), Math.ceil(h / 2)], SHADOW, 1, GPUTextureUsage.TEXTURE_BINDING);
    targets = { w, h, color: tex([w, h], format, SAMPLES), depth: tex([w, h], DEPTH, SAMPLES), shadow,
      groundBind: device.createBindGroup({ layout: groundLayout, entries: [{ binding: 0, resource: shadow.createView() }, { binding: 1, resource: sampler }] }) };
    return targets;
  }

  let sk = null;          // { J, limbs, boneCount, jointBuf, boneBuf, bind, jointFrame, restFrame, size }
  const view = { motion: null, fps: 30, startedAt: performance.now(), target: [0, 0.25, 0], playing: true, pausedFrame: 0 };
  const orbit = { yaw: 0, pitch: 0.38, zoom: 1, lastInteraction: -1e9, drag: null, pointers: new Map(), pinch: null };

  // size: the body's extent for camera distance (default: the rest pose's).
  function setSkeleton({ parents, jointNames, rest, size = null }) {
    if (sk) { sk.jointBuf.destroy(); sk.boneBuf.destroy(); }
    const J = parents.length, limbs = limbClasses(jointNames, parents);
    const boneList = parents.map((p, j) => (p < 0 ? null : [j, p, limbs[j], 0])).filter(Boolean);
    const jointBuf = device.createBuffer({ size: J * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const boneBuf = device.createBuffer({ size: Math.max(16, boneList.length * 16), usage: GPUBufferUsage.STORAGE, mappedAtCreation: true });
    new Uint32Array(boneBuf.getMappedRange()).set(boneList.flat());
    boneBuf.unmap();
    const bind = device.createBindGroup({ layout, entries: [camBuf, jointBuf, boneBuf, paletteBuf].map((buffer, binding) => ({ binding, resource: { buffer } })) });
    const minY = Math.min(...rest.map(p => p[1]));
    const restFrame = new Float32Array(J * 4);
    rest.forEach((p, j) => restFrame.set([p[0], p[1] - minY, p[2], limbs[j]], j * 4));
    // Camera distance follows the body's size (rest-pose extent).
    const ext = [0, 1, 2].map(a => Math.max(...rest.map(p => p[a])) - Math.min(...rest.map(p => p[a])));
    sk = { J, limbs, boneCount: boneList.length, jointBuf, bind, boneBuf, restFrame, jointFrame: restFrame.slice(), size: size ?? Math.max(0.3, ...ext) };
    view.target = [restFrame[0], 0.35 * sk.size, restFrame[2]];
  }
  function showMotion(motion, fps = 30) { view.motion = motion; view.fps = fps; view.startedAt = performance.now(); view.playing = true; }
  function showRest() { view.motion = null; if (sk) sk.jointFrame.set(sk.restFrame); }
  function frameIndex(time) {
    const T = view.motion.frames;
    if (!view.playing) return view.pausedFrame;
    return ((Math.floor((Math.max(0, time - view.startedAt) / 1000) * view.fps) % T) + T) % T;
  }
  function setPlaying(on) {
    if (!view.motion || on === view.playing) return;
    if (!on) { view.pausedFrame = frameIndex(performance.now()); view.playing = false; }
    else { view.startedAt = performance.now() - view.pausedFrame / view.fps * 1000; view.playing = true; }
  }
  function seek(f) { if (view.motion) { view.pausedFrame = Math.max(0, Math.min(view.motion.frames - 1, f)); view.playing = false; } }

  // Pointer orbit and zoom.
  canvas.style.touchAction = 'none';
  const touch = () => { orbit.lastInteraction = performance.now(); };
  canvas.addEventListener('pointerdown', e => { orbit.pointers.set(e.pointerId, [e.clientX, e.clientY]); canvas.setPointerCapture(e.pointerId); touch(); });
  canvas.addEventListener('pointermove', e => {
    const prev = orbit.pointers.get(e.pointerId);
    if (!prev) return;
    orbit.pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (orbit.pointers.size === 1) {
      orbit.yaw -= (e.clientX - prev[0]) * 0.006;
      orbit.pitch = Math.min(1.35, Math.max(0.03, orbit.pitch + (e.clientY - prev[1]) * 0.005));
    } else if (orbit.pointers.size === 2) {
      const [a, b] = [...orbit.pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (orbit.pinch) orbit.zoom = Math.min(4, Math.max(0.3, orbit.zoom * orbit.pinch / d));
      orbit.pinch = d;
    }
    touch();
  });
  const release = e => { orbit.pointers.delete(e.pointerId); orbit.pinch = null; touch(); };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', e => { e.preventDefault(); orbit.zoom = Math.min(4, Math.max(0.3, orbit.zoom * Math.exp(e.deltaY * 0.0012))); touch(); }, { passive: false });

  const state = { frames: 0, lastFrameAt: null, gaps: null, running: true, frameIndex: -1, lastTime: null };
  let frameSeq = 0;
  const draw = time => {
    const dt = state.lastTime === null ? 0 : Math.min(0.1, (time - state.lastTime) / 1000);
    state.lastTime = time;
    // Slow drift when the visitor has not touched the camera for a few seconds.
    if (time - orbit.lastInteraction > 4000) orbit.yaw += dt * 0.25;
    const enc = device.createCommandEncoder();
    const tg = ensureTargets();
    const shadowPass = enc.beginRenderPass({ colorAttachments: [{ view: tg.shadow.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    const pass = () => enc.beginRenderPass({
      colorAttachments: [{ view: tg.color.createView(), resolveTarget: surface.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'discard', clearValue: [0.1, 0.11, 0.13, 1] }],
      depthStencilAttachment: { view: tg.depth.createView(), depthLoadOp: 'clear', depthClearValue: 1, depthStoreOp: 'discard' } });
    if (!sk) { shadowPass.end(); pass().end(); return enc.finish(); }
    const { J, jointFrame, limbs } = sk;
    if (view.motion) {
      const f = frameIndex(time), p = view.motion.positions;
      state.frameIndex = f;
      for (let j = 0; j < J; j++) jointFrame.set([p[(f * J + j) * 3], p[(f * J + j) * 3 + 1], p[(f * J + j) * 3 + 2], limbs[j]], j * 4);
    }
    // Follow the root over the ground exactly (the ground slides under fast runs) and its height
    // smoothly (up when it rears). A non-finite root must never enter the target.
    const root = [jointFrame[0], Math.max(0.35 * sk.size, 0.6 * jointFrame[1]), jointFrame[2]];
    if (root.every(Number.isFinite)) view.target = [root[0], view.target[1] + (root[1] - view.target[1]) * 0.08, root[2]];
    // Narrow (portrait) screens step back so the body fits across.
    const aspect = canvas.width / canvas.height;
    const ang = orbit.yaw, dist = Math.max(0.8, 2.4 * sk.size) * Math.max(1, 0.9 / aspect) * orbit.zoom, el = orbit.pitch;
    // Aim a little to the subject's left so it sits right of centre, clear of the panel on wide screens.
    const off = canvas.width > canvas.height ? 0.13 * dist : 0;
    // On portrait screens the panel covers the top, so aim above the body to sit it lower.
    const lift = aspect < 1 ? 0.12 * dist : 0;
    const aim = [view.target[0] - off * Math.cos(ang), view.target[1] + lift, view.target[2] + off * Math.sin(ang)];
    const eye = [aim[0] + dist * Math.cos(el) * Math.sin(ang), aim[1] + dist * Math.sin(el), aim[2] + dist * Math.cos(el) * Math.cos(ang)];
    const fovy = 0.8, vp = mul(perspective(fovy, aspect, 0.05, 200), lookAt(eye, aim, [0, 1, 0]));
    const light = [0.25, 1, 0.15], ll = Math.hypot(...light);
    const cam = new Float32Array(48);
    cam.set(vp, 0); cam.set(invert(vp), 16);
    cam.set([canvas.width, canvas.height, 0.011 * sk.size, 1 / Math.tan(fovy / 2)], 32);
    cam.set([...eye, sk.size], 36);
    cam.set([...light.map(x => x / ll), time / 1000], 40);
    cam.set([view.target[0], view.target[2], 1.8 * sk.size, 0], 44);
    device.queue.writeBuffer(camBuf, 0, cam);
    device.queue.writeBuffer(sk.jointBuf, 0, jointFrame);
    shadowPass.setBindGroup(0, sk.bind);
    shadowPass.setPipeline(shadowPipe); shadowPass.draw(6, sk.boneCount);
    shadowPass.end();
    const main = pass();
    main.setBindGroup(0, sk.bind);
    main.setBindGroup(1, tg.groundBind);
    main.setPipeline(bgPipe); main.draw(3);
    main.setPipeline(bonePipe); main.draw(6, sk.boneCount);
    main.setPipeline(jointPipe); main.draw(6, J);
    main.end();
    return enc.finish();
  };
  const requestFrame = time => {
    if (!state.running) return;
    const handle = foreground.request({ requestId: `scene:${++frameSeq}`, run(opportunity) { opportunity.submit([draw(time)]); } });
    handle.completion.then(receipt => {
      const now = performance.now();
      if (receipt.status === 'completed') {
        state.frames++;
        if (state.gaps && state.lastFrameAt !== null) state.gaps.push(now - state.lastFrameAt);
        state.lastFrameAt = now;
      }
      requestAnimationFrame(requestFrame);
    });
  };
  requestAnimationFrame(requestFrame);
  return { state, view, setSkeleton, showMotion, showRest, setPlaying, seek, get frameIndex() { return state.frameIndex; } };
}

// createUniMateDemo starts the device and the scene and returns at once, so clips can
// play while the model downloads; loadModel() then fetches the skeleton bundle, the
// weights and the text encoder.
export async function createUniMateDemo({ canvas, weightsBase = '/weights/', bundleBase = '/demo/', t5Base = '/t5/' }) {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU is not available in this browser');
  const device = await requestUniMateDevice(adapter);
  const session = await createWebGpuInferenceSession({ sessionId: `unimate:${crypto.randomUUID()}`, device, adapterName: 'browser-primary-adapter' });
  const foreground = createWebGpuForegroundService({ routeId: UNIMATE_ROUTE_ID, device });
  const scene = await createSkeletonScene({ device, canvas, foreground });

  const demo = { device, scene: scene.state, bundle: null, parameterCount: null, forwardFlops: null,
    hasTextEncoder: () => false, showClip, showGenerationSkeleton, showRest: () => scene.showRest(),
    setPlaying: on => scene.setPlaying(on), seek: f => scene.seek(f), view: scene.view, loadModel };
  let generationSkeleton = null;

  function showClip(clip) {
    const { skeleton } = clip, J = skeleton.parents.length;
    const p = clip.positions;
    scene.setSkeleton({ parents: skeleton.parents, jointNames: skeleton.jointNames, size: motionSize(p, clip.frames, J),
      rest: Array.from({ length: J }, (_, j) => [p[j * 3], p[j * 3 + 1], p[j * 3 + 2]]) });
    scene.showMotion({ frames: clip.frames, positions: p }, clip.fps ?? 30);
    generationSkeletonShown = false;
  }
  let generationSkeletonShown = false;
  function showGenerationSkeleton() {
    if (!generationSkeleton || generationSkeletonShown) return;
    scene.setSkeleton(generationSkeleton);
    scene.showRest();
    generationSkeletonShown = true;
  }

  async function loadModel({ onStatus = () => {}, onBytes = () => {} } = {}) {
    onStatus({ phase: 'load', detail: 'skeleton and prompts' });
    const bundle = await (await fetch(`${bundleBase}demo.json`)).json();
    const arrays = bundleArrays(bundle, await fetchBytes(`${bundleBase}demo.bin`));
    const { joints: J, parents, jointNames, fps } = bundle.skeleton;
    const T = bundle.skeleton.frames, Fe = 12;
    const rest = Array.from({ length: J }, (_, j) => Array.from(arrays.restPositions.subarray(j * 3, j * 3 + 3)));
    const offsets = groundedOffsets(rest, parents);
    generationSkeleton = { parents, jointNames, rest };
    demo.bundle = bundle;

    // Downloads: weights and text encoder, reported together.
    const manifest = await (await fetch(`${weightsBase}manifest.json`)).json();
    let t5Manifest = null;
    try { t5Manifest = await (await fetch(`${t5Base}t5-manifest.json`)).json(); } catch (e) { console.warn('text encoder unavailable; captured prompts only', e); }
    const progress = { weights: [0, null], t5: [0, null] };
    const report = () => {
      const loaded = progress.weights[0] + progress.t5[0];
      const known = progress.weights[1] !== null && (!t5Manifest || progress.t5[1] !== null);
      onBytes(loaded, known ? progress.weights[1] + (t5Manifest ? progress.t5[1] : 0) : null);
    };
    onStatus({ phase: 'load', detail: 'model weights' });
    const [weightBytes, t5Bytes] = await Promise.all([
      fetchBytes(`${weightsBase}${manifest.file}`, (l, t) => { progress.weights = [l, t]; report(); }),
      t5Manifest ? fetchBytes(`${t5Base}${t5Manifest.file}`, (l, t) => { progress.t5 = [l, t]; report(); }).catch(e => { console.warn('text encoder download failed', e); return null; }) : null,
    ]);
    onStatus({ phase: 'load', detail: 'GPU pipelines' });
    const den = await CooperativeUniMateDenoiser.create(device, manifest, weightBytes);
    den.configure({ B: 2, J });
    const scheduler = new UniMateDutyScheduler(device, { label: 'unimate' });
    let t5 = null;
    if (t5Bytes) {
      try { t5 = await T5Encoder.create(device, t5Manifest, t5Bytes, await (await fetch(`${t5Base}t5-tokenizer.json`)).json()); }
      catch (e) { console.warn('text encoder unavailable; captured prompts only', e); }
    }
    const zeros = new Float32Array(768);
    const conditioningFor = caption => {
      const two = a => { const o = new a.constructor(a.length * 2); o.set(a, 0); o.set(a, a.length); return o; };
      const cap = new Float32Array(2 * 768); cap.set(caption, 0); cap.set(zeros, 768);
      return { tpos: two(arrays.tpos), tposParents: two(arrays.tposParents), depths: two(arrays.depths), jointNamesEmb: two(arrays.jointNamesEmb),
        spectral: two(arrays.spectral), graphDist: two(arrays.graphDist), jointRelations: two(arrays.jointRelations), caption: cap,
        motionLength: [bundle.motionLength, bundle.motionLength] };
    };

    let active = null;
    async function solve({ caption, noise, schedule, onEvaluation, onStep }) {
      scheduler.setSchedule(schedule);
      den.writeConditioning(conditioningFor(caption));
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

    // text: any prompt (browser T5), or promptIndex: a captured bundle prompt. seed null replays
    // the accepted run's noise, which exists only for captured prompts.
    async function generate({ text = null, promptIndex = null, seed = null, cooperative = true, targetDutyMs = 12, maxInFlight = 1,
      onEvaluation, onStep } = {}) {
      if (text === null) text = bundle.prompts[promptIndex ?? 0].text;
      const match = bundle.prompts.findIndex(p => p.text === text);
      if (seed === null && match < 0) throw new Error('the accepted run\'s noise exists only for captured prompts; choose a browser seed');
      if (!t5 && match < 0) throw new Error('no text encoder loaded: choose one of the captured prompts');
      if (active) throw new Error('a generation is already running');
      const encodeStart = performance.now();
      const caption = t5 ? (await t5.encode(text)).pooled : arrays[bundle.prompts[match].caption];
      const encodeMs = performance.now() - encodeStart;
      const prompt = match >= 0 ? bundle.prompts[match] : { text };
      const noise = seed === null ? Float32Array.from(arrays[prompt.referenceNoise]) : gaussianNoise(seed, J * Fe * T);
      const runId = `unimate:${crypto.randomUUID()}`;
      const abort = new AbortController();
      active = { abort, control: null };
      scene.state.gaps = []; scene.state.lastFrameAt = null;
      scheduler.stats.history.length = 0;
      const started = performance.now();
      let frameRun = null, route = null, result;
      try {
        if (cooperative) {
          frameRun = await foreground.beginRun(runId);
          route = await session.registerRoute({ routeId: UNIMATE_ROUTE_ID, runtimeOptions: { runtimeLabel: 'unimate', foregroundOpportunities: frameRun.foregroundOpportunities } });
          const control = createWebGpuInferenceControl({ queue: device.queue, signal: abort.signal, withForeground: frameRun.withForeground });
          active.control = control;
          const job = route.enqueue({ jobId: runId, execute: invocation => solve({ caption, noise, onEvaluation, onStep,
            schedule: { runtime: route.runtime, invocation, control, signal: abort.signal, targetDutyMs, maxInFlight } }) });
          const completion = await job.completion;
          if (completion.status !== 'succeeded') {
            const error = new Error(completion.failure?.message ?? completion.status);
            error.name = completion.failure?.name ?? 'Error';
            throw error;
          }
          result = completion.output;
        } else {
          result = await solve({ caption, noise, schedule: null, onEvaluation, onStep });
        }
        result.prompt = text;
        result.seed = seed;
        result.textEncoder = t5 ? 'browser T5' : 'captured embedding';
        result.encodeMs = encodeMs;
        result.noise = seed === null ? 'reference (accepted CPU run)' : `browser seed ${seed}`;
        result.wallMs = performance.now() - started;
        result.cooperative = cooperative;
        result.frameStats = frameStats(scene.state.gaps);
        result.dutyCount = result.duties.length;
        result.longestDutyMs = Math.max(0, ...result.duties.map(d => d.queueMs ?? 0));
        const ref = prompt.referencePositions && seed === null ? arrays[prompt.referencePositions] : null;
        if (ref) {
          let maxDev = 0;
          const p = result.motion.positions;
          for (let i = 0; i < T * J; i++) maxDev = Math.max(maxDev, Math.hypot(p[i * 3] - ref[i * 3], p[i * 3 + 1] - ref[i * 3 + 1], p[i * 3 + 2] - ref[i * 3 + 2]));
          result.referenceMaxJointDeviation = maxDev;
        }
        scene.setSkeleton({ ...generationSkeleton, size: motionSize(result.motion.positions, result.motion.frames, J) });
        generationSkeletonShown = true;
        scene.showMotion(result.motion, fps);
        return result;
      } finally {
        try { await active.control?.close(); } catch { /* reported by the control */ }
        if (route) { await route.drain(); session.unregisterRoute(route.routeId); }
        if (frameRun) await frameRun.finish();
        scene.state.gaps = null;
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

    Object.assign(demo, { generate, togglePause, stop, hasTextEncoder: () => Boolean(t5), forwardFlops: den.forwardFlops, parameterCount: manifest.parameterCount,
      skeletonName: bundle.skeleton.name, fps });
    onStatus({ phase: 'ready', detail: `${manifest.parameterCount.toLocaleString()} parameters${t5 ? ' · type any prompt' : ''}` });
    return demo;
  }

  return demo;
}
