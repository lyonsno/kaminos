const ROUTE_IDENTITY = 'native-3d-compute-fluid-raymarch-v0';
const PROTOTYPE_IDENTITY = 'kaminos-volume-prototype-v0';
const DEFAULT_GRID_SIZE = 96;
const SUPPORTED_GRID_SIZES = [32, 48, 64, 96, 128, 160];
const FLUID_SLOTS_PER_CELL = 4;
const FLUID_COMPONENTS = FLUID_SLOTS_PER_CELL * 4;
const DEFAULT_MAJORANT_GRID_SIZE = 48;
const SUPPORTED_MAJORANT_GRID_SIZES = [24, 32, 48];

function normalizeGridSize(value) {
  const requested = Number(value);
  if (SUPPORTED_GRID_SIZES.includes(requested)) return requested;
  return DEFAULT_GRID_SIZE;
}

function normalizeMajorantGridSize(value) {
  const requested = Number(value);
  if (SUPPORTED_MAJORANT_GRID_SIZES.includes(requested)) return requested;
  return DEFAULT_MAJORANT_GRID_SIZE;
}

function gridCellCount(gridSize) {
  return gridSize * gridSize * gridSize;
}

function fluidBufferBytes(gridSize) {
  return gridCellCount(gridSize) * FLUID_COMPONENTS * Float32Array.BYTES_PER_ELEMENT;
}

function majorantBufferBytes(majorantGridSize = DEFAULT_MAJORANT_GRID_SIZE) {
  return majorantGridSize * majorantGridSize * majorantGridSize * 4 * Float32Array.BYTES_PER_ELEMENT;
}

