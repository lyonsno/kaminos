const ROUTE_IDENTITY = 'native-3d-compute-fluid-raymarch-v0';
const PROTOTYPE_IDENTITY = 'kaminos-volume-prototype-v0';
const DEFAULT_GRID_SIZE = 96;
const SUPPORTED_GRID_SIZES = [32, 48, 64, 96];
const FLUID_SLOTS_PER_CELL = 3;
const FLUID_COMPONENTS = FLUID_SLOTS_PER_CELL * 4;

function normalizeGridSize(value) {
  const requested = Number(value);
  if (SUPPORTED_GRID_SIZES.includes(requested)) return requested;
  return DEFAULT_GRID_SIZE;
}

function gridCellCount(gridSize) {
  return gridSize * gridSize * gridSize;
}

function fluidBufferBytes(gridSize) {
  return gridCellCount(gridSize) * FLUID_COMPONENTS * Float32Array.BYTES_PER_ELEMENT;
}

const WGSL = /* wgsl */`
override GRID: u32 = 64u;
const SLOTS_PER_CELL: u32 = 3u;

struct Uniforms {
  invViewProj: mat4x4<f32>,
  cameraPos_time: vec4<f32>,
  viewport_steps_density: vec4<f32>,
  fire_smoke_curl_speed: vec4<f32>,
  grid_overlay_debug: vec4<f32>,
  source_controls: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> fluidSrc: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> fluidDst: array<vec4<f32>>;

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
  let time = u.cameraPos_time.w;
  let backCell = cell - prev.xyz * (2.55 + speed * 0.55);
  let advected = sampleFluidSlot(backCell, 0u);
  let localMaterial = readSlot(cellI, 1u);
  var material = thermalAdvection(cell, prev.xyz, speed, localMaterial.y);
  var fireLayer = fireLayerAdvection(cell, prev.xyz, speed, localMaterial.y);
  var vel = advected.xyz * 0.982;
  var smoke = material.x * 0.990;
  var heat = material.y * 0.982;
  var fuel = material.z * 0.990;
  var materialDetail = material.w * 0.970;
  var flame = fireLayer.x * 0.938;
  var ember = fireLayer.y * 0.952;
  var flameDetail = fireLayer.z * 0.922;

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
  let confinement = vorticityConfinement(cellI, 0.034 + curl * 0.044);
  let detailForce = turbulentDetailForce(p, time) * (source + smoke * 0.26 + heat * 0.18) * (0.018 + curl * 0.010);
  let heatExpansion = thermalExpansionForce(cellI, heat, 0.048 + curl * 0.019);
  let projectionCorrection = pressureProjectionCorrection(cellI, projection);
  vel = vel + swirl * heat * (0.018 + 0.010 * curl) + swirl * source * 0.012;
  vel = vel + confinement * (0.35 + smoke * 0.34 + heat * 0.52);
  vel = vel + detailForce;
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
  flame = max(flame, fireBirth * 1.58 + heat * fuel * 0.060);
  ember = max(ember, fireBirth * 0.78 + flame * 0.22);
  flameDetail = max(flameDetail, (fireBirth * 1.16 + heatExpansion.y * 4.0) * (0.44 + 0.62 * breakup));

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
  let density = clamp(max(smoke * 1.08, heat * 0.42 + materialDetail * 0.22 + fuel * 0.10), 0.0, 2.2);
  vel = vel * mix(0.55, 1.0, wallFade);
  vel.y = max(vel.y, -0.015);
  fluidDst[base] = vec4<f32>(clamp(vel, vec3<f32>(-0.34), vec3<f32>(0.52)), density);
  fluidDst[base + 1u] = vec4<f32>(clamp(smoke, 0.0, 2.2), clamp(heat, 0.0, 2.4), clamp(fuel, 0.0, 1.8), clamp(materialDetail, 0.0, 1.8));
  fluidDst[base + 2u] = vec4<f32>(clamp(flame, 0.0, 2.4), clamp(ember, 0.0, 2.0), clamp(flameDetail, 0.0, 1.8), 0.0);
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
  let dt = (endT - startT) / steps;
  let jitter = hash31(vec3<f32>(floor(in.uv * u.viewport_steps_density.xy), floor(u.cameraPos_time.w * 19.0))) * dt;
  var t = startT + jitter;
  var trans = 1.0;
  var color = vec3<f32>(0.004, 0.005, 0.006);
  let entryP = ro + rd * startT;
  let exitP = ro + rd * endT;
  var gridAccum = max(gridLine(entryP), gridLine(exitP));

  for (var i = 0; i < 192; i = i + 1) {
    if (f32(i) >= steps || trans < 0.012) { break; }
    let p = ro + rd * t;
    let state = sampleWorldVelocity(p);
    let material = sampleWorldMaterial(p);
    let fireLayer = sampleWorldFireLayer(p);
    let velMag = length(state.xyz);
    let smokeDensity = material.x;
    let heat = material.y;
    let fuel = material.z;
    let materialDetail = material.w;
    let flame = fireLayer.x;
    let ember = fireLayer.y;
    let flameDetail = fireLayer.z;
    let flowDebug = clamp(u.source_controls.w, 0.0, 1.0);
    let sampleCell = vec3<i32>(floor(clamp((p * 0.5 + vec3<f32>(0.5)) * f32(GRID), vec3<f32>(0.0), vec3<f32>(f32(GRID) - 1.0))));
    let curlDebug = curlMagnitudeAtCell(sampleCell);
    let divDebug = abs(divergenceAtCell(sampleCell));
    let density = (smokeDensity * 0.96 + heat * 0.32 + materialDetail * 0.22) * u.viewport_steps_density.w;
    let y = clamp((p.y + 1.0) * 0.5, 0.0, 1.0);
    let fireGain = 0.42 + u.fire_smoke_curl_speed.x * 1.15;
    let temp = clamp(flame * 1.34 + ember * 0.62 + flameDetail * 0.42 + heat * 0.18 + velMag * 0.42, 0.0, 1.95) * fireGain;
    let smoke = smokeDensity * smoothstep(0.03, 0.92, y) * u.fire_smoke_curl_speed.y;
    let smokeAlpha = clamp((smoke * 0.050 + heat * 0.006 + materialDetail * 0.014) * dt * steps * u.viewport_steps_density.w, 0.0, 0.12);
    let fireAlpha = clamp((flame * 0.074 + ember * 0.040 + flameDetail * 0.030) * dt * steps * fireGain, 0.0, 0.17);
    let alpha = clamp(smokeAlpha + fireAlpha, 0.0, 0.18);
    let filament = smoothstep(0.05, 0.62, materialDetail) * (0.72 + 0.28 * sin(p.x * 22.0 + p.y * 31.0 - p.z * 19.0 + u.cameraPos_time.w * 3.0));
    let fireFilament = smoothstep(0.04, 0.82, flameDetail) * (0.62 + 0.38 * sin(p.x * 28.0 - p.y * 18.0 + p.z * 24.0 + u.cameraPos_time.w * 4.6));
    let fineShadow = 0.56 + 0.54 * filament;
    let smokeCol = vec3<f32>(0.28, 0.38, 0.42) * fineShadow * (0.50 + min(0.76, velMag * 6.0));
    let flameCol = fireColor(temp) * (0.30 + temp * 0.82 + fireFilament * 0.42);
    let fireMix = smoothstep(0.005, 0.052, fireAlpha) * smoothstep(0.08, 0.70, temp);
    var local = mix(smokeCol, flameCol, fireMix);
    let diagnosticColor = mix(vec3<f32>(0.08, 0.72, 0.95), vec3<f32>(1.0, 0.18, 0.08), smoothstep(0.010, 0.085, divDebug)) * (0.35 + smoothstep(0.012, 0.18, curlDebug));
    local = mix(local, diagnosticColor, flowDebug * smoothstep(0.015, 0.12, curlDebug + divDebug));
    color = color + trans * alpha * local;
    trans = trans * (1.0 - alpha);
    t = t + dt;
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
  const uniforms = new Float32Array(36);
  let gridSize = normalizeGridSize(getControls().resolution);
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
    simGridLabel: `${gridSize}^3 velocity-material-fire-storage-buffer`,
    gridOverlay: 0,
    lastFrameEnergy: 0,
    error: null,
  };

  let adapter = null;
  let device = null;
  let context = null;
  let pipeline = null;
  let readbackPipeline = null;
  let computePipeline = null;
  let bindGroups = [];
  let bindGroupLayout = null;
  let pipelineLayout = null;
  let shader = null;
  let uniformBuffer = null;
  let fluidBuffers = [];
  let currentFluid = 0;
  let frameTexture = null;
  let frameTextureSize = '';
  let format = null;
  let raf = 0;
  let controlsSnapshot = getControls();

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
        }
      }
    }
    return data;
  }

  function destroyFluidState() {
    for (const buffer of fluidBuffers) buffer.destroy();
    fluidBuffers = [];
    bindGroups = [];
  }

  function rebuildFluidState(nextGridSize = gridSize) {
    gridSize = normalizeGridSize(nextGridSize);
    destroyFluidState();
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
    const pipelineConstants = { GRID: gridSize };
    const makePipeline = (targetFormat, label) => device.createRenderPipeline({
      label,
      layout: pipelineLayout,
      vertex: { module: shader, entryPoint: 'vs' },
      fragment: { module: shader, entryPoint: 'fs', constants: pipelineConstants, targets: [{ format: targetFormat }] },
      primitive: { topology: 'triangle-list' },
    });
    pipeline = makePipeline(format, `kaminos volume canvas native-3d-compute-fluid-raymarch-v0 ${gridSize}^3`);
    readbackPipeline = makePipeline('rgba8unorm', `kaminos volume readback native-3d-compute-fluid-raymarch-v0 ${gridSize}^3`);
    computePipeline = device.createComputePipeline({
      label: `kaminos first fluid sim compute pipeline ${gridSize}^3`,
      layout: pipelineLayout,
      compute: { module: shader, entryPoint: 'cs', constants: pipelineConstants },
    });
    bindGroups = [
      device.createBindGroup({
        label: `kaminos fluid bind group ${gridSize}^3 A to B`,
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: fluidBuffers[0] } },
          { binding: 2, resource: { buffer: fluidBuffers[1] } },
        ],
      }),
      device.createBindGroup({
        label: `kaminos fluid bind group ${gridSize}^3 B to A`,
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: fluidBuffers[1] } },
          { binding: 2, resource: { buffer: fluidBuffers[0] } },
        ],
      }),
    ];
    currentFluid = 0;
    state.simStepCount = 0;
    state.simGrid = gridSize;
    state.simGridLabel = `${gridSize}^3 velocity-material-fire-storage-buffer`;
    emitStatus({ phase: 'grid-rebuilt' });
  }

  async function ensureGpu() {
    if (device) return;
    if (!navigator.gpu) {
      throw new Error('WebGPU unavailable');
    }
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('WebGPU adapter unavailable');
    device = await adapter.requestDevice();
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
      ],
    });
    pipelineLayout = device.createPipelineLayout({
      label: 'kaminos fluid pipeline layout',
      bindGroupLayouts: [bindGroupLayout],
    });
    device.pushErrorScope('validation');
    rebuildFluidState(controlsSnapshot.resolution);
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
    uniforms[29] = gridSize;
    uniforms[32] = controlsSnapshot.inputRadius || 0.08;
    uniforms[33] = controlsSnapshot.flowRate ?? 0.3;
    uniforms[34] = controlsSnapshot.projection ?? 0.65;
    uniforms[35] = controlsSnapshot.flowDebug || 0;
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);
    state.gridOverlay = controlsSnapshot.gridOverlay || 0;
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
    controls?.update?.();
    updateUniforms(now);
    const encoder = device.createCommandEncoder({ label: 'kaminos compute fluid frame' });
    encodeSim(encoder);
    encodeDraw(encoder, context.getCurrentTexture().createView(), 'kaminos volume canvas pass');
    device.queue.submit([encoder.finish()]);
    state.frameCount += 1;
    state.lastFrameEnergy = Math.min(9.999, state.simStepCount * 0.001 + 0.55 * controlsSnapshot.density + 0.35 * controlsSnapshot.fire);
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
    let velocitySum = 0;
    let curlSum = 0;
    let curlMax = 0;
    let divergenceSum = 0;
    let divergenceMax = 0;
    let liveVoxels = 0;
    const cells = gridCellCount(gridSize);
    const stride = Math.max(1, Math.floor(cells / 4096));
    const clampIndex = value => Math.max(0, Math.min(gridSize - 1, value));
    const velocityAt = (x, y, z) => {
      const cx = clampIndex(x);
      const cy = clampIndex(y);
      const cz = clampIndex(z);
      const i = (cx + cy * gridSize + cz * gridSize * gridSize) * FLUID_COMPONENTS;
      return [data[i], data[i + 1], data[i + 2]];
    };
    let samples = 0;
    for (let cell = 0; cell < cells; cell += stride) {
      const i = cell * FLUID_COMPONENTS;
      const x = cell % gridSize;
      const y = Math.floor(cell / gridSize) % gridSize;
      const z = Math.floor(cell / (gridSize * gridSize));
      const vx = data[i];
      const vy = data[i + 1];
      const vz = data[i + 2];
      const d = Math.max(data[i + 3], data[i + 4] * 0.9, data[i + 5] * 0.72);
      const heat = data[i + 5];
      const detail = data[i + 7];
      const fireLayer = Math.max(data[i + 8], data[i + 9], data[i + 10]);
      densitySum += d;
      densityMax = Math.max(densityMax, d);
      heatSum += heat;
      detailSum += detail;
      fireLayerSum += fireLayer;
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
      velocityMean: velocitySum / samples,
      curlMean: curlSum / samples,
      curlMax,
      divergenceMean: divergenceSum / samples,
      divergenceMax,
      liveVoxels,
    };
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
        effectiveRoute: state.effectiveRoute,
        prototypeIdentity: state.prototypeIdentity,
        backend: state.backend,
      };
    }
    await buffer.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(buffer.getMappedRange());
    let litPixels = 0;
    let fireLikePixels = 0;
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
    return {
      ok: true,
      width: state.width,
      height: state.height,
      meanLuma: totalLuma / Math.max(1, samples),
      litPixels,
      fireLikePixels,
      smokeLikePixels,
      frameCount: state.frameCount,
      simStepCount: state.simStepCount,
      simGrid: state.simGrid,
      simGridLabel: state.simGridLabel,
      gridOverlay: state.gridOverlay,
      simReadback,
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
      controlsSnapshot = { ...controlsSnapshot, ...next };
      const requestedGrid = normalizeGridSize(controlsSnapshot.resolution);
      if (device && requestedGrid !== previousGrid) {
        rebuildFluidState(requestedGrid);
      } else {
        gridSize = requestedGrid;
        state.simGrid = gridSize;
        state.simGridLabel = `${gridSize}^3 velocity-material-fire-storage-buffer`;
      }
      state.gridOverlay = controlsSnapshot.gridOverlay || 0;
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
      canvas.remove();
    },
  };
}
