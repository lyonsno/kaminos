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
import { requestUniMateDevice } from './unimate-denoiser.js';
import { skinMatrices } from './unimate-rig-mesh.js';
import { createUniMateGenerator, UNIMATE_ROUTE_ID } from './unimate-generator.js';
import { createWebGpuForegroundService, createWebGpuInferenceSession } from '../../webgpu-inference-kit/src/core.js';

export { UNIMATE_ROUTE_ID };

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

// A visitor's skinned mesh: linear blend skinning with up to 8 influences per vertex, lit like
// the skeleton (key light from the upper left, soft fill), base colour times its texture.
const MESH_SHADER = /* wgsl */`
struct Cam {
  viewProj: mat4x4f, invViewProj: mat4x4f, viewport: vec2f, radius: f32, focal: f32,
  eye: vec3f, size: f32, light: vec3f, time: f32, focus: vec4f,
};
struct Material { color: vec4f };
@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<storage, read> skin: array<mat4x4f>;
@group(1) @binding(0) var<uniform> material: Material;
@group(1) @binding(1) var tex: texture_2d<f32>;
@group(1) @binding(2) var texSampler: sampler;

struct In {
  @location(0) position: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f,
  @location(3) j0: vec4u, @location(4) j1: vec4u, @location(5) w0: vec4f, @location(6) w1: vec4f,
};
struct Out { @builtin(position) position: vec4f, @location(0) world: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f };
@vertex fn meshVertex(v: In) -> Out {
  var m = skin[v.j0.x] * v.w0.x + skin[v.j0.y] * v.w0.y + skin[v.j0.z] * v.w0.z + skin[v.j0.w] * v.w0.w
        + skin[v.j1.x] * v.w1.x + skin[v.j1.y] * v.w1.y + skin[v.j1.z] * v.w1.z + skin[v.j1.w] * v.w1.w;
  let world = (m * vec4f(v.position, 1.0)).xyz;
  let normal = (m * vec4f(v.normal, 0.0)).xyz;
  return Out(cam.viewProj * vec4f(world, 1.0), world, normal, v.uv);
}
@fragment fn meshFragment(v: Out, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  var n = normalize(v.normal);
  let toEye = normalize(cam.eye - v.world);
  if (dot(n, toEye) < 0.0) { n = -n; }
  let key = normalize(vec3f(-0.45, 0.85, 0.4));
  let base = material.color.rgb * textureSample(tex, texSampler, v.uv).rgb;
  let diffuse = max(dot(n, key), 0.0);
  let fill = 0.5 + 0.5 * n.y;
  let rim = pow(1.0 - max(dot(n, toEye), 0.0), 3.0);
  let spec = pow(max(dot(n, normalize(key + toEye)), 0.0), 40.0);
  return vec4f(base * (0.22 + 0.68 * diffuse + 0.18 * fill) + vec3f(0.12) * spec + base * 0.18 * rim, 1.0);
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

  // Skinned mesh (an imported rig's): pipeline, buffers, per-frame skinning matrices.
  const meshModule = device.createShaderModule({ code: MESH_SHADER });
  const meshLayout0 = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
  ] });
  const meshLayout1 = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
  ] });
  const meshPipe = await device.createRenderPipelineAsync({
    layout: device.createPipelineLayout({ bindGroupLayouts: [meshLayout0, meshLayout1] }),
    vertex: { module: meshModule, entryPoint: 'meshVertex', buffers: [
      { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
      { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
      { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] },
      { arrayStride: 32, attributes: [{ shaderLocation: 3, offset: 0, format: 'uint32x4' }, { shaderLocation: 4, offset: 16, format: 'uint32x4' }] },
      { arrayStride: 32, attributes: [{ shaderLocation: 5, offset: 0, format: 'float32x4' }, { shaderLocation: 6, offset: 16, format: 'float32x4' }] },
    ] },
    fragment: { module: meshModule, entryPoint: 'meshFragment', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less' }, multisample: { count: SAMPLES },
  });
  const meshSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' });
  const whiteTexture = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: whiteTexture }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
  let mesh = null;        // { buffers, index, groups, joints, skinBuf, bind0, identity }
  const showBones = { on: true };

  async function setMesh(data, jointCount) {
    clearMesh();
    if (!data) return;
    const buf = (arr, usage) => { const b = device.createBuffer({ size: Math.max(16, Math.ceil(arr.byteLength / 4) * 4), usage: usage | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, arr); return b; };
    const V = GPUBufferUsage.VERTEX;
    const buffers = [buf(data.positions, V), buf(data.normals, V), buf(data.uvs, V), buf(data.joints, V), buf(data.weights, V)];
    const index = buf(data.indices, GPUBufferUsage.INDEX);
    const skinBuf = device.createBuffer({ size: jointCount * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const identity = new Float32Array(jointCount * 16);
    for (let j = 0; j < jointCount; j++) identity.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], j * 16);
    const textures = [];
    const groups = [];
    for (const g of data.groups) {
      const m = data.materials[g.material] ?? { baseColor: [1, 1, 1, 1] };
      let texture = whiteTexture;
      if (m.image) {
        try {
          const bitmap = await createImageBitmap(new Blob([m.image.bytes], { type: m.image.mimeType }), { colorSpaceConversion: 'none' });
          texture = device.createTexture({ size: [bitmap.width, bitmap.height], format: 'rgba8unorm-srgb',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
          device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]);
          textures.push(texture);
        } catch (e) { console.warn('mesh texture unreadable', e); }
      }
      const colorBuf = buf(Float32Array.from(m.baseColor.slice(0, 4)), GPUBufferUsage.UNIFORM);
      groups.push({ first: g.first, count: g.count, colorBuf, bind: device.createBindGroup({ layout: meshLayout1, entries: [
        { binding: 0, resource: { buffer: colorBuf } }, { binding: 1, resource: texture.createView() }, { binding: 2, resource: meshSampler }] }) });
    }
    // The mesh's rest extent: the camera frames whichever is larger, skeleton or mesh.
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.positions.length; i += 3) for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], data.positions[i + d]); hi[d] = Math.max(hi[d], data.positions[i + d]); }
    mesh = { buffers, index, groups, textures, skinBuf, identity, jointCount, skin: null, visible: true, extent: Math.max(...hi.map((v, d) => v - lo[d])),
      bind0: device.createBindGroup({ layout: meshLayout0, entries: [{ binding: 0, resource: { buffer: camBuf } }, { binding: 1, resource: { buffer: skinBuf } }] }) };
    showBones.on = false;
  }
  // The mesh belongs to one skeleton: hidden while another skeleton's clip plays.
  function setMeshVisible(on) { if (!mesh) return; mesh.visible = on; showBones.on = !on || showBones.forced; }
  function clearMesh() {
    if (!mesh) return;
    for (const b of [...mesh.buffers, mesh.index, mesh.skinBuf, ...mesh.groups.map(g => g.colorBuf)]) b.destroy();
    for (const t of mesh.textures) t.destroy();
    mesh = null;
    showBones.on = true;
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
  // skin: per-frame skinning matrices for the mesh (T x J x 16), or null (the mesh then rests).
  function showMotion(motion, fps = 30, skin = null) { view.motion = motion; view.fps = fps; view.startedAt = performance.now(); view.playing = true; if (mesh) mesh.skin = skin; }
  function showRest() { view.motion = null; if (sk) sk.jointFrame.set(sk.restFrame); if (mesh) mesh.skin = null; }
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
    const size = mesh?.visible ? Math.max(sk.size, mesh.extent) : sk.size;
    const ang = orbit.yaw, dist = Math.max(0.8, 2.4 * size) * Math.max(1, 0.9 / aspect) * orbit.zoom, el = orbit.pitch;
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
    if (mesh?.visible) {
      const f = state.frameIndex, frame = view.motion && mesh.skin && f >= 0 ? mesh.skin.subarray(f * mesh.jointCount * 16, (f + 1) * mesh.jointCount * 16) : mesh.identity;
      device.queue.writeBuffer(mesh.skinBuf, 0, frame);
      main.setPipeline(meshPipe);
      main.setBindGroup(0, mesh.bind0);
      mesh.buffers.forEach((b, i) => main.setVertexBuffer(i, b));
      main.setIndexBuffer(mesh.index, 'uint32');
      for (const g of mesh.groups) { main.setBindGroup(1, g.bind); main.drawIndexed(g.count, 1, g.first); }
      main.setBindGroup(0, sk.bind);
      main.setBindGroup(1, tg.groundBind);
    }
    if (showBones.on) {
      main.setPipeline(bonePipe); main.draw(6, sk.boneCount);
      main.setPipeline(jointPipe); main.draw(6, J);
    }
    main.end();
    return enc.finish();
  };
  const requestFrame = time => {
    if (!state.running) return;
    const handle = foreground.request({ requestId: `scene:${++frameSeq}`, run(opportunity) { const receipt = opportunity.submit([draw(time)]); state.submissions?.push(receipt.submittedAtMs); } });
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
  return { state, view, setSkeleton, showMotion, showRest, setPlaying, seek, setMesh, clearMesh, setMeshVisible, showBones, get hasMesh() { return Boolean(mesh); }, get frameIndex() { return state.frameIndex; } };
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

  const demo = { device, session, foreground, scene: scene.state, bundle: null, parameterCount: null, forwardFlops: null,
    hasTextEncoder: () => false, showClip, showGenerationSkeleton, setGenerationMesh, showBones: on => { scene.showBones.forced = on; scene.showBones.on = on || !scene.hasMesh; }, showRest: () => scene.showRest(),
    setPlaying: on => scene.setPlaying(on), seek: f => scene.seek(f), view: scene.view, loadModel };
  let generationSkeleton = null;

  function showClip(clip) {
    const { skeleton } = clip, J = skeleton.parents.length;
    const p = clip.positions;
    scene.setSkeleton({ parents: skeleton.parents, jointNames: skeleton.jointNames, size: motionSize(p, clip.frames, J),
      rest: Array.from({ length: J }, (_, j) => [p[j * 3], p[j * 3 + 1], p[j * 3 + 2]]) });
    scene.setMeshVisible(false);
    scene.showMotion({ frames: clip.frames, positions: p }, clip.fps ?? 30);
    generationSkeletonShown = false;
    // A clip of the generation skeleton (one generated here) shows its mesh too.
    if (clip.mesh && generationMesh) { scene.setMeshVisible(true); scene.showMotion({ frames: clip.frames, positions: p }, clip.fps ?? 30, clip.mesh); }
  }
  let generationSkeletonShown = false;
  function showGenerationSkeleton() {
    if (!generationSkeleton || generationSkeletonShown) return;
    scene.setSkeleton(generationSkeleton);
    scene.showRest();
    scene.setMeshVisible(Boolean(generationMesh));
    generationSkeletonShown = true;
  }
  // The skinned mesh of the generation skeleton (an imported rig's), or null.
  let generationMesh = null;
  async function setGenerationMesh(data) {
    generationMesh = data ?? null;
    demo.generationMeshData = generationMesh;
    await scene.setMesh(data, generationSkeleton?.parents.length ?? 0);
    scene.setMeshVisible(Boolean(data) && generationSkeletonShown);
  }

  // The model and its generation skeleton (unimate-generator.js), on this page's device and session,
  // generating as a kit route beside the scene's foreground frames.
  async function loadModel({ onStatus = () => {}, onBytes = () => {} } = {}) {
    const gen = await createUniMateGenerator({ device, session, beginRun: (id, options) => foreground.beginRun(id, options), weightsBase, t5Base, bundleBase, onStatus, onBytes });
    const sync = () => {
      const { parents, jointNames, rest, name, fps } = gen.skeleton;
      generationSkeleton = { parents, jointNames, rest };
      Object.assign(demo, { bundle: gen.bundle, arrays: gen.arrays, skeletonName: name, fps });
    };
    sync();
    // A generation, then the scene shows it: frame gaps during the run, the skeleton, the mesh skinned.
    async function generate(options) {
      scene.state.gaps = []; scene.state.lastFrameAt = null;
      try {
        const result = await gen.generate(options);
        result.frameStats = frameStats(scene.state.gaps);
        const { parents, rest, fps } = gen.skeleton;
        scene.setSkeleton({ ...generationSkeleton, size: motionSize(result.motion.positions, result.motion.frames, parents.length) });
        generationSkeletonShown = true;
        result.skin = generationMesh ? skinMatrices(result.motion, parents, rest) : null;
        scene.setMeshVisible(Boolean(generationMesh));
        scene.showMotion(result.motion, fps, result.skin);
        return result;
      } finally { scene.state.gaps = null; }
    }
    async function useSkeleton(base) {
      if (gen.running) throw new Error('a generation is running');
      await setGenerationMesh(null);
      await gen.useSkeleton(base);
      sync(); generationSkeletonShown = false;
      return gen.bundle;
    }
    async function useSkeletonData(data) {
      await gen.useSkeletonData(data);
      sync(); generationSkeletonShown = false;
      return gen.bundle;
    }
    Object.assign(demo, { generator: gen, generate, togglePause: gen.togglePause, stop: gen.stop, useSkeleton, useSkeletonData, encodeText: gen.encodeText,
      hasTextEncoder: gen.hasTextEncoder, forwardFlops: gen.forwardFlops, parameterCount: gen.parameterCount });
    return demo;
  }
  return demo;
}