const WGSL = /* wgsl */`
override GRID: u32 = 64u;
override MAJORANT_GRID: u32 = 24u;
const SLOTS_PER_CELL: u32 = 4u;

struct Uniforms {
  invViewProj: mat4x4<f32>,
  cameraPos_time: vec4<f32>,
  viewport_steps_density: vec4<f32>,
  fire_smoke_curl_speed: vec4<f32>,
  grid_overlay_debug: vec4<f32>,
  source_controls: vec4<f32>,
  radiance_controls: vec4<f32>,
  occupancy_controls: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> fluidSrc: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> fluidDst: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> majorantField: array<vec4<f32>>;
@group(1) @binding(0) var<storage, read_write> majorantDst: array<vec4<f32>>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>( 3.0,  1.0),
    vec2<f32>(-1.0,  1.0)
  );
  var out: VSOut;
  out.pos = vec4<f32>(p[i], 0.0, 1.0);
  out.uv = p[i] * 0.5 + vec2<f32>(0.5);
  return out;
}

fn hash31(p: vec3<f32>) -> f32 {
  let q = fract(p * 0.1031);
  let r = q + dot(q, q.yzx + 33.33);
  return fract((r.x + r.y) * r.z);
}

fn rotate2(p: vec2<f32>, a: f32) -> vec2<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec2<f32>(c * p.x - s * p.y, s * p.x + c * p.y);
}

fn index3(c: vec3<u32>) -> u32 {
  return c.x + c.y * GRID + c.z * GRID * GRID;
}

fn clampCell(c: vec3<i32>) -> vec3<u32> {
  return vec3<u32>(clamp(c, vec3<i32>(0), vec3<i32>(i32(GRID) - 1)));
}

fn slotIndex(c: vec3<i32>, slot: u32) -> u32 {
  return index3(clampCell(c)) * SLOTS_PER_CELL + slot;
}

fn readSlot(c: vec3<i32>, slot: u32) -> vec4<f32> {
  return fluidSrc[slotIndex(c, slot)];
}

fn sampleFluidSlot(p: vec3<f32>, slot: u32) -> vec4<f32> {
  let pc = clamp(p, vec3<f32>(0.0), vec3<f32>(f32(GRID) - 1.001));
  let i0 = vec3<i32>(floor(pc));
  let f = fract(pc);
  let c000 = readSlot(i0 + vec3<i32>(0, 0, 0), slot);
  let c100 = readSlot(i0 + vec3<i32>(1, 0, 0), slot);
  let c010 = readSlot(i0 + vec3<i32>(0, 1, 0), slot);
  let c110 = readSlot(i0 + vec3<i32>(1, 1, 0), slot);
  let c001 = readSlot(i0 + vec3<i32>(0, 0, 1), slot);
  let c101 = readSlot(i0 + vec3<i32>(1, 0, 1), slot);
  let c011 = readSlot(i0 + vec3<i32>(0, 1, 1), slot);
  let c111 = readSlot(i0 + vec3<i32>(1, 1, 1), slot);
  let x00 = mix(c000, c100, f.x);
  let x10 = mix(c010, c110, f.x);
  let x01 = mix(c001, c101, f.x);
  let x11 = mix(c011, c111, f.x);
  let y0 = mix(x00, x10, f.y);
  let y1 = mix(x01, x11, f.y);
  return mix(y0, y1, f.z);
}

fn sampleWorldVelocity(p: vec3<f32>) -> vec4<f32> {
  let cell = (p * 0.5 + vec3<f32>(0.5)) * (f32(GRID) - 1.0);
  return sampleFluidSlot(cell, 0u);
}

fn sampleWorldMaterial(p: vec3<f32>) -> vec4<f32> {
  let cell = (p * 0.5 + vec3<f32>(0.5)) * (f32(GRID) - 1.0);
  return sampleFluidSlot(cell, 1u);
}

fn sampleWorldFireLayer(p: vec3<f32>) -> vec4<f32> {
  let cell = (p * 0.5 + vec3<f32>(0.5)) * (f32(GRID) - 1.0);
  return sampleFluidSlot(cell, 2u);
}

fn sampleWorldMicrodetail(p: vec3<f32>) -> vec4<f32> {
  let cell = (p * 0.5 + vec3<f32>(0.5)) * (f32(GRID) - 1.0);
  return sampleFluidSlot(cell, 3u);
}

fn majorantIndex(c: vec3<u32>) -> u32 {
  return c.x + c.y * MAJORANT_GRID + c.z * MAJORANT_GRID * MAJORANT_GRID;
}

fn materialMajorantFromSlots(velocityDensity: vec4<f32>, material: vec4<f32>, fireLayer: vec4<f32>, microLayer: vec4<f32>) -> vec4<f32> {
  let velMag = length(velocityDensity.xyz);
  let smoke = material.x + microLayer.x * 0.52 + microLayer.y * 0.34;
  let fire = fireLayer.x * 1.25 + fireLayer.y * 0.42 + fireLayer.z * 0.55 + microLayer.z * 0.70 + material.y * 0.28;
  let density = max(velocityDensity.w, smoke * 0.82 + material.y * 0.22 + material.w * 0.18);
  let extinction = smoke * 0.62 + microLayer.y * 0.36 + material.w * 0.16;
  let importance = clamp(density * 0.50 + extinction * 0.40 + fire * 0.44 + velMag * 0.36, 0.0, 3.0);
  return vec4<f32>(density, fire, extinction, importance);
}

fn sampleWorldMajorant(p: vec3<f32>) -> vec4<f32> {
  let q = clamp((p * 0.5 + vec3<f32>(0.5)) * f32(MAJORANT_GRID), vec3<f32>(0.0), vec3<f32>(f32(MAJORANT_GRID) - 0.001));
  return majorantField[majorantIndex(vec3<u32>(floor(q)))];
}

fn sampleMajorantCell(c: vec3<i32>) -> vec4<f32> {
  let cell = vec3<u32>(clamp(c, vec3<i32>(0), vec3<i32>(i32(MAJORANT_GRID) - 1)));
  return majorantField[majorantIndex(cell)];
}

fn sampleWorldMajorantLinear(p: vec3<f32>) -> vec4<f32> {
  let q = clamp((p * 0.5 + vec3<f32>(0.5)) * (f32(MAJORANT_GRID) - 1.0), vec3<f32>(0.0), vec3<f32>(f32(MAJORANT_GRID) - 1.001));
  let i0 = vec3<i32>(floor(q));
  let f = fract(q);
  let c000 = sampleMajorantCell(i0 + vec3<i32>(0, 0, 0));
  let c100 = sampleMajorantCell(i0 + vec3<i32>(1, 0, 0));
  let c010 = sampleMajorantCell(i0 + vec3<i32>(0, 1, 0));
  let c110 = sampleMajorantCell(i0 + vec3<i32>(1, 1, 0));
  let c001 = sampleMajorantCell(i0 + vec3<i32>(0, 0, 1));
  let c101 = sampleMajorantCell(i0 + vec3<i32>(1, 0, 1));
  let c011 = sampleMajorantCell(i0 + vec3<i32>(0, 1, 1));
  let c111 = sampleMajorantCell(i0 + vec3<i32>(1, 1, 1));
  let x00 = mix(c000, c100, f.x);
  let x10 = mix(c010, c110, f.x);
  let x01 = mix(c001, c101, f.x);
  let x11 = mix(c011, c111, f.x);
  let y0 = mix(x00, x10, f.y);
  let y1 = mix(x01, x11, f.y);
  return mix(y0, y1, f.z);
}

fn sampleWorldMajorantDilated(p: vec3<f32>) -> vec4<f32> {
  let q = clamp((p * 0.5 + vec3<f32>(0.5)) * f32(MAJORANT_GRID), vec3<f32>(0.0), vec3<f32>(f32(MAJORANT_GRID) - 0.001));
  let c = vec3<i32>(floor(q));
  var m = sampleMajorantCell(c);
  m = max(m, sampleMajorantCell(c + vec3<i32>(1, 0, 0)));
  m = max(m, sampleMajorantCell(c + vec3<i32>(-1, 0, 0)));
  m = max(m, sampleMajorantCell(c + vec3<i32>(0, 1, 0)));
  m = max(m, sampleMajorantCell(c + vec3<i32>(0, -1, 0)));
  m = max(m, sampleMajorantCell(c + vec3<i32>(0, 0, 1)));
  m = max(m, sampleMajorantCell(c + vec3<i32>(0, 0, -1)));
  return m;
}

fn majorantGradientSignal(p: vec3<f32>) -> f32 {
  let q = clamp((p * 0.5 + vec3<f32>(0.5)) * f32(MAJORANT_GRID), vec3<f32>(0.0), vec3<f32>(f32(MAJORANT_GRID) - 0.001));
  let c = vec3<i32>(floor(q));
  let x0 = sampleMajorantCell(c + vec3<i32>(-1, 0, 0)).w;
  let x1 = sampleMajorantCell(c + vec3<i32>(1, 0, 0)).w;
  let y0 = sampleMajorantCell(c + vec3<i32>(0, -1, 0)).w;
  let y1 = sampleMajorantCell(c + vec3<i32>(0, 1, 0)).w;
  let z0 = sampleMajorantCell(c + vec3<i32>(0, 0, -1)).w;
  let z1 = sampleMajorantCell(c + vec3<i32>(0, 0, 1)).w;
  return clamp(abs(x1 - x0) + abs(y1 - y0) + abs(z1 - z0), 0.0, 1.5);
}

fn majorantCellExitDistance(p: vec3<f32>, rd: vec3<f32>) -> f32 {
  let q = clamp((p * 0.5 + vec3<f32>(0.5)) * f32(MAJORANT_GRID), vec3<f32>(0.0), vec3<f32>(f32(MAJORANT_GRID) - 0.001));
  let dqdt = rd * (0.5 * f32(MAJORANT_GRID));
  var best = 1.0e6;
  if (abs(dqdt.x) > 0.0001) {
    let bx = select(floor(q.x), floor(q.x) + 1.0, dqdt.x > 0.0);
    let tx = (bx - q.x) / dqdt.x;
    if (tx > 0.0001) { best = min(best, tx); }
  }
  if (abs(dqdt.y) > 0.0001) {
    let by = select(floor(q.y), floor(q.y) + 1.0, dqdt.y > 0.0);
    let ty = (by - q.y) / dqdt.y;
    if (ty > 0.0001) { best = min(best, ty); }
  }
  if (abs(dqdt.z) > 0.0001) {
    let bz = select(floor(q.z), floor(q.z) + 1.0, dqdt.z > 0.0);
    let tz = (bz - q.z) / dqdt.z;
    if (tz > 0.0001) { best = min(best, tz); }
  }
  return min(best, 0.20);
}

fn curlAtCell(c: vec3<i32>) -> vec3<f32> {
  let vx0 = readSlot(c + vec3<i32>(-1, 0, 0), 0u).xyz;
  let vx1 = readSlot(c + vec3<i32>( 1, 0, 0), 0u).xyz;
  let vy0 = readSlot(c + vec3<i32>(0, -1, 0), 0u).xyz;
  let vy1 = readSlot(c + vec3<i32>(0,  1, 0), 0u).xyz;
  let vz0 = readSlot(c + vec3<i32>(0, 0, -1), 0u).xyz;
  let vz1 = readSlot(c + vec3<i32>(0, 0,  1), 0u).xyz;
  return vec3<f32>(
    (vy1.z - vy0.z) - (vz1.y - vz0.y),
    (vz1.x - vz0.x) - (vx1.z - vx0.z),
    (vx1.y - vx0.y) - (vy1.x - vy0.x)
  ) * 0.5;
}

fn curlMagnitudeAtCell(c: vec3<i32>) -> f32 {
  return length(curlAtCell(c));
}

fn divergenceAtCell(c: vec3<i32>) -> f32 {
  let vx0 = readSlot(c + vec3<i32>(-1, 0, 0), 0u).x;
  let vx1 = readSlot(c + vec3<i32>( 1, 0, 0), 0u).x;
  let vy0 = readSlot(c + vec3<i32>(0, -1, 0), 0u).y;
  let vy1 = readSlot(c + vec3<i32>(0,  1, 0), 0u).y;
  let vz0 = readSlot(c + vec3<i32>(0, 0, -1), 0u).z;
  let vz1 = readSlot(c + vec3<i32>(0, 0,  1), 0u).z;
  return ((vx1 - vx0) + (vy1 - vy0) + (vz1 - vz0)) * 0.5;
}

fn pressureProjectionCorrection(c: vec3<i32>, strength: f32) -> vec3<f32> {
  let divX = divergenceAtCell(c + vec3<i32>(1, 0, 0)) - divergenceAtCell(c + vec3<i32>(-1, 0, 0));
  let divY = divergenceAtCell(c + vec3<i32>(0, 1, 0)) - divergenceAtCell(c + vec3<i32>(0, -1, 0));
  let divZ = divergenceAtCell(c + vec3<i32>(0, 0, 1)) - divergenceAtCell(c + vec3<i32>(0, 0, -1));
  let gradient = vec3<f32>(divX, divY, divZ) * 0.5;
  let center = divergenceAtCell(c);
  let localDamping = readSlot(c, 0u).xyz * center * 0.055;
  return (gradient * 0.46 + localDamping) * clamp(strength, 0.0, 1.5);
}

fn vorticityConfinement(c: vec3<i32>, amount: f32) -> vec3<f32> {
  // Vorticity confinement preserves small curl features that semi-Lagrangian advection damps away.
  let magX = curlMagnitudeAtCell(c + vec3<i32>(1, 0, 0)) - curlMagnitudeAtCell(c + vec3<i32>(-1, 0, 0));
  let magY = curlMagnitudeAtCell(c + vec3<i32>(0, 1, 0)) - curlMagnitudeAtCell(c + vec3<i32>(0, -1, 0));
  let magZ = curlMagnitudeAtCell(c + vec3<i32>(0, 0, 1)) - curlMagnitudeAtCell(c + vec3<i32>(0, 0, -1));
  let normal = normalize(vec3<f32>(magX, magY, magZ) + vec3<f32>(0.0001));
  return cross(normal, curlAtCell(c)) * amount;
}

fn fineScaleBreakup(c: vec3<i32>, p: vec3<f32>, time: f32, curl: f32, heat: f32, smoke: f32, source: f32) -> vec3<f32> {
  let localCurl = curlAtCell(c);
  let curlEnergy = length(localCurl);
  let detailA = turbulentDetailForce(p * 1.63 + vec3<f32>(0.17, -0.11, 0.23), time * 1.37);
  let detailB = turbulentDetailForce(p * 2.41 + vec3<f32>(-0.31, 0.19, -0.07), time * 1.91);
  let shearAxis = normalize(localCurl + detailA * 0.19 + vec3<f32>(0.001));
  let shear = normalize(cross(shearAxis, detailB) + detailA * 0.36 + vec3<f32>(0.001));
  let activeFlow = source * 1.55 + heat * 0.52 + smoke * 0.18 + smoothstep(0.006, 0.095, curlEnergy) * 0.32;
  return shear * activeFlow * (0.006 + curl * 0.010);
}

fn turbulentDetailForce(p: vec3<f32>, time: f32) -> vec3<f32> {
  let q = p * vec3<f32>(9.0, 13.0, 11.0) + vec3<f32>(time * 1.7, -time * 2.1, time * 1.3);
  let a = vec3<f32>(
    sin(q.y + cos(q.z)),
    sin(q.z + cos(q.x)),
    sin(q.x + cos(q.y))
  );
  let b = vec3<f32>(
    cos(q.z * 1.37 - q.y),
    cos(q.x * 1.21 - q.z),
    cos(q.y * 1.43 - q.x)
  );
  return normalize(a + b * 0.72 + vec3<f32>(0.001));
}

fn materialInterfaceGradient(c: vec3<i32>) -> vec3<f32> {
  let sx0 = readSlot(c + vec3<i32>(-1, 0, 0), 1u).x;
  let sx1 = readSlot(c + vec3<i32>( 1, 0, 0), 1u).x;
  let hx0 = readSlot(c + vec3<i32>(-1, 0, 0), 1u).y;
  let hx1 = readSlot(c + vec3<i32>( 1, 0, 0), 1u).y;
  let fx0 = readSlot(c + vec3<i32>(-1, 0, 0), 2u).x;
  let fx1 = readSlot(c + vec3<i32>( 1, 0, 0), 2u).x;
  let sy0 = readSlot(c + vec3<i32>(0, -1, 0), 1u).x;
  let sy1 = readSlot(c + vec3<i32>(0,  1, 0), 1u).x;
  let hy0 = readSlot(c + vec3<i32>(0, -1, 0), 1u).y;
  let hy1 = readSlot(c + vec3<i32>(0,  1, 0), 1u).y;
  let fy0 = readSlot(c + vec3<i32>(0, -1, 0), 2u).x;
  let fy1 = readSlot(c + vec3<i32>(0,  1, 0), 2u).x;
  let sz0 = readSlot(c + vec3<i32>(0, 0, -1), 1u).x;
  let sz1 = readSlot(c + vec3<i32>(0, 0,  1), 1u).x;
  let hz0 = readSlot(c + vec3<i32>(0, 0, -1), 1u).y;
  let hz1 = readSlot(c + vec3<i32>(0, 0,  1), 1u).y;
  let fz0 = readSlot(c + vec3<i32>(0, 0, -1), 2u).x;
  let fz1 = readSlot(c + vec3<i32>(0, 0,  1), 2u).x;
  return vec3<f32>(
    (sx1 - sx0) * 0.72 - (hx1 - hx0) * 0.44 + (fx1 - fx0) * 0.38,
    (sy1 - sy0) * 0.72 - (hy1 - hy0) * 0.44 + (fy1 - fy0) * 0.38,
    (sz1 - sz0) * 0.72 - (hz1 - hz0) * 0.44 + (fz1 - fz0) * 0.38
  ) * 0.5;
}

fn transportedMicrodetailAdvection(cell: vec3<f32>, velocity: vec3<f32>, speed: f32, heat: f32, smoke: f32, flame: f32) -> vec4<f32> {
  let lift = vec3<f32>(0.0, (heat * 0.22 + flame * 0.34) * (0.28 + speed * 0.055), 0.0);
  let slip = turbulentDetailForce(cell * 0.031 + vec3<f32>(0.11, -0.07, 0.17), u.cameraPos_time.w * 1.27) * (0.18 + heat * 0.12 + smoke * 0.06);
  let backCell = cell - (velocity + lift + slip) * (1.44 + speed * 0.28);
  return sampleFluidSlot(backCell, 3u);
}

fn interfaceShreddingForce(c: vec3<i32>, p: vec3<f32>, time: f32, amount: f32, heat: f32, smoke: f32, flame: f32, carriedShred: f32) -> vec3<f32> {
  let interfaceGrad = materialInterfaceGradient(c);
  let interfaceEnergy = length(interfaceGrad);
  let localCurl = curlAtCell(c);
  let crossCurl = cross(normalize(interfaceGrad + vec3<f32>(0.001)), normalize(localCurl + turbulentDetailForce(p * 2.2, time) * 0.24 + vec3<f32>(0.001)));
  let interfaceActive = smoothstep(0.018, 0.23, interfaceEnergy) * (0.28 + smoke * 0.34 + heat * 0.28 + flame * 0.20 + carriedShred * 0.30);
  return normalize(crossCurl + turbulentDetailForce(p * 1.7 + vec3<f32>(0.23, -0.19, 0.13), time * 1.5) * 0.36 + vec3<f32>(0.001)) * interfaceActive * amount * 0.036;
}

fn smokeShredEnergy(c: vec3<i32>) -> f32 {
  let m = readSlot(c, 3u);
  return m.x * 0.52 + m.y * 0.90 + m.z * 0.30;
}

fn fireLickBreakup(c: vec3<i32>, p: vec3<f32>, time: f32, amount: f32, heat: f32, fuel: f32, flame: f32, flameDetail: f32, source: f32) -> vec4<f32> {
  let interfaceEnergy = length(materialInterfaceGradient(c));
  let lickWarp = turbulentDetailForce(p * 2.64 + vec3<f32>(0.19, -0.23, 0.11), time * 0.91) * (0.046 + source * 0.040 + heat * 0.018 + flameDetail * 0.016);
  let q = p + lickWarp;
  let combA = sin(q.y * 23.0 + sin(q.x * 19.0 + q.z * 11.0 + time * 3.2) + source * 2.6);
  let combB = cos(q.z * 27.0 - q.x * 13.0 + q.y * 7.0 - time * 4.1 + flameDetail * 1.7);
  let combC = hash31(floor((q + vec3<f32>(1.0)) * 24.0) + vec3<f32>(floor(time * 3.0)));
  let verticalComb = clamp(0.54 + 0.22 * combA + 0.18 * combB + 0.10 * (combC - 0.5), 0.12, 1.10);
  let hotEdge = smoothstep(0.10, 1.20, heat + flame * 0.62) * smoothstep(0.014, 0.18, interfaceEnergy + source * 0.08);
  let lick = hotEdge * verticalComb * amount * (0.16 + fuel * 0.22 + flameDetail * 0.18 + source * 0.24);
  let ash = smoothstep(0.18, 1.4, smokeShredEnergy(c)) * (0.06 + lick * 0.34);
  return vec4<f32>(lick, lick * (0.42 + fuel * 0.24), lick * (0.58 + heat * 0.22), ash);
}

fn thermalAdvection(cell: vec3<f32>, velocity: vec3<f32>, speed: f32, localHeat: f32) -> vec4<f32> {
  let thermalLift = vec3<f32>(0.0, clamp(localHeat, 0.0, 1.7) * (0.24 + speed * 0.055), 0.0);
  let thermalSlip = vec3<f32>(
    sin(cell.z * 0.41 + localHeat * 2.7),
    0.0,
    cos(cell.x * 0.37 - localHeat * 2.1)
  ) * localHeat * 0.032;
  let backCell = cell - (velocity + thermalLift + thermalSlip) * (2.30 + speed * 0.46);
  return sampleFluidSlot(backCell, 1u);
}

fn thermalBuoyancyForce(heat: f32, smoke: f32, fuel: f32, speed: f32) -> vec3<f32> {
  let hotLift = smoothstep(0.04, 1.25, heat) * (0.034 + speed * 0.018);
  let smokeDrag = smoke * 0.014;
  let fuelKick = fuel * heat * 0.014;
  return vec3<f32>(0.0, hotLift + fuelKick - smokeDrag, 0.0);
}

fn heatGradientAtCell(c: vec3<i32>) -> vec3<f32> {
  let hx0 = readSlot(c + vec3<i32>(-1, 0, 0), 1u).y;
  let hx1 = readSlot(c + vec3<i32>( 1, 0, 0), 1u).y;
  let hy0 = readSlot(c + vec3<i32>(0, -1, 0), 1u).y;
  let hy1 = readSlot(c + vec3<i32>(0,  1, 0), 1u).y;
  let hz0 = readSlot(c + vec3<i32>(0, 0, -1), 1u).y;
  let hz1 = readSlot(c + vec3<i32>(0, 0,  1), 1u).y;
  return vec3<f32>(hx1 - hx0, hy1 - hy0, hz1 - hz0) * 0.5;
}

fn thermalExpansionForce(c: vec3<i32>, heat: f32, amount: f32) -> vec3<f32> {
  let grad = heatGradientAtCell(c);
  return -grad * smoothstep(0.08, 1.35, heat) * amount;
}

fn heatToSmokeConversion(heat: f32, fuel: f32, y: f32) -> f32 {
  let coolingBand = smoothstep(0.16, 1.05, heat) * (1.0 - smoothstep(1.18, 1.85, heat));
  let upperAir = smoothstep(-0.55, 0.72, y);
  let fuelSmoke = fuel * smoothstep(0.06, 0.86, heat) * 0.072;
  return coolingBand * upperAir * 0.064 + fuelSmoke;
}

fn fireLayerAdvection(cell: vec3<f32>, velocity: vec3<f32>, speed: f32, heat: f32) -> vec4<f32> {
  let fastLift = vec3<f32>(0.0, clamp(heat, 0.0, 1.9) * (0.40 + speed * 0.13), 0.0);
  let lick = vec3<f32>(
    sin(cell.y * 0.44 + cell.z * 0.19 + heat * 3.8),
    0.0,
    cos(cell.y * 0.38 - cell.x * 0.21 - heat * 3.1)
  ) * heat * 0.070;
  let backCell = cell - (velocity + fastLift + lick) * (1.82 + speed * 0.34);
  return sampleFluidSlot(backCell, 2u);
}

fn gridLine(p: vec3<f32>) -> f32 {
  let a = abs(p);
  var faceUv = vec2<f32>(0.0);
  if (a.x > a.y && a.x > a.z) {
    faceUv = p.yz * 0.5 + vec2<f32>(0.5);
  } else if (a.y > a.z) {
    faceUv = p.xz * 0.5 + vec2<f32>(0.5);
  } else {
    faceUv = p.xy * 0.5 + vec2<f32>(0.5);
  }
  let majorCells = max(4.0, f32(GRID) / 16.0);
  let f = fract(faceUv * majorCells);
  let nearest = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  let line = 1.0 - smoothstep(0.014, 0.042, nearest);
  let face = smoothstep(0.940, 0.995, max(max(a.x, a.y), a.z));
  return line * face;
}

fn slabAxis(origin: f32, dir: f32, halfSize: f32) -> vec2<f32> {
  if (abs(dir) < 0.00001) {
    if (abs(origin) > halfSize) {
      return vec2<f32>(1.0, -1.0);
    }
    return vec2<f32>(-1.0e6, 1.0e6);
  }
  let a = (-halfSize - origin) / dir;
  let b = ( halfSize - origin) / dir;
  return vec2<f32>(min(a, b), max(a, b));
}

fn boxHit(ro: vec3<f32>, rd: vec3<f32>, b: vec3<f32>) -> vec2<f32> {
  let sx = slabAxis(ro.x, rd.x, b.x);
  let sy = slabAxis(ro.y, rd.y, b.y);
  let sz = slabAxis(ro.z, rd.z, b.z);
  return vec2<f32>(max(max(sx.x, sy.x), sz.x), min(min(sx.y, sy.y), sz.y));
}

fn fireColor(temp: f32) -> vec3<f32> {
  let ember = vec3<f32>(0.70, 0.10, 0.018);
  let orange = vec3<f32>(1.0, 0.38, 0.055);
  let gold = vec3<f32>(1.0, 0.74, 0.20);
  let pale = vec3<f32>(1.0, 0.82, 0.34);
  let a = mix(ember, orange, smoothstep(0.08, 0.44, temp));
  let b = mix(gold, pale, smoothstep(0.86, 1.55, temp));
  return mix(a, b, smoothstep(0.34, 1.08, temp));
}

fn emissiveTemperature(fireLayer: vec4<f32>, material: vec4<f32>, microLayer: vec4<f32>, velMag: f32) -> f32 {
  return clamp(
    fireLayer.x * 1.22
      + fireLayer.y * 0.46
      + fireLayer.z * 0.40
      + microLayer.z * 1.18
      + microLayer.w * 0.48
      + material.y * 0.20
      + velMag * 0.30,
    0.0,
    2.4
  );
}

fn fireRadianceEmission(temp: f32, flameDetail: f32, fireLick: f32, emberFleck: f32, radianceGain: f32, glowGain: f32) -> vec3<f32> {
  let core = smoothstep(0.16, 1.18, temp);
  let whiteCore = smoothstep(1.06, 2.10, temp);
  let lickSpark = smoothstep(0.025, 0.34, fireLick + emberFleck * 0.45);
  let filament = smoothstep(0.025, 0.62, flameDetail + fireLick * 0.56);
  let body = fireColor(temp) * (0.28 + core * 1.24 + filament * 0.34);
  let hot = mix(body, vec3<f32>(1.0, 0.92, 0.55), whiteCore * (0.34 + glowGain * 0.12));
  return hot * radianceGain * (0.55 + lickSpark * 0.20 + glowGain * 0.18);
}

fn smokeRadianceExtinction(smokeDensity: f32, microSmoke: f32, interfaceShred: f32, materialDetail: f32, absorptionGain: f32) -> f32 {
  let body = smokeDensity * 0.74 + microSmoke * 0.42 + interfaceShred * 0.34 + materialDetail * 0.12;
  return clamp(body * (0.34 + absorptionGain * 0.46), 0.0, 2.3);
}

fn raymarchInterest(
  density: f32,
  smoke: f32,
  heat: f32,
  temp: f32,
  flame: f32,
  flameDetail: f32,
  microTextureSignal: f32,
  velMag: f32,
  fireLick: f32,
  interfaceShred: f32
) -> f32 {
  let body = density * 0.22 + smoke * 0.16 + heat * 0.10;
  let fire = temp * 0.40 + flame * 0.36 + flameDetail * 0.22 + fireLick * 0.30;
  let edge = microTextureSignal * 0.22 + interfaceShred * 0.42 + velMag * 0.46;
  return clamp(body + fire + edge, 0.0, 1.6);
}

fn adaptiveRayStepScale(interest: f32, adaptiveRays: f32) -> f32 {
  let fine = smoothstep(0.035, 0.92, interest);
  let adaptiveScale = mix(2.65, 0.68, fine);
  return mix(1.0, adaptiveScale, clamp(adaptiveRays, 0.0, 1.0));
}

fn raymarchOccupancySignal(
  density: f32,
  smoke: f32,
  heat: f32,
  temp: f32,
  flame: f32,
  microTextureSignal: f32,
  velMag: f32,
  extinction: f32
) -> f32 {
  let body = density * 0.44 + smoke * 0.38 + extinction * 0.28;
  let fire = temp * 0.24 + flame * 0.28 + heat * 0.16;
  let detail = microTextureSignal * 0.20 + velMag * 0.32;
  return clamp(body + fire + detail, 0.0, 1.8);
}

fn occupancySkipStepScale(occupancy: f32, occupancySkipStrength: f32, adaptiveRays: f32) -> f32 {
  let emptySpan = 1.0 - smoothstep(0.012, 0.135, occupancy);
  let adaptiveAssist = mix(1.45, 3.20, clamp(adaptiveRays, 0.0, 1.0));
  return clamp(1.0 + emptySpan * clamp(occupancySkipStrength, 0.0, 1.0) * adaptiveAssist, 1.0, 4.60);
}

fn raymarchEarlyTermination(transmittance: f32) -> bool {
  return transmittance < 0.012;
}

fn microDetailDomainWarp(p: vec3<f32>, microLayer: vec4<f32>, fireLayer: vec4<f32>, material: vec4<f32>, velocity: vec3<f32>, time: f32) -> vec3<f32> {
  let carrier = clamp(
    microLayer.x * 0.62
      + microLayer.y * 1.08
      + microLayer.z * 0.78
      + microLayer.w * 0.30
      + fireLayer.z * 0.28
      + material.w * 0.18,
    0.0,
    2.6
  );
  let flow = normalize(velocity + turbulentDetailForce(p * 1.31 + vec3<f32>(0.17, -0.11, 0.23), time * 0.47) * 0.16 + vec3<f32>(0.012, 0.019, -0.014));
  let foldA = turbulentDetailForce(p * 2.17 + flow * (0.42 + carrier * 0.34), time * 0.83);
  let foldB = turbulentDetailForce(p.yzx * 2.91 + vec3<f32>(carrier * 0.19, -carrier * 0.13, carrier * 0.17), time * 1.19);
  return (foldA * 0.70 + foldB * 0.36 + flow * 0.24) * carrier * 0.038;
}

fn microFilamentNoise(p: vec3<f32>, warp: vec3<f32>, carrier: f32, velocity: vec3<f32>, time: f32) -> f32 {
  let q = p + warp + velocity * 0.31;
  let phaseA = dot(q, vec3<f32>(29.0, 17.0, -23.0)) + sin(dot(q.yzx, vec3<f32>(11.0, -19.0, 31.0)) + carrier * 2.7 + time * 2.3);
  let phaseB = dot(q.zxy, vec3<f32>(-13.0, 37.0, 19.0)) + cos(dot(q, vec3<f32>(23.0, -7.0, 13.0)) - carrier * 1.9 - time * 3.1);
  let cellNoise = hash31(floor((q + vec3<f32>(1.0)) * 28.0) + vec3<f32>(floor(time * 2.0)));
  return clamp(0.50 + 0.25 * sin(phaseA) + 0.18 * sin(phaseB) + 0.14 * (cellNoise - 0.5), 0.12, 1.12);
}

@compute @workgroup_size(4, 4, 4)
fn csMajorant(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(MAJORANT_GRID))) {
    return;
  }
  let brickStart = vec3<u32>(floor(vec3<f32>(gid) * f32(GRID) / f32(MAJORANT_GRID)));
  let brickEnd = max(brickStart + vec3<u32>(1), vec3<u32>(ceil(vec3<f32>(gid + vec3<u32>(1)) * f32(GRID) / f32(MAJORANT_GRID))));
  var majorant = vec4<f32>(0.0);
  for (var z = brickStart.z; z < min(brickEnd.z, GRID); z = z + 1u) {
    for (var y = brickStart.y; y < min(brickEnd.y, GRID); y = y + 1u) {
      for (var x = brickStart.x; x < min(brickEnd.x, GRID); x = x + 1u) {
        let c = vec3<i32>(vec3<u32>(x, y, z));
        let candidate = materialMajorantFromSlots(readSlot(c, 0u), readSlot(c, 1u), readSlot(c, 2u), readSlot(c, 3u));
        majorant = max(majorant, candidate);
      }
    }
  }
  majorantDst[majorantIndex(gid)] = majorant;
}

@compute @workgroup_size(4, 4, 4)
fn cs(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= vec3<u32>(GRID))) {
    return;
  }
  let idx = index3(gid);
  let base = idx * SLOTS_PER_CELL;
  let cell = vec3<f32>(gid) + vec3<f32>(0.5);
  let cellI = vec3<i32>(gid);
  let p = (cell / f32(GRID)) * 2.0 - vec3<f32>(1.0);
  let prev = fluidSrc[base];
  let speed = u.fire_smoke_curl_speed.w;
  let curl = u.fire_smoke_curl_speed.z;
  let inputRadius = max(0.04, u.source_controls.x);
  let inputFlow = max(0.0, u.source_controls.y);
  let projection = clamp(u.source_controls.z, 0.0, 1.5);
  let microAmount = clamp(u.grid_overlay_debug.y, 0.0, 2.5);
  let shredAmount = clamp(u.grid_overlay_debug.z, 0.0, 5.0);
  let fireLickAmount = clamp(u.grid_overlay_debug.w, 0.0, 5.0);
  let shredOperatorGain = shredAmount * (0.80 + shredAmount * 0.080);
  let fireLickOperatorGain = fireLickAmount * (0.82 + fireLickAmount * 0.110);
  let time = u.cameraPos_time.w;
  let backCell = cell - prev.xyz * (2.55 + speed * 0.55);
  let advected = sampleFluidSlot(backCell, 0u);
  let localMaterial = readSlot(cellI, 1u);
  var material = thermalAdvection(cell, prev.xyz, speed, localMaterial.y);
  var fireLayer = fireLayerAdvection(cell, prev.xyz, speed, localMaterial.y);
  var microLayer = transportedMicrodetailAdvection(cell, prev.xyz, speed, localMaterial.y, localMaterial.x, fireLayer.x);
  var vel = advected.xyz * 0.982;
  var smoke = material.x * 0.990;
  var heat = material.y * 0.982;
  var fuel = material.z * 0.990;
  var materialDetail = material.w * 0.970;
  var flame = fireLayer.x * 0.938;
  var ember = fireLayer.y * 0.952;
  var flameDetail = fireLayer.z * 0.922;
  var microSmoke = microLayer.x * 0.972;
  var interfaceShred = microLayer.y * 0.948;
  var fireLick = microLayer.z * 0.902;
  var emberFleck = microLayer.w * 0.934;

  let radial = length(p.xz);
  let sourceCenter = p.xz;
  let sourceRadial = length(sourceCenter);
  let sourceBand = smoothstep(-0.99, -0.80, p.y) * (1.0 - smoothstep(0.18, 0.58, p.y));
  let breakup = clamp(
    0.64
      + 0.24 * sin(p.x * 19.0 + p.z * 7.0 + time * 1.7)
      + 0.20 * cos(p.z * 23.0 - p.x * 5.0 - time * 1.3)
      + 0.16 * hash31(vec3<f32>(gid) * 0.061 + vec3<f32>(floor(time * 2.0))),
    0.16,
    1.22
  );
  let sourceFalloff = 1.0 / max(0.0064, inputRadius * inputRadius);
  let source = exp(-sourceRadial * sourceRadial * sourceFalloff) * sourceBand * breakup * inputFlow;
  let emberRingRadius = inputRadius * 0.94;
  let emberRingWidth = max(0.045, inputRadius * 0.22);
  let emberRing = exp(-pow(abs(sourceRadial - emberRingRadius), 2.0) / max(0.002, emberRingWidth * emberRingWidth)) * sourceBand * inputFlow * (0.22 + 0.18 * sin(time * 1.7 + p.x * 9.0));
  let fireBirthBand = smoothstep(-0.99, -0.82, p.y) * (1.0 - smoothstep(-0.22, 0.16, p.y));
  let fireBirth = exp(-sourceRadial * sourceRadial * sourceFalloff * 1.70) * fireBirthBand * inputFlow * (0.72 + 0.66 * breakup);
  let swirl = vec3<f32>(-p.z, 0.0, p.x) / max(radial, 0.08);
  let phase = time * 4.8 + p.y * 12.0 + hash31(vec3<f32>(gid) * 0.071) * 3.2;
  let interfaceEnergy = length(materialInterfaceGradient(cellI));
  let lickBirth = fireLickBreakup(cellI, p, time, fireLickOperatorGain, heat, fuel, flame, flameDetail, source);
  let confinement = vorticityConfinement(cellI, 0.034 + curl * 0.044);
  let detailForce = turbulentDetailForce(p, time) * (source + smoke * 0.26 + heat * 0.18) * (0.018 + curl * 0.010);
  let microForce = turbulentDetailForce(p * 2.85 + vec3<f32>(0.13, -0.27, 0.31), time * 2.4) * microAmount * (source * 0.74 + microSmoke * 0.38 + interfaceShred * 0.26 + fireLick * 0.22) * 0.026;
  let shredForce = interfaceShreddingForce(cellI, p, time, shredOperatorGain, heat, smoke, flame, interfaceShred);
  let heatExpansion = thermalExpansionForce(cellI, heat, 0.048 + curl * 0.019);
  let projectionCorrection = pressureProjectionCorrection(cellI, projection);
  vel = vel + swirl * heat * (0.018 + 0.010 * curl) + swirl * source * 0.012;
  vel = vel + confinement * (0.35 + smoke * 0.34 + heat * 0.52);
  vel = vel + detailForce;
  vel = vel + microForce;
  vel = vel + shredForce;
  vel = vel + fineScaleBreakup(cellI, p, time, curl, heat, smoke, source);
  vel = vel + heatExpansion;
  vel = vel + thermalBuoyancyForce(heat, smoke, fuel, speed);
  vel.y = vel.y + source * (0.022 + speed * 0.006) + smoke * 0.003;
  vel.x = vel.x + sin(phase) * (smoke + heat) * 0.009 * curl;
  vel.z = vel.z + cos(phase * 0.93) * (smoke + heat) * 0.009 * curl;
  vel = vel - projectionCorrection * (0.32 + smoke * 0.08 + heat * 0.06);
  let smokeFromHeat = heatToSmokeConversion(heat, fuel, p.y);
  smoke = max(smoke + smokeFromHeat, source * 0.54 + emberRing * 0.16);
  heat = max(heat, source * 0.86 + emberRing * 0.22);
  fuel = max(fuel, source * 0.88 * (1.0 - smoothstep(-0.74, -0.18, p.y)));
  fuel = max(fuel - heat * 0.018, 0.0);
  materialDetail = max(materialDetail, (source + emberRing + smokeFromHeat * 3.2) * (0.32 + 0.56 * breakup));
  microSmoke = max(microSmoke, (source * 0.26 + smokeFromHeat * 0.70 + materialDetail * 0.18) * microAmount * (0.48 + 0.52 * breakup));
  interfaceShred = max(interfaceShred, interfaceEnergy * shredOperatorGain * (smoke * 0.54 + heat * 0.38 + flame * 0.32 + materialDetail * 0.28 + microSmoke * 0.13 + source * 0.30) * 1.72);
  fireLick = max(fireLick, lickBirth.x + fireBirth * fireLickOperatorGain * 0.34);
  emberFleck = max(emberFleck, lickBirth.w + emberRing * 0.18 + interfaceShred * 0.10);
  materialDetail = max(materialDetail, microSmoke * 0.25 + interfaceShred * 0.38);
  flame = max(flame, fireBirth * 1.58 + heat * fuel * 0.060 + fireLick * 0.48);
  ember = max(ember, fireBirth * 0.78 + flame * 0.22 + emberFleck * 0.18);
  flameDetail = max(flameDetail, (fireBirth * 1.16 + heatExpansion.y * 4.0) * (0.44 + 0.62 * breakup) + lickBirth.z + fireLick * 0.34);

  let wall = max(max(abs(p.x), abs(p.y)), abs(p.z));
  let wallFade = 1.0 - smoothstep(0.86, 1.0, wall);
  let smokeTopFade = 1.0 - smoothstep(0.76, 0.995, p.y);
  let heatTopFade = 1.0 - smoothstep(0.50, 0.940, p.y);
  smoke = smoke * mix(0.42, 1.0, wallFade) * mix(0.72, 1.0, smokeTopFade);
  heat = heat * mix(0.30, 1.0, wallFade) * mix(0.16, 1.0, heatTopFade);
  fuel = fuel * mix(0.20, 1.0, wallFade) * mix(0.58, 1.0, heatTopFade);
  materialDetail = materialDetail * mix(0.22, 1.0, wallFade);
  flame = flame * mix(0.12, 1.0, wallFade) * mix(0.08, 1.0, heatTopFade);
  ember = ember * mix(0.18, 1.0, wallFade) * mix(0.16, 1.0, smokeTopFade);
  flameDetail = flameDetail * mix(0.10, 1.0, wallFade);
  microSmoke = microSmoke * mix(0.20, 1.0, wallFade) * mix(0.50, 1.0, smokeTopFade);
  interfaceShred = interfaceShred * mix(0.18, 1.0, wallFade);
  fireLick = fireLick * mix(0.10, 1.0, wallFade) * mix(0.10, 1.0, heatTopFade);
  emberFleck = emberFleck * mix(0.15, 1.0, wallFade);
  let density = clamp(max(smoke * 1.08 + microSmoke * 0.08, heat * 0.42 + materialDetail * 0.18 + interfaceShred * 0.20 + fireLick * 0.05 + fuel * 0.10), 0.0, 2.2);
  vel = vel * mix(0.55, 1.0, wallFade);
  vel.y = max(vel.y, -0.015);
  fluidDst[base] = vec4<f32>(clamp(vel, vec3<f32>(-0.34), vec3<f32>(0.52)), density);
  fluidDst[base + 1u] = vec4<f32>(clamp(smoke, 0.0, 2.2), clamp(heat, 0.0, 2.4), clamp(fuel, 0.0, 1.8), clamp(materialDetail, 0.0, 1.8));
  fluidDst[base + 2u] = vec4<f32>(clamp(flame, 0.0, 2.4), clamp(ember, 0.0, 2.0), clamp(flameDetail, 0.0, 1.8), 0.0);
  fluidDst[base + 3u] = vec4<f32>(clamp(microSmoke, 0.0, 1.8), clamp(interfaceShred, 0.0, 1.8), clamp(fireLick, 0.0, 1.8), clamp(emberFleck, 0.0, 1.4));
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let ndc = vec2<f32>(in.uv.x * 2.0 - 1.0, (1.0 - in.uv.y) * 2.0 - 1.0);
  let nearClip = vec4<f32>(ndc, -1.0, 1.0);
  let farClip = vec4<f32>(ndc, 1.0, 1.0);
  let nearWorldRaw = u.invViewProj * nearClip;
  let farWorldRaw = u.invViewProj * farClip;
  let nearWorld = nearWorldRaw.xyz / nearWorldRaw.w;
  let farWorld = farWorldRaw.xyz / farWorldRaw.w;
  let ro = u.cameraPos_time.xyz;
  let rd = normalize(farWorld - nearWorld);
  let hit = boxHit(ro, rd, vec3<f32>(1.0, 1.0, 1.0));
  if (hit.y <= max(hit.x, 0.0)) {
    return vec4<f32>(0.004, 0.005, 0.006, 1.0);
  }

  let steps = clamp(u.viewport_steps_density.z, 24.0, 192.0);
  let startT = max(hit.x, 0.0);
  let endT = hit.y;
  let dtBase = (endT - startT) / steps;
  let jitter = hash31(vec3<f32>(floor(in.uv * u.viewport_steps_density.xy), floor(u.cameraPos_time.w * 19.0))) * dtBase;
  var t = startT + jitter;
  var trans = 1.0;
  var color = vec3<f32>(0.004, 0.005, 0.006);
  let entryP = ro + rd * startT;
  let exitP = ro + rd * endT;
  var gridAccum = max(gridLine(entryP), gridLine(exitP));

  for (var i = 0; i < 192; i = i + 1) {
    if (f32(i) >= steps || raymarchEarlyTermination(trans) || t > endT) { break; }
    let p = ro + rd * t;
    let majorantNearest = sampleWorldMajorant(p);
    let majorantLinear = sampleWorldMajorantLinear(p);
    let majorantDilated = sampleWorldMajorantDilated(p);
    let majorantSkipStrength = clamp(u.occupancy_controls.y, 0.0, 1.0);
    let majorantSmooth = clamp(u.occupancy_controls.z, 0.0, 1.0);
    let majorantEdgeGuard = clamp(u.occupancy_controls.w, 0.0, 1.0);
    let majorant = mix(majorantNearest, mix(majorantLinear, majorantDilated, 0.28 + majorantEdgeGuard * 0.42), majorantSmooth);
    let majorantEdge = majorantGradientSignal(p);
    let guardedImportance = max(majorant.w, majorantDilated.w * majorantEdgeGuard * (0.55 + majorantSmooth * 0.25));
    let guardedThreshold = mix(0.050, 0.100, majorantEdgeGuard);
    let majorantEmpty = 1.0 - smoothstep(0.004, guardedThreshold, guardedImportance + majorantEdge * majorantEdgeGuard * 0.24);
    let edgeDamping = 1.0 - smoothstep(0.012, 0.16, majorantEdge * majorantEdgeGuard);
    let majorantSkipGate = majorantEmpty * majorantSkipStrength * edgeDamping;
    if (majorantSkipGate > 0.42) {
      let cellExit = majorantCellExitDistance(p, rd);
      let skipDt = min(cellExit + dtBase * 0.20, dtBase * (1.0 + majorantSkipGate * 6.0));
      t = t + min(skipDt, max(0.0001, endT - t));
      continue;
    }
    let state = sampleWorldVelocity(p);
    let material = sampleWorldMaterial(p);
    let fireLayer = sampleWorldFireLayer(p);
    let microLayer = sampleWorldMicrodetail(p);
    let velMag = length(state.xyz);
    let smokeDensity = material.x;
    let heat = material.y;
    let fuel = material.z;
    let materialDetail = material.w;
    let flame = fireLayer.x;
    let ember = fireLayer.y;
    let flameDetail = fireLayer.z;
    let microSmoke = microLayer.x;
    let interfaceShred = microLayer.y;
    let fireLick = microLayer.z;
    let emberFleck = microLayer.w;
    let flowDebug = clamp(u.source_controls.w, 0.0, 1.0);
    let radianceGain = max(0.0, u.radiance_controls.x);
    let absorptionGain = max(0.0, u.radiance_controls.y);
    let glowGain = max(0.0, u.radiance_controls.z);
    let adaptiveRays = clamp(u.radiance_controls.w, 0.0, 1.0);
    let occupancySkipStrength = clamp(u.occupancy_controls.x, 0.0, 1.0);
    let sampleCell = vec3<i32>(floor(clamp((p * 0.5 + vec3<f32>(0.5)) * f32(GRID), vec3<f32>(0.0), vec3<f32>(f32(GRID) - 1.0))));
    let curlDebug = curlMagnitudeAtCell(sampleCell);
    let divDebug = abs(divergenceAtCell(sampleCell));
    let microTextureSignal = clamp(microSmoke * 1.55 + interfaceShred * 2.45 + fireLick * 1.30 + emberFleck * 0.55, 0.0, 2.4);
    let microBodyContribution = microSmoke * 0.10 + interfaceShred * 0.18 + fireLick * 0.06;
    let density = (smokeDensity * 0.84 + heat * 0.28 + materialDetail * 0.14 + microBodyContribution) * u.viewport_steps_density.w;
    let y = clamp((p.y + 1.0) * 0.5, 0.0, 1.0);
    let fireGain = 0.42 + u.fire_smoke_curl_speed.x * 1.15;
    let temp = emissiveTemperature(fireLayer, material, microLayer, velMag) * fireGain;
    let smoke = (smokeDensity + microBodyContribution * 0.70) * smoothstep(0.03, 0.92, y) * u.fire_smoke_curl_speed.y;
    let extinction = smokeRadianceExtinction(smokeDensity, microSmoke, interfaceShred, materialDetail, absorptionGain);
    let occupancy = raymarchOccupancySignal(density, smoke, heat, temp, flame, microTextureSignal, velMag, extinction);
    let emptySpanScale = occupancySkipStepScale(occupancy, occupancySkipStrength, adaptiveRays);
    if (emptySpanScale > 1.08) {
      t = t + min(dtBase * emptySpanScale, max(0.0001, endT - t));
      continue;
    }
    let microWarp = microDetailDomainWarp(p, microLayer, fireLayer, material, state.xyz, u.cameraPos_time.w);
    let detailCarrier = clamp(microTextureSignal + materialDetail * 0.22 + flameDetail * 0.18 + velMag * 0.36, 0.0, 2.8);
    let filamentNoise = microFilamentNoise(p, microWarp, detailCarrier, state.xyz, u.cameraPos_time.w);
    let shredNoise = microFilamentNoise(p.zxy + vec3<f32>(0.13, -0.21, 0.09), microWarp.yzx * 1.21, detailCarrier + interfaceShred * 1.7, state.zxy, u.cameraPos_time.w * 1.17 + 1.3);
    let fireNoise = microFilamentNoise(p.yzx + vec3<f32>(-0.18, 0.07, 0.24), microWarp.zxy * 1.38, detailCarrier + fireLick * 2.1, state.yzx, u.cameraPos_time.w * 1.31 + 2.1);
    let interest = raymarchInterest(density, smoke, heat, temp, flame, flameDetail, microTextureSignal, velMag, fireLick, interfaceShred);
    let localDt = min(dtBase * adaptiveRayStepScale(interest, adaptiveRays), max(0.0001, endT - t));
    let rayStepOpacity = localDt * 3.65;
    let smokeAlpha = clamp((density * 1.08 + smoke * 0.40 + heat * 0.13 + materialDetail * 0.28 + microBodyContribution * 0.54) * rayStepOpacity * (0.86 + absorptionGain * 0.12), 0.0, 0.16);
    let fireAlpha = clamp((flame * 2.15 + ember * 0.86 + flameDetail * 0.82 + fireLick * 2.60 + emberFleck * 0.76 + interfaceShred * 0.26) * rayStepOpacity * fireGain * (0.58 + radianceGain * 0.18), 0.0, 0.20);
    let alpha = clamp(smokeAlpha + fireAlpha, 0.0, 0.18);
    let filament = smoothstep(0.014, 0.34, max(materialDetail * 0.66, microTextureSignal)) * filamentNoise;
    let shredFilament = smoothstep(0.004, 0.22, interfaceShred * 3.10 + fireLick * 0.50 + microSmoke * 0.12) * shredNoise;
    let fireFilament = smoothstep(0.008, 0.34, max(flameDetail * 0.72, fireLick * 2.25 + emberFleck * 0.44)) * fireNoise;
    let fineShadow = 0.48 + 0.64 * filament - 0.20 * shredFilament;
    let smokeCol = vec3<f32>(0.28, 0.38, 0.42) * fineShadow * (0.42 + min(0.78, velMag * 6.0) + shredFilament * 0.26);
    let flameCol = fireColor(temp) * (0.22 + temp * 0.82 + fireFilament * 0.82 + fireLick * 0.32 + shredFilament * 0.10);
    let radianceEmission = fireRadianceEmission(temp, flameDetail, fireLick, emberFleck, radianceGain, glowGain);
    let smokeBacklight = fireColor(temp * 0.72) * smokeAlpha * glowGain * smoothstep(0.16, 1.25, temp) * (0.13 + fireFilament * 0.10);
    let fireMix = smoothstep(0.005, 0.052, fireAlpha) * smoothstep(0.08, 0.70, temp);
    var local = mix(smokeCol, flameCol * 0.30 + radianceEmission * 0.70, fireMix);
    let diagnosticColor = mix(vec3<f32>(0.08, 0.72, 0.95), vec3<f32>(1.0, 0.18, 0.08), smoothstep(0.010, 0.085, divDebug)) * (0.35 + smoothstep(0.012, 0.18, curlDebug));
    local = mix(local, diagnosticColor, flowDebug * smoothstep(0.015, 0.12, curlDebug + divDebug));
    color = color + trans * (alpha * local + fireAlpha * radianceEmission * 0.82 + smokeBacklight);
    let extinctionStep = clamp(alpha * (0.46 + extinction * 0.16) + fireAlpha * 0.08, 0.0, 0.34);
    trans = trans * exp(-extinctionStep);
    t = t + localDt;
  }

  let vignette = 1.0 - smoothstep(0.28, 1.48, length(ndc));
  let exposed = vec3<f32>(1.0) - exp(-color * 0.96);
  var grade = exposed * (0.80 + 0.18 * vignette);
  let overlay = clamp(gridAccum * u.grid_overlay_debug.x * 1.8, 0.0, 1.0);
  grade = mix(grade, vec3<f32>(0.04, 0.86, 0.98), overlay * 0.76);
  return vec4<f32>(pow(max(grade, vec3<f32>(0.0)), vec3<f32>(0.84)), 1.0);
}
`;

export function createKaminosVolumePrototype({ THREE, viewport, camera, controls, getControls, onStatus }) {
  const canvas = document.createElement('canvas');
  canvas.id = 'kaminos-volume-canvas';
  canvas.dataset.prototype = PROTOTYPE_IDENTITY;
  canvas.dataset.routeIdentity = ROUTE_IDENTITY;
  viewport.appendChild(canvas);

  const invViewProj = new THREE.Matrix4();
  const viewProj = new THREE.Matrix4();
  const uniforms = new Float32Array(44);
  let gridSize = normalizeGridSize(getControls().resolution);
  let majorantGridSize = normalizeMajorantGridSize(getControls().majorantGrid);
  const state = {
    prototypeIdentity: PROTOTYPE_IDENTITY,
    routeIdentity: ROUTE_IDENTITY,
    requestedRoute: 'kaminos_volume_smoke=1',
    effectiveRoute: ROUTE_IDENTITY,
    backend: 'inactive',
    active: false,
    width: 0,
    height: 0,
    frameCount: 0,
    simStepCount: 0,
    simGrid: gridSize,
    simGridLabel: `${gridSize}^3 velocity-material-fire-microdetail-storage-buffer`,
    gridOverlay: 0,
    adaptiveRaymarch: 0.65,
    occupancySkip: 0.35,
    majorantSkip: 0.70,
    majorantSmooth: 0.85,
    majorantGuard: 0.75,
    majorantGrid: majorantGridSize,
    majorantBuilt: false,
    majorantFrameCount: 0,
    lastFrameEnergy: 0,
    timing: {
      rafFps: 0,
      frameDeltaMs: 0,
      frameP95Ms: 0,
      cpuFrameMs: 0,
      cpuFrameP95Ms: 0,
      queueDoneMs: null,
      queueDoneP95Ms: null,
      queueProbePending: false,
      queueSamples: 0,
      queueTimingAvailable: false,
    },
    error: null,
  };

  let adapter = null;
  let device = null;
  let context = null;
  let pipeline = null;
  let readbackPipeline = null;
  let computePipeline = null;
  let majorantComputePipeline = null;
  let bindGroups = [];
  let majorantFluidBindGroups = [];
  let majorantWriteBindGroup = null;
  let bindGroupLayout = null;
  let majorantFluidBindGroupLayout = null;
  let majorantWriteBindGroupLayout = null;
  let pipelineLayout = null;
  let majorantPipelineLayout = null;
  let shader = null;
  let uniformBuffer = null;
  let majorantBuffer = null;
  let fluidBuffers = [];
  let currentFluid = 0;
  let frameTexture = null;
  let frameTextureSize = '';
  let format = null;
  let raf = 0;
  let controlsSnapshot = getControls();
  const timingSamples = {
    rafDelta: [],
    cpuFrame: [],
    queueDone: [],
  };
  let lastRafNow = 0;
  let queueProbePending = false;

  function pushTimingSample(name, value, maxSamples = 120) {
    if (!Number.isFinite(value)) return;
    const samples = timingSamples[name];
    samples.push(value);
    if (samples.length > maxSamples) samples.shift();
  }

  function percentileTiming(samples, percentile) {
    if (!samples.length) return null;
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentile * sorted.length) - 1));
    return sorted[index];
  }

  function recordVolumeFrameTiming(now, cpuFrameMs) {
    if (lastRafNow > 0) pushTimingSample('rafDelta', now - lastRafNow);
    lastRafNow = now;
    pushTimingSample('cpuFrame', cpuFrameMs);
    const rafP95 = percentileTiming(timingSamples.rafDelta, 0.95);
    const cpuP95 = percentileTiming(timingSamples.cpuFrame, 0.95);
    state.timing = {
      ...state.timing,
      rafFps: rafP95 ? 1000 / rafP95 : 0,
      frameDeltaMs: timingSamples.rafDelta.at(-1) ?? 0,
      frameP95Ms: rafP95 ?? 0,
      cpuFrameMs,
      cpuFrameP95Ms: cpuP95 ?? 0,
      queueProbePending,
      queueSamples: timingSamples.queueDone.length,
    };
  }

  function recordVolumeQueueTiming(submittedAt) {
    const queueDoneMs = performance.now() - submittedAt;
    pushTimingSample('queueDone', queueDoneMs, 80);
    state.timing = {
      ...state.timing,
      queueDoneMs,
      queueDoneP95Ms: percentileTiming(timingSamples.queueDone, 0.95),
      queueProbePending: queueProbePending,
      queueSamples: timingSamples.queueDone.length,
      queueTimingAvailable: true,
    };
  }

  function probeVolumeQueueTiming() {
    if (queueProbePending || !device?.queue?.onSubmittedWorkDone) return;
    queueProbePending = true;
    state.timing = { ...state.timing, queueProbePending: true, queueTimingAvailable: true };
    const submittedAt = performance.now();
    device.queue.onSubmittedWorkDone()
      .then(() => recordVolumeQueueTiming(submittedAt))
      .catch(error => {
        state.timing = {
          ...state.timing,
          queueTimingAvailable: false,
          queueTimingError: error?.message || String(error),
        };
      })
      .finally(() => {
        queueProbePending = false;
        state.timing = { ...state.timing, queueProbePending: false };
      });
  }

  function emitStatus(extra = {}) {
    onStatus?.({ ...state, ...extra });
  }

  function makeInitialFluid(nextGridSize) {
    const data = new Float32Array(gridCellCount(nextGridSize) * FLUID_COMPONENTS);
    for (let z = 0; z < nextGridSize; z += 1) {
      for (let y = 0; y < nextGridSize; y += 1) {
        for (let x = 0; x < nextGridSize; x += 1) {
          const fx = (x + 0.5) / nextGridSize * 2 - 1;
          const fy = (y + 0.5) / nextGridSize * 2 - 1;
          const fz = (z + 0.5) / nextGridSize * 2 - 1;
          const radial = Math.hypot(fx, fz);
          const inputRadius = Math.max(0.08, controlsSnapshot.inputRadius || 0.08);
          const inputFlow = Math.max(0, controlsSnapshot.flowRate ?? 0.3);
          const source = Math.exp(-(radial * radial) / Math.max(0.0064, inputRadius * inputRadius)) * Math.max(0, 1 - Math.abs(fy + 0.74) * 4.2) * inputFlow;
          const i = ((x + y * nextGridSize + z * nextGridSize * nextGridSize) * FLUID_COMPONENTS);
          data[i] = -fz * source * 0.11;
          data[i + 1] = source * 0.22;
          data[i + 2] = fx * source * 0.11;
          data[i + 3] = source * 1.25;
          data[i + 4] = source * 0.74;
          data[i + 5] = source * 1.28;
          data[i + 6] = source * 1.0;
          data[i + 7] = source * (0.35 + 0.65 * Math.sin((fx * 18) + (fz * 11)) ** 2);
          data[i + 8] = source * 0.90;
          data[i + 9] = source * 0.42;
          data[i + 10] = source * (0.30 + 0.70 * Math.cos((fx * 13) - (fz * 17)) ** 2);
          data[i + 11] = 0;
          data[i + 12] = source * (0.22 + 0.78 * Math.sin((fx * 31) - (fz * 19)) ** 2);
          data[i + 13] = source * (0.12 + 0.50 * Math.cos((fx * 23) + (fy * 17) - (fz * 29)) ** 2);
          data[i + 14] = source * (0.18 + 0.82 * Math.sin((fy * 27) + (fz * 21)) ** 2);
          data[i + 15] = source * 0.16;
        }
      }
    }
    return data;
  }

  function destroyFluidState() {
    for (const buffer of fluidBuffers) buffer.destroy();
    fluidBuffers = [];
    bindGroups = [];
    majorantFluidBindGroups = [];
  }

  function destroyMajorantState() {
    majorantBuffer?.destroy();
    majorantBuffer = null;
    majorantWriteBindGroup = null;
  }

  function ensureMajorantBuffer() {
    if (majorantBuffer) return;
    majorantBuffer = device.createBuffer({
      label: `kaminos coarse majorant field ${majorantGridSize}^3`,
      size: majorantBufferBytes(majorantGridSize),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(majorantBuffer, 0, new Float32Array(majorantGridSize * majorantGridSize * majorantGridSize * 4));
    majorantWriteBindGroup = device.createBindGroup({
      label: `kaminos coarse majorant write bind group ${majorantGridSize}^3`,
      layout: majorantWriteBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: majorantBuffer } },
      ],
    });
  }

  function rebuildFluidState(nextGridSize = gridSize, nextMajorantGridSize = majorantGridSize) {
    gridSize = normalizeGridSize(nextGridSize);
    majorantGridSize = normalizeMajorantGridSize(nextMajorantGridSize);
    destroyFluidState();
    destroyMajorantState();
    ensureMajorantBuffer();
    const nextBufferBytes = fluidBufferBytes(gridSize);
    const initialFluid = makeInitialFluid(gridSize);
    fluidBuffers = [0, 1].map(i => {
      const buffer = device.createBuffer({
        label: `kaminos fluid state ${gridSize}^3 ${i}`,
        size: nextBufferBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      device.queue.writeBuffer(buffer, 0, initialFluid);
      return buffer;
    });
    const renderPipelineConstants = { GRID: gridSize, MAJORANT_GRID: majorantGridSize };
    const computePipelineConstants = { GRID: gridSize };
    const majorantPipelineConstants = { GRID: gridSize, MAJORANT_GRID: majorantGridSize };
    const makePipeline = (targetFormat, label) => device.createRenderPipeline({
      label,
      layout: pipelineLayout,
      vertex: { module: shader, entryPoint: 'vs' },
      fragment: { module: shader, entryPoint: 'fs', constants: renderPipelineConstants, targets: [{ format: targetFormat }] },
      primitive: { topology: 'triangle-list' },
    });
    pipeline = makePipeline(format, `kaminos volume canvas native-3d-compute-fluid-raymarch-v0 ${gridSize}^3`);
    readbackPipeline = makePipeline('rgba8unorm', `kaminos volume readback native-3d-compute-fluid-raymarch-v0 ${gridSize}^3`);
    computePipeline = device.createComputePipeline({
      label: `kaminos first fluid sim compute pipeline ${gridSize}^3`,
      layout: pipelineLayout,
      compute: { module: shader, entryPoint: 'cs', constants: computePipelineConstants },
    });
    majorantComputePipeline = device.createComputePipeline({
      label: `kaminos coarse majorant compute pipeline ${gridSize}^3 to ${majorantGridSize}^3`,
      layout: majorantPipelineLayout,
      compute: { module: shader, entryPoint: 'csMajorant', constants: majorantPipelineConstants },
    });
    bindGroups = [
      device.createBindGroup({
        label: `kaminos fluid bind group ${gridSize}^3 A to B`,
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: fluidBuffers[0] } },
          { binding: 2, resource: { buffer: fluidBuffers[1] } },
          { binding: 3, resource: { buffer: majorantBuffer } },
        ],
      }),
      device.createBindGroup({
        label: `kaminos fluid bind group ${gridSize}^3 B to A`,
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: fluidBuffers[1] } },
          { binding: 2, resource: { buffer: fluidBuffers[0] } },
          { binding: 3, resource: { buffer: majorantBuffer } },
        ],
      }),
    ];
    majorantFluidBindGroups = [
      device.createBindGroup({
        label: `kaminos majorant fluid-read bind group ${gridSize}^3 A`,
        layout: majorantFluidBindGroupLayout,
        entries: [
          { binding: 1, resource: { buffer: fluidBuffers[0] } },
        ],
      }),
      device.createBindGroup({
        label: `kaminos majorant fluid-read bind group ${gridSize}^3 B`,
        layout: majorantFluidBindGroupLayout,
        entries: [
          { binding: 1, resource: { buffer: fluidBuffers[1] } },
        ],
      }),
    ];
    currentFluid = 0;
    state.simStepCount = 0;
    state.simGrid = gridSize;
    state.simGridLabel = `${gridSize}^3 velocity-material-fire-microdetail-storage-buffer`;
    state.majorantGrid = majorantGridSize;
    state.majorantBuilt = false;
    state.majorantFrameCount = 0;
    emitStatus({ phase: 'grid-rebuilt' });
  }

  async function ensureGpu() {
    if (device) return;
    if (!navigator.gpu) {
      throw new Error('WebGPU unavailable');
    }
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('WebGPU adapter unavailable');
    const maxRequestedFluidBufferBytes = fluidBufferBytes(Math.max(...SUPPORTED_GRID_SIZES));
    const requiredLimits = {};
    if ((adapter.limits?.maxStorageBufferBindingSize ?? 0) >= maxRequestedFluidBufferBytes) {
      requiredLimits.maxStorageBufferBindingSize = maxRequestedFluidBufferBytes;
    }
    device = await adapter.requestDevice(Object.keys(requiredLimits).length ? { requiredLimits } : undefined);
    context = canvas.getContext('webgpu');
    format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
    device.addEventListener('uncapturederror', event => {
      state.error = event.error?.message || String(event.error || 'WebGPU uncaptured error');
      emitStatus({ phase: 'gpu-error', error: state.error });
    });
    uniformBuffer = device.createBuffer({
      label: 'kaminos fluid uniforms',
      size: uniforms.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    shader = device.createShaderModule({ label: 'kaminos compute fluid raymarch wgsl', code: WGSL });
    const compilationInfo = await shader.getCompilationInfo();
    const compilationErrors = compilationInfo.messages.filter(message => message.type === 'error');
    if (compilationErrors.length > 0) {
      const detail = compilationErrors
        .map(message => `${message.lineNum}:${message.linePos} ${message.message}`)
        .join('\n');
      throw new Error(`WGSL compilation failed:\n${detail}`);
    }
    bindGroupLayout = device.createBindGroupLayout({
      label: 'kaminos fluid bind group layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });
    majorantFluidBindGroupLayout = device.createBindGroupLayout({
      label: 'kaminos majorant fluid-read bind group layout',
      entries: [
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });
    majorantWriteBindGroupLayout = device.createBindGroupLayout({
      label: 'kaminos majorant write bind group layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
      ],
    });
    pipelineLayout = device.createPipelineLayout({
      label: 'kaminos fluid pipeline layout',
      bindGroupLayouts: [bindGroupLayout],
    });
    majorantPipelineLayout = device.createPipelineLayout({
      label: 'kaminos coarse majorant pipeline layout',
      bindGroupLayouts: [majorantFluidBindGroupLayout, majorantWriteBindGroupLayout],
    });
    device.pushErrorScope('validation');
    rebuildFluidState(controlsSnapshot.resolution, controlsSnapshot.majorantGrid);
    const pipelineError = await device.popErrorScope();
    if (pipelineError) {
      throw new Error(`fluid pipeline validation: ${pipelineError.message || String(pipelineError)}`);
    }
    state.backend = `WebGPU:${adapter.info?.vendor || 'adapter'}`;
    emitStatus({ phase: 'gpu-ready' });
  }

  function resize() {
    const rect = viewport.getBoundingClientRect();
    const dpr = 1;
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      state.width = width;
      state.height = height;
      frameTextureSize = '';
    }
  }

  function ensureFrameTexture() {
    const key = `${state.width}x${state.height}`;
    if (frameTexture && frameTextureSize === key) return;
    frameTexture?.destroy();
    frameTexture = device.createTexture({
      label: 'kaminos volume witness frame texture',
      size: { width: state.width, height: state.height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    frameTextureSize = key;
  }

  function updateUniforms(now) {
    resize();
    camera.updateMatrixWorld();
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    invViewProj.copy(viewProj).invert();
    uniforms.set(invViewProj.elements, 0);
    uniforms[16] = camera.position.x;
    uniforms[17] = camera.position.y;
    uniforms[18] = camera.position.z;
    uniforms[19] = now * 0.001;
    uniforms[20] = state.width;
    uniforms[21] = state.height;
    uniforms[22] = controlsSnapshot.raySteps;
    uniforms[23] = controlsSnapshot.density;
    uniforms[24] = controlsSnapshot.fire;
    uniforms[25] = controlsSnapshot.smoke;
    uniforms[26] = controlsSnapshot.curl;
    uniforms[27] = controlsSnapshot.speed;
    uniforms[28] = controlsSnapshot.gridOverlay || 0;
    uniforms[29] = controlsSnapshot.microdetail ?? 1.55;
    uniforms[30] = controlsSnapshot.interfaceShred ?? 1.55;
    uniforms[31] = controlsSnapshot.fireLicks ?? 1.65;
    uniforms[32] = controlsSnapshot.inputRadius || 0.08;
    uniforms[33] = controlsSnapshot.flowRate ?? 0.3;
    uniforms[34] = controlsSnapshot.projection ?? 0.65;
    uniforms[35] = controlsSnapshot.flowDebug || 0;
    uniforms[36] = controlsSnapshot.radiance ?? 1.65;
    uniforms[37] = controlsSnapshot.absorption ?? 0.85;
    uniforms[38] = controlsSnapshot.glow ?? 1.15;
    uniforms[39] = controlsSnapshot.adaptiveRays ?? 0.65;
    uniforms[40] = controlsSnapshot.occupancySkip ?? 0.35;
    uniforms[41] = controlsSnapshot.majorantSkip ?? 0.70;
    uniforms[42] = controlsSnapshot.majorantSmooth ?? 0.85;
    uniforms[43] = controlsSnapshot.majorantGuard ?? 0.75;
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);
    state.gridOverlay = controlsSnapshot.gridOverlay || 0;
    state.adaptiveRaymarch = uniforms[39];
    state.occupancySkip = uniforms[40];
    state.majorantSkip = uniforms[41];
    state.majorantSmooth = uniforms[42];
    state.majorantGuard = uniforms[43];
  }

  function encodeSim(encoder) {
    const pass = encoder.beginComputePass({ label: 'kaminos fluid sim pass' });
    pass.setPipeline(computePipeline);
    pass.setBindGroup(0, bindGroups[currentFluid]);
    const workgroups = Math.ceil(gridSize / 4);
    pass.dispatchWorkgroups(workgroups, workgroups, workgroups);
    pass.end();
    currentFluid = 1 - currentFluid;
    state.simStepCount += 1;
  }

  function encodeMajorant(encoder) {
    const pass = encoder.beginComputePass({ label: 'kaminos coarse majorant build pass' });
    pass.setPipeline(majorantComputePipeline);
    pass.setBindGroup(0, majorantFluidBindGroups[currentFluid]);
    pass.setBindGroup(1, majorantWriteBindGroup);
    const workgroups = Math.ceil(majorantGridSize / 4);
    pass.dispatchWorkgroups(workgroups, workgroups, workgroups);
    pass.end();
    state.majorantBuilt = true;
    state.majorantFrameCount += 1;
  }

  function encodeDraw(encoder, view, label, targetPipeline = pipeline) {
    const pass = encoder.beginRenderPass({
      label,
      colorAttachments: [{
        view,
        clearValue: { r: 0.004, g: 0.005, b: 0.006, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(targetPipeline);
    pass.setBindGroup(0, bindGroups[currentFluid]);
    pass.draw(3);
    pass.end();
  }

  function render(now) {
    if (!state.active) return;
    raf = requestAnimationFrame(render);
    const cpuStart = performance.now();
    controls?.update?.();
    updateUniforms(now);
    const encoder = device.createCommandEncoder({ label: 'kaminos compute fluid frame' });
    encodeSim(encoder);
    encodeMajorant(encoder);
    encodeDraw(encoder, context.getCurrentTexture().createView(), 'kaminos volume canvas pass');
    device.queue.submit([encoder.finish()]);
    state.frameCount += 1;
    state.lastFrameEnergy = Math.min(9.999, state.simStepCount * 0.001 + 0.55 * controlsSnapshot.density + 0.35 * controlsSnapshot.fire + 0.18 * (controlsSnapshot.radiance ?? 1.65));
    recordVolumeFrameTiming(now, performance.now() - cpuStart);
    if (state.frameCount % 12 === 0) probeVolumeQueueTiming();
  }

  async function sampleSimReadback() {
    const readback = device.createBuffer({
      label: 'kaminos fluid simReadback',
      size: fluidBufferBytes(gridSize),
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder({ label: 'kaminos fluid simReadback encoder' });
    encoder.copyBufferToBuffer(fluidBuffers[currentFluid], 0, readback, 0, fluidBufferBytes(gridSize));
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(readback.getMappedRange());
    let densitySum = 0;
    let densityMax = 0;
    let heatSum = 0;
    let detailSum = 0;
    let fireLayerSum = 0;
    let radianceSum = 0;
    let extinctionSum = 0;
    let microdetailSum = 0;
    let interfaceShredSum = 0;
    let fireLickSum = 0;
    let velocitySum = 0;
    let curlSum = 0;
    let curlMax = 0;
    let divergenceSum = 0;
    let divergenceMax = 0;
    let liveVoxels = 0;
    const cells = gridCellCount(gridSize);
    const stride = Math.max(1, Math.floor(cells / 4096));
    const sampleCells = new Set();
    for (let cell = 0; cell < cells; cell += stride) sampleCells.add(cell);
    const addSampleCell = (x, y, z) => {
      const cx = Math.max(0, Math.min(gridSize - 1, x | 0));
      const cy = Math.max(0, Math.min(gridSize - 1, y | 0));
      const cz = Math.max(0, Math.min(gridSize - 1, z | 0));
      sampleCells.add(cx + cy * gridSize + cz * gridSize * gridSize);
    };
    const center = Math.floor(gridSize * 0.5);
    const sourceY = Math.floor(gridSize * 0.13);
    const sourceRadius = Math.max(2, Math.ceil(gridSize * Math.max(0.08, controlsSnapshot.inputRadius || 0.08) * 0.75));
    const localStep = Math.max(1, Math.floor(sourceRadius / 3));
    for (let y = sourceY - sourceRadius; y <= sourceY + sourceRadius * 6; y += localStep) {
      for (let z = center - sourceRadius; z <= center + sourceRadius; z += localStep) {
        for (let x = center - sourceRadius; x <= center + sourceRadius; x += localStep) {
          addSampleCell(x, y, z);
        }
      }
    }
    const clampIndex = value => Math.max(0, Math.min(gridSize - 1, value));
    const velocityAt = (x, y, z) => {
      const cx = clampIndex(x);
      const cy = clampIndex(y);
      const cz = clampIndex(z);
      const i = (cx + cy * gridSize + cz * gridSize * gridSize) * FLUID_COMPONENTS;
      return [data[i], data[i + 1], data[i + 2]];
    };
    let samples = 0;
    for (const cell of sampleCells) {
      const i = cell * FLUID_COMPONENTS;
      const x = cell % gridSize;
      const y = Math.floor(cell / gridSize) % gridSize;
      const z = Math.floor(cell / (gridSize * gridSize));
      const vx = data[i];
      const vy = data[i + 1];
      const vz = data[i + 2];
      const d = Math.max(data[i + 3], data[i + 4] * 0.9, data[i + 5] * 0.72);
      const smokeDensity = data[i + 4];
      const heat = data[i + 5];
      const detail = data[i + 7];
      const flame = data[i + 8];
      const ember = data[i + 9];
      const flameDetail = data[i + 10];
      const fireLayer = Math.max(flame, ember, flameDetail);
      const microdetail = data[i + 12];
      const interfaceShred = data[i + 13];
      const fireLick = data[i + 14];
      const emberFleck = data[i + 15];
      const radianceGain = controlsSnapshot.radiance ?? 1.65;
      const absorptionGain = controlsSnapshot.absorption ?? 0.85;
      const radiance = Math.max(0, flame * 1.22 + ember * 0.46 + flameDetail * 0.40 + fireLick * 1.18 + emberFleck * 0.48 + heat * 0.20) * radianceGain;
      const extinction = Math.max(0, smokeDensity * 0.74 + microdetail * 0.42 + interfaceShred * 0.34 + detail * 0.12) * (0.34 + absorptionGain * 0.46);
      densitySum += d;
      densityMax = Math.max(densityMax, d);
      heatSum += heat;
      detailSum += detail;
      fireLayerSum += fireLayer;
      radianceSum += radiance;
      extinctionSum += extinction;
      microdetailSum += microdetail;
      interfaceShredSum += interfaceShred;
      fireLickSum += fireLick;
      velocitySum += Math.hypot(vx, vy, vz);
      const vx0 = velocityAt(x - 1, y, z);
      const vx1 = velocityAt(x + 1, y, z);
      const vy0 = velocityAt(x, y - 1, z);
      const vy1 = velocityAt(x, y + 1, z);
      const vz0 = velocityAt(x, y, z - 1);
      const vz1 = velocityAt(x, y, z + 1);
      const curlX = ((vy1[2] - vy0[2]) - (vz1[1] - vz0[1])) * 0.5;
      const curlY = ((vz1[0] - vz0[0]) - (vx1[2] - vx0[2])) * 0.5;
      const curlZ = ((vx1[1] - vx0[1]) - (vy1[0] - vy0[0])) * 0.5;
      const curlMag = Math.hypot(curlX, curlY, curlZ);
      const div = Math.abs(((vx1[0] - vx0[0]) + (vy1[1] - vy0[1]) + (vz1[2] - vz0[2])) * 0.5);
      curlSum += curlMag;
      curlMax = Math.max(curlMax, curlMag);
      divergenceSum += div;
      divergenceMax = Math.max(divergenceMax, div);
      if (d > 0.02) liveVoxels += 1;
      samples += 1;
    }
    readback.unmap();
    readback.destroy();
    return {
      grid: gridSize,
      gridLabel: state.simGridLabel,
      samples,
      densityMean: densitySum / samples,
      densityMax,
      heatMean: heatSum / samples,
      detailMean: detailSum / samples,
      fireLayerMean: fireLayerSum / samples,
      radianceMean: radianceSum / samples,
      extinctionMean: extinctionSum / samples,
      microdetailMean: microdetailSum / samples,
      interfaceShredMean: interfaceShredSum / samples,
      fireLickMean: fireLickSum / samples,
      velocityMean: velocitySum / samples,
      curlMean: curlSum / samples,
      curlMax,
      divergenceMean: divergenceSum / samples,
      divergenceMax,
      liveVoxels,
    };
  }

  async function sampleMajorantReadback() {
    const readback = device.createBuffer({
      label: 'kaminos coarse majorant readback',
      size: majorantBufferBytes(majorantGridSize),
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder({ label: 'kaminos coarse majorant readback encoder' });
    encoder.copyBufferToBuffer(majorantBuffer, 0, readback, 0, majorantBufferBytes(majorantGridSize));
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(readback.getMappedRange());
    let densitySum = 0;
    let radianceSum = 0;
    let extinctionSum = 0;
    let importanceSum = 0;
    let densityMax = 0;
    let radianceMax = 0;
    let extinctionMax = 0;
    let importanceMax = 0;
    let occupiedBricks = 0;
    const bricks = majorantGridSize * majorantGridSize * majorantGridSize;
    for (let i = 0; i < bricks; i += 1) {
      const offset = i * 4;
      const density = data[offset];
      const radiance = data[offset + 1];
      const extinction = data[offset + 2];
      const importance = data[offset + 3];
      densitySum += density;
      radianceSum += radiance;
      extinctionSum += extinction;
      importanceSum += importance;
      densityMax = Math.max(densityMax, density);
      radianceMax = Math.max(radianceMax, radiance);
      extinctionMax = Math.max(extinctionMax, extinction);
      importanceMax = Math.max(importanceMax, importance);
      if (importance > 0.015 || density > 0.01 || radiance > 0.01 || extinction > 0.01) occupiedBricks += 1;
    }
    readback.unmap();
    readback.destroy();
    const result = {
      grid: majorantGridSize,
      bricks,
      occupiedBricks,
      densityMean: densitySum / bricks,
      densityMax,
      radianceMean: radianceSum / bricks,
      radianceMax,
      extinctionMean: extinctionSum / bricks,
      extinctionMax,
      importanceMean: importanceSum / bricks,
      importanceMax,
    };
    state.majorantOccupiedBricks = occupiedBricks;
    state.majorantImportanceMax = importanceMax;
    return result;
  }

  async function sampleFrame() {
    if (!state.active || !device) return { ok: false, reason: 'inactive', ...state };
    updateUniforms(performance.now());
    ensureFrameTexture();
    const bytesPerPixel = 4;
    const unpaddedBytesPerRow = state.width * bytesPerPixel;
    const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
    const buffer = device.createBuffer({
      label: 'kaminos volume witness readback',
      size: bytesPerRow * state.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    device.pushErrorScope('validation');
    const encoder = device.createCommandEncoder({ label: 'kaminos volume witness readback encoder' });
    encodeSim(encoder);
    encodeMajorant(encoder);
    encodeDraw(encoder, frameTexture.createView(), 'kaminos volume one-off readback pass', readbackPipeline);
    encoder.copyTextureToBuffer(
      { texture: frameTexture },
      { buffer, bytesPerRow, rowsPerImage: state.height },
      { width: state.width, height: state.height, depthOrArrayLayers: 1 }
    );
    device.queue.submit([encoder.finish()]);
    const validationError = await device.popErrorScope();
    if (validationError) {
      buffer.destroy();
      return {
        ok: false,
        reason: 'readback-validation',
        validationError: validationError.message || String(validationError),
        width: state.width,
        height: state.height,
        frameCount: state.frameCount,
        simStepCount: state.simStepCount,
        simGrid: state.simGrid,
        simGridLabel: state.simGridLabel,
        gridOverlay: state.gridOverlay,
        adaptiveRaymarch: state.adaptiveRaymarch,
        occupancySkip: state.occupancySkip,
        majorantSkip: state.majorantSkip,
        majorantSmooth: state.majorantSmooth,
        majorantGuard: state.majorantGuard,
        majorantGrid: state.majorantGrid,
        majorantBuilt: state.majorantBuilt,
        timing: { ...state.timing },
        effectiveRoute: state.effectiveRoute,
        prototypeIdentity: state.prototypeIdentity,
        backend: state.backend,
      };
    }
    await buffer.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(buffer.getMappedRange());
    let litPixels = 0;
    let fireLikePixels = 0;
    let emissiveLikePixels = 0;
    let smokeLikePixels = 0;
    let totalLuma = 0;
    let samples = 0;
    const previewWidth = 256;
    const previewHeight = Math.max(1, Math.round(previewWidth * state.height / state.width));
    const preview = new Uint8Array(previewWidth * previewHeight * 4);
    for (let y = Math.floor(state.height * 0.08); y < Math.floor(state.height * 0.92); y += 2) {
      const row = y * bytesPerRow;
      for (let x = Math.floor(state.width * 0.08); x < Math.floor(state.width * 0.92); x += 2) {
        const i = row + x * bytesPerPixel;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        totalLuma += luma;
        samples += 1;
        if (luma > 20) litPixels += 1;
        if (r > 120 && g > 70 && b < 90) fireLikePixels += 1;
        if (r > 170 && g > 120 && b < 115 && luma > 130) emissiveLikePixels += 1;
        if (b > 28 && g > 28 && r < 105 && Math.abs(g - b) < 60) smokeLikePixels += 1;
      }
    }
    for (let py = 0; py < previewHeight; py += 1) {
      const srcY = Math.min(state.height - 1, Math.floor(py / previewHeight * state.height));
      const row = srcY * bytesPerRow;
      for (let px = 0; px < previewWidth; px += 1) {
        const srcX = Math.min(state.width - 1, Math.floor(px / previewWidth * state.width));
        const src = row + srcX * bytesPerPixel;
        const dst = (py * previewWidth + px) * 4;
        preview[dst] = data[src];
        preview[dst + 1] = data[src + 1];
        preview[dst + 2] = data[src + 2];
        preview[dst + 3] = 255;
      }
    }
    buffer.unmap();
    buffer.destroy();
    const simReadback = await sampleSimReadback();
    const majorantReadback = await sampleMajorantReadback();
    return {
      ok: true,
      width: state.width,
      height: state.height,
      meanLuma: totalLuma / Math.max(1, samples),
      litPixels,
      fireLikePixels,
      emissiveLikePixels,
      smokeLikePixels,
      frameCount: state.frameCount,
      simStepCount: state.simStepCount,
      simGrid: state.simGrid,
      simGridLabel: state.simGridLabel,
      gridOverlay: state.gridOverlay,
      adaptiveRaymarch: state.adaptiveRaymarch,
      occupancySkip: state.occupancySkip,
      majorantSkip: state.majorantSkip,
      majorantSmooth: state.majorantSmooth,
      majorantGuard: state.majorantGuard,
      majorantGrid: state.majorantGrid,
      majorantBuilt: state.majorantBuilt,
      timing: { ...state.timing },
      simReadback,
      majorantReadback,
      effectiveRoute: state.effectiveRoute,
      prototypeIdentity: state.prototypeIdentity,
      backend: state.backend,
      preview: {
        width: previewWidth,
        height: previewHeight,
        rgba: Array.from(preview),
      },
    };
  }

  return {
    setControls(next) {
      const previousGrid = gridSize;
      const previousMajorantGrid = majorantGridSize;
      controlsSnapshot = { ...controlsSnapshot, ...next };
      const requestedGrid = normalizeGridSize(controlsSnapshot.resolution);
      const requestedMajorantGrid = normalizeMajorantGridSize(controlsSnapshot.majorantGrid);
      if (device && (requestedGrid !== previousGrid || requestedMajorantGrid !== previousMajorantGrid)) {
        rebuildFluidState(requestedGrid, requestedMajorantGrid);
      } else {
        gridSize = requestedGrid;
        majorantGridSize = requestedMajorantGrid;
        state.simGrid = gridSize;
        state.simGridLabel = `${gridSize}^3 velocity-material-fire-microdetail-storage-buffer`;
        state.majorantGrid = majorantGridSize;
      }
      state.gridOverlay = controlsSnapshot.gridOverlay || 0;
      state.adaptiveRaymarch = controlsSnapshot.adaptiveRays ?? 0.65;
      state.occupancySkip = controlsSnapshot.occupancySkip ?? 0.35;
      state.majorantSkip = controlsSnapshot.majorantSkip ?? 0.70;
      state.majorantSmooth = controlsSnapshot.majorantSmooth ?? 0.85;
      state.majorantGuard = controlsSnapshot.majorantGuard ?? 0.75;
      state.majorantGrid = majorantGridSize;
    },
    async setActive(active) {
      if (active) {
        try {
          await ensureGpu();
          state.active = true;
          state.error = null;
          canvas.classList.add('active');
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(render);
          emitStatus({ phase: 'active' });
        } catch (err) {
          state.active = false;
          state.error = err?.message || String(err);
          state.backend = 'unavailable';
          canvas.classList.remove('active');
          emitStatus({ phase: 'error', error: state.error });
          throw err;
        }
      } else {
        state.active = false;
        canvas.classList.remove('active');
        cancelAnimationFrame(raf);
        emitStatus({ phase: 'inactive' });
      }
    },
    debugState() {
      return { ...state, controls: { ...controlsSnapshot } };
    },
    sampleFrame,
    dispose() {
      this.setActive(false);
      frameTexture?.destroy();
      destroyFluidState();
      destroyMajorantState();
      canvas.remove();
    },
  };
}
