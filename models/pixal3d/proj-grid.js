import { WEBGPU_BUFFER_USAGE as U } from '../../webgpu-inference-kit/src/core.js';

export const PIXAL3D_CROP_SCALE = 1.1;
export const PIXAL3D_DEFAULT_FOV_RAD = 0.8575560450553894;
export const PIXAL3D_PROJ_GRID_ROUTE = 'pixal3d.proj-grid.webgpu.v0';

const f = Math.fround;

export function computePixal3dDistanceFromFov({
  cameraAngleX = PIXAL3D_DEFAULT_FOV_RAD,
  meshScale = 1.0,
  imageResolution = 512,
  extendPixel = 0,
} = {}) {
  if (!Number.isFinite(cameraAngleX) || cameraAngleX <= 0 || cameraAngleX >= Math.PI) {
    throw new RangeError('cameraAngleX must be a finite radian angle in (0, pi)');
  }
  if (!Number.isFinite(meshScale) || meshScale <= 0) {
    throw new RangeError('meshScale must be a finite positive number');
  }
  if (!Number.isSafeInteger(imageResolution) || imageResolution < 1) {
    throw new RangeError('imageResolution must be a positive integer');
  }
  if (!Number.isFinite(extendPixel)) {
    throw new RangeError('extendPixel must be finite');
  }
  // Grid corner (-1, 0, 0) rotated by [[1,0,0],[0,0,-1],[0,1,0]] and scaled by 1 / (2 * meshScale).
  const xw = -1.0 / meshScale / 2.0;
  const yw = 0.0;
  const focalLength = 16.0 / Math.tan(cameraAngleX / 2.0);
  const fPixels = (focalLength * imageResolution) / 32.0;
  const xt = 0.0 - extendPixel;
  const xNdc = xt - imageResolution / 2.0;
  if (xNdc === 0) throw new RangeError('degenerate xNdc in computePixal3dDistanceFromFov');
  return (fPixels * xw) / xNdc - yw;
}

export function buildPixal3dProjGridPlan({
  gridResolution = 16,
  imageResolution = 512,
  featureHeight = 32,
  featureWidth = 32,
  channels = 1024,
  highResFeatureHeight,
  highResFeatureWidth,
  highResChannels,
  tokenRows,
  prefixTokens = 5,
} = {}) {
  if (!Number.isSafeInteger(gridResolution) || gridResolution < 2) {
    throw new RangeError('gridResolution must be an integer >= 2');
  }
  for (const [name, value] of Object.entries({ imageResolution, featureHeight, featureWidth, channels })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive integer`);
    }
  }
  if (!Number.isSafeInteger(prefixTokens) || prefixTokens < 0) {
    throw new RangeError('prefixTokens must be a non-negative integer');
  }
  if (tokenRows !== undefined && (!Number.isSafeInteger(tokenRows) || tokenRows < 1)) {
    throw new RangeError('tokenRows must be a positive integer');
  }
  const hasHighRes =
    highResFeatureHeight !== undefined ||
    highResFeatureWidth !== undefined ||
    highResChannels !== undefined;
  if (hasHighRes) {
    for (const [name, value] of Object.entries({ highResFeatureHeight, highResFeatureWidth, highResChannels })) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError(`${name} must be a positive integer when high-res features are configured`);
      }
    }
  }
  const rows = tokenRows ?? gridResolution ** 3;
  const outChannels = channels + (hasHighRes ? highResChannels : 0);
  if (!Number.isSafeInteger(rows * outChannels * 4) || rows * outChannels * 4 >= 2 ** 32) {
    throw new RangeError('projected conditioning exceeds WebGPU u32 byte addressing');
  }
  const stages = [
    ...(prefixTokens > 0 ? ['pixal3d-global-conditioning'] : []),
    'pixal3d-proj-grid-sample',
  ];
  return Object.freeze({
    gridResolution,
    imageResolution,
    featureHeight,
    featureWidth,
    channels,
    hasHighRes,
    highResFeatureHeight: hasHighRes ? highResFeatureHeight : null,
    highResFeatureWidth: hasHighRes ? highResFeatureWidth : null,
    highResChannels: hasHighRes ? highResChannels : 0,
    tokenRows: tokenRows ?? null,
    rows,
    prefixTokens,
    outChannels,
    conditioningTokens: prefixTokens + featureHeight * featureWidth,
    globalShape: prefixTokens > 0 ? Object.freeze([prefixTokens, channels]) : null,
    projectedShape: Object.freeze([rows, outChannels]),
    coordinateShape: tokenRows !== undefined ? Object.freeze([tokenRows, 3]) : null,
    stages: Object.freeze(stages),
    arithmetic: 'f32-perspective-projection-and-align-corners-false-border-bilinear',
  });
}

function sampleBilinearHwc(fmap, offsetTokens, H, W, C, uNdc, vNdc, out, outBase) {
  const x = f(f(f(uNdc + 1) * 0.5 * W) - 0.5);
  const y = f(f(f(vNdc + 1) * 0.5 * H) - 0.5);
  const x0Raw = Math.floor(x);
  const y0Raw = Math.floor(y);
  const wx = f(x - x0Raw);
  const wy = f(y - y0Raw);
  const x0 = Math.max(0, Math.min(W - 1, x0Raw));
  const x1 = Math.max(0, Math.min(W - 1, x0Raw + 1));
  const y0 = Math.max(0, Math.min(H - 1, y0Raw));
  const y1 = Math.max(0, Math.min(H - 1, y0Raw + 1));
  const w00 = f(f(1 - wx) * f(1 - wy));
  const w01 = f(wx * f(1 - wy));
  const w10 = f(f(1 - wx) * wy);
  const w11 = f(wx * wy);
  const b00 = (offsetTokens + y0 * W + x0) * C;
  const b01 = (offsetTokens + y0 * W + x1) * C;
  const b10 = (offsetTokens + y1 * W + x0) * C;
  const b11 = (offsetTokens + y1 * W + x1) * C;
  for (let c = 0; c < C; c++) {
    out[outBase + c] = f(
      f(f(fmap[b00 + c] * w00) + f(fmap[b01 + c] * w01)) +
      f(f(fmap[b10 + c] * w10) + f(fmap[b11 + c] * w11)),
    );
  }
}

function sampleBilinearBchw(fmap, H, W, C, uNdc, vNdc, out, outBase) {
  const x = f(f(f(uNdc + 1) * 0.5 * W) - 0.5);
  const y = f(f(f(vNdc + 1) * 0.5 * H) - 0.5);
  const x0Raw = Math.floor(x);
  const y0Raw = Math.floor(y);
  const wx = f(x - x0Raw);
  const wy = f(y - y0Raw);
  const x0 = Math.max(0, Math.min(W - 1, x0Raw));
  const x1 = Math.max(0, Math.min(W - 1, x0Raw + 1));
  const y0 = Math.max(0, Math.min(H - 1, y0Raw));
  const y1 = Math.max(0, Math.min(H - 1, y0Raw + 1));
  const w00 = f(f(1 - wx) * f(1 - wy));
  const w01 = f(wx * f(1 - wy));
  const w10 = f(f(1 - wx) * wy);
  const w11 = f(wx * wy);
  const hw = H * W;
  const i00 = y0 * W + x0;
  const i01 = y0 * W + x1;
  const i10 = y1 * W + x0;
  const i11 = y1 * W + x1;
  for (let c = 0; c < C; c++) {
    const plane = c * hw;
    out[outBase + c] = f(
      f(f(fmap[plane + i00] * w00) + f(fmap[plane + i01] * w01)) +
      f(f(fmap[plane + i10] * w10) + f(fmap[plane + i11] * w11)),
    );
  }
}

export function projectPixal3dGridCpu({
  features,
  highResFeatures,
  highResLayout = 'bchw',
  gridResolution = 16,
  imageResolution = 512,
  featureHeight = 32,
  featureWidth = 32,
  channels = 1024,
  highResFeatureHeight,
  highResFeatureWidth,
  highResChannels,
  prefixTokens = 0,
  coordinates,
  cameraAngleX = PIXAL3D_DEFAULT_FOV_RAD,
  distance,
  meshScale = 1.0,
} = {}) {
  const tokenRows = coordinates !== undefined ? coordinates.length / 3 : undefined;
  const plan = buildPixal3dProjGridPlan({
    gridResolution,
    imageResolution,
    featureHeight,
    featureWidth,
    channels,
    ...(highResFeatures !== undefined
      ? {
          highResFeatureHeight: highResFeatureHeight ?? 512,
          highResFeatureWidth: highResFeatureWidth ?? 512,
          highResChannels: highResChannels ?? channels,
        }
      : {}),
    ...(tokenRows !== undefined ? { tokenRows } : {}),
    prefixTokens,
  });
  if (!(features instanceof Float32Array) || features.length !== plan.conditioningTokens * plan.channels) {
    throw new TypeError(`features must be Float32Array of length ${plan.conditioningTokens * plan.channels}`);
  }
  if (!features.every(Number.isFinite)) throw new TypeError('features must be finite');
  if (plan.hasHighRes) {
    const expectedHr = plan.highResFeatureHeight * plan.highResFeatureWidth * plan.highResChannels;
    if (!(highResFeatures instanceof Float32Array) || highResFeatures.length !== expectedHr || !highResFeatures.every(Number.isFinite)) {
      throw new TypeError(`highResFeatures must be finite Float32Array of length ${expectedHr}`);
    }
    if (!['bchw', 'hwc'].includes(highResLayout)) {
      throw new TypeError('highResLayout must be bchw or hwc');
    }
  }
  if (coordinates !== undefined) {
    if (!(coordinates instanceof Int32Array) || coordinates.length % 3 !== 0) {
      throw new TypeError('coordinates must be Int32Array[N, 3]');
    }
    for (let i = 0; i < coordinates.length; i++) {
      if (coordinates[i] < 0 || coordinates[i] >= gridResolution) {
        throw new RangeError(`coordinate ${coordinates[i]} outside [0, ${gridResolution})`);
      }
    }
  }
  const effectiveDistance =
    distance ??
    computePixal3dDistanceFromFov({ cameraAngleX, meshScale, imageResolution });
  if (!Number.isFinite(cameraAngleX) || cameraAngleX <= 0 || cameraAngleX >= Math.PI) {
    throw new RangeError('finite cameraAngleX in (0, pi) required');
  }
  if (!Number.isFinite(effectiveDistance) || !Number.isFinite(meshScale) || meshScale <= 0) {
    throw new RangeError('finite distance and positive meshScale required');
  }

  const global =
    prefixTokens > 0 ? features.slice(0, prefixTokens * channels) : new Float32Array(0);
  const projected = new Float32Array(plan.rows * plan.outChannels);

  const fovHalf = f(f(cameraAngleX) / 2.0);
  const focalLength = f(16.0 / f(Math.tan(fovHalf)));
  const fPixels = f(f(focalLength * imageResolution) / 32.0);
  const halfRes = f(imageResolution / 2.0);
  const invRes = f(1.0 / imageResolution);
  const R = gridResolution;
  const denomR = f(R - 1);
  const scaleDenom = f(f(meshScale) * 2.0);
  const distF = f(effectiveDistance);

  for (let row = 0; row < plan.rows; row++) {
    let ix, iy, iz;
    if (coordinates !== undefined) {
      ix = coordinates[row * 3];
      iy = coordinates[row * 3 + 1];
      iz = coordinates[row * 3 + 2];
    } else {
      ix = Math.floor(row / (R * R));
      iy = Math.floor((row % (R * R)) / R);
      iz = row % R;
    }
    const gx = f(-1.0 + f((2.0 * ix) / denomR));
    const gy = f(-1.0 + f((2.0 * iy) / denomR));
    const gz = f(-1.0 + f((2.0 * iz) / denomR));
    // Blender rotation [[1,0,0],[0,0,-1],[0,1,0]] followed by w2c = inv(front_view_transform):
    // x_cam = gx / (2 * mesh_scale), y_cam = gy / (2 * mesh_scale), z_cam = gz / (2 * mesh_scale) - distance.
    const xCam = f(gx / scaleDenom);
    const yCam = f(gy / scaleDenom);
    const zCam = f(f(gz / scaleDenom) - distF);
    const negZ = f(-zCam + f(1e-8));
    const xNdc = f(f(fPixels * xCam) / negZ);
    const yNdc = f(f(fPixels * yCam) / negZ);
    const xPixel = f(xNdc + halfRes);
    const yPixel = f(-yNdc + halfRes);
    const uNdc = f(f(f(xPixel + 0.5) * invRes * 2.0) - 1.0);
    const vNdc = f(f(f(yPixel + 0.5) * invRes * 2.0) - 1.0);

    const outBase = row * plan.outChannels;
    sampleBilinearHwc(
      features,
      prefixTokens,
      featureHeight,
      featureWidth,
      channels,
      uNdc,
      vNdc,
      projected,
      outBase,
    );
    if (plan.hasHighRes) {
      if (highResLayout === 'bchw') {
        sampleBilinearBchw(
          highResFeatures,
          plan.highResFeatureHeight,
          plan.highResFeatureWidth,
          plan.highResChannels,
          uNdc,
          vNdc,
          projected,
          outBase + channels,
        );
      } else {
        sampleBilinearHwc(
          highResFeatures,
          0,
          plan.highResFeatureHeight,
          plan.highResFeatureWidth,
          plan.highResChannels,
          uNdc,
          vNdc,
          projected,
          outBase + channels,
        );
      }
    }
  }
  return { global, projected, plan };
}

function dispatch1D(count, workgroupSize, limit) {
  const groups = Math.ceil(count / workgroupSize);
  const x = Math.min(groups, limit);
  const y = Math.ceil(groups / x);
  if (y > limit) throw new RangeError('requested tensor exceeds device dispatch capacity');
  return [x, y, 1];
}

const globalSliceShader = count => `
@group(0) @binding(0) var<storage, read> conditioning: array<f32>;
@group(0) @binding(1) var<storage, read_write> global_out: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) grid: vec3<u32>) {
  let i = gid.x + gid.y * grid.x * 64u;
  if (i < ${count}u) {
    global_out[i] = conditioning[i];
  }
}`;

function projGridSampleShader(plan) {
  const total = plan.rows * plan.outChannels;
  const R = plan.gridResolution;
  const rr = R * R;
  const coordLookup = plan.tokenRows !== null
    ? `let ix = f32(coords[row * 3u]);
  let iy = f32(coords[row * 3u + 1u]);
  let iz = f32(coords[row * 3u + 2u]);`
    : `let ix = f32(row / ${rr}u);
  let iy = f32((row % ${rr}u) / ${R}u);
  let iz = f32(row % ${R}u);`;

  const bindings = [
    '@group(0) @binding(0) var<storage, read> conditioning: array<f32>;',
    '@group(0) @binding(1) var<storage, read> camera_controls: array<f32>;',
  ];
  let nextBinding = 2;
  let hrBinding = -1;
  let coordBinding = -1;
  if (plan.hasHighRes) {
    hrBinding = nextBinding++;
    bindings.push(`@group(0) @binding(${hrBinding}) var<storage, read> high_res: array<f32>;`);
  }
  if (plan.tokenRows !== null) {
    coordBinding = nextBinding++;
    bindings.push(`@group(0) @binding(${coordBinding}) var<storage, read> coords: array<i32>;`);
  }
  const outBinding = nextBinding++;
  bindings.push(`@group(0) @binding(${outBinding}) var<storage, read_write> projected: array<f32>;`);

  return `
${bindings.join('\n')}
fn sample_hwc(offset_tokens: u32, H: u32, W: u32, C: u32, c: u32, u_ndc: f32, v_ndc: f32) -> f32 {
  let x = (u_ndc + 1.0) * 0.5 * f32(W) - 0.5;
  let y = (v_ndc + 1.0) * 0.5 * f32(H) - 0.5;
  let x0_f = floor(x);
  let y0_f = floor(y);
  let wx = x - x0_f;
  let wy = y - y0_f;
  let max_x = i32(W) - 1;
  let max_y = i32(H) - 1;
  let x0 = u32(clamp(i32(x0_f), 0, max_x));
  let x1 = u32(clamp(i32(x0_f) + 1, 0, max_x));
  let y0 = u32(clamp(i32(y0_f), 0, max_y));
  let y1 = u32(clamp(i32(y0_f) + 1, 0, max_y));
  let w00 = (1.0 - wx) * (1.0 - wy);
  let w01 = wx * (1.0 - wy);
  let w10 = (1.0 - wx) * wy;
  let w11 = wx * wy;
  let b00 = (offset_tokens + y0 * W + x0) * C + c;
  let b01 = (offset_tokens + y0 * W + x1) * C + c;
  let b10 = (offset_tokens + y1 * W + x0) * C + c;
  let b11 = (offset_tokens + y1 * W + x1) * C + c;
  return (conditioning[b00] * w00 + conditioning[b01] * w01) + (conditioning[b10] * w10 + conditioning[b11] * w11);
}
${plan.hasHighRes ? `
fn sample_bchw(H: u32, W: u32, c: u32, u_ndc: f32, v_ndc: f32) -> f32 {
  let x = (u_ndc + 1.0) * 0.5 * f32(W) - 0.5;
  let y = (v_ndc + 1.0) * 0.5 * f32(H) - 0.5;
  let x0_f = floor(x);
  let y0_f = floor(y);
  let wx = x - x0_f;
  let wy = y - y0_f;
  let max_x = i32(W) - 1;
  let max_y = i32(H) - 1;
  let x0 = u32(clamp(i32(x0_f), 0, max_x));
  let x1 = u32(clamp(i32(x0_f) + 1, 0, max_x));
  let y0 = u32(clamp(i32(y0_f), 0, max_y));
  let y1 = u32(clamp(i32(y0_f) + 1, 0, max_y));
  let w00 = (1.0 - wx) * (1.0 - wy);
  let w01 = wx * (1.0 - wy);
  let w10 = (1.0 - wx) * wy;
  let w11 = wx * wy;
  let plane = c * H * W;
  let i00 = plane + y0 * W + x0;
  let i01 = plane + y0 * W + x1;
  let i10 = plane + y1 * W + x0;
  let i11 = plane + y1 * W + x1;
  return (high_res[i00] * w00 + high_res[i01] * w01) + (high_res[i10] * w10 + high_res[i11] * w11);
}` : ''}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) grid: vec3<u32>) {
  let index = gid.x + gid.y * grid.x * 64u;
  if (index >= ${total}u) { return; }
  let row = index / ${plan.outChannels}u;
  let channel = index % ${plan.outChannels}u;
  ${coordLookup}
  let denom_r = f32(${R - 1});
  let gx = -1.0 + (2.0 * ix) / denom_r;
  let gy = -1.0 + (2.0 * iy) / denom_r;
  let gz = -1.0 + (2.0 * iz) / denom_r;
  let f_pixels = camera_controls[0];
  let distance = camera_controls[1];
  let scale_denom = camera_controls[2];
  let half_res = camera_controls[3];
  let inv_res = camera_controls[4];
  let x_cam = gx / scale_denom;
  let y_cam = gy / scale_denom;
  let z_cam = gz / scale_denom - distance;
  let neg_z = -z_cam + 1e-8;
  let x_ndc = (f_pixels * x_cam) / neg_z;
  let y_ndc = (f_pixels * y_cam) / neg_z;
  let x_pixel = x_ndc + half_res;
  let y_pixel = -y_ndc + half_res;
  let u_ndc = (x_pixel + 0.5) * inv_res * 2.0 - 1.0;
  let v_ndc = (y_pixel + 0.5) * inv_res * 2.0 - 1.0;
  if (channel < ${plan.channels}u) {
    projected[index] = sample_hwc(${plan.prefixTokens}u, ${plan.featureHeight}u, ${plan.featureWidth}u, ${plan.channels}u, channel, u_ndc, v_ndc);
  }${plan.hasHighRes ? ` else {
    projected[index] = sample_bchw(${plan.highResFeatureHeight}u, ${plan.highResFeatureWidth}u, channel - ${plan.channels}u, u_ndc, v_ndc);
  }` : ''}
}`;
}

export function createPixal3dProjGridAdapter({
  route,
  config = {},
  conditioningTensor,
  highResTensor,
  coordinateTensor,
} = {}) {
  const runtime = route?.runtime;
  if (!runtime?.createTensor || !runtime?.uploadTensor || !runtime?.defineComputeKernel || !runtime?.runKernel) {
    throw new TypeError('registered WebGPU route runtime required for Pixal3D ProjGrid');
  }
  const plan = buildPixal3dProjGridPlan(config);
  const expectedCondShapes = [
    JSON.stringify([1, plan.conditioningTokens, plan.channels]),
    JSON.stringify([plan.conditioningTokens, plan.channels]),
  ];
  const expectedCondBytes = plan.conditioningTokens * plan.channels * 4;
  if (
    !conditioningTensor?.buffer ||
    conditioningTensor.dtype !== 'f32' ||
    !(conditioningTensor.usage & U.storage) ||
    !expectedCondShapes.includes(JSON.stringify(conditioningTensor.shape)) ||
    (conditioningTensor.byteLength !== undefined && conditioningTensor.byteLength !== expectedCondBytes)
  ) {
    throw new TypeError('complete resident F32 DINO conditioning tensor required');
  }
  if (plan.hasHighRes) {
    const expectedHrShapes = [
      JSON.stringify([1, plan.highResChannels, plan.highResFeatureHeight, plan.highResFeatureWidth]),
      JSON.stringify([plan.highResChannels, plan.highResFeatureHeight, plan.highResFeatureWidth]),
    ];
    const expectedHrBytes = plan.highResChannels * plan.highResFeatureHeight * plan.highResFeatureWidth * 4;
    if (
      !highResTensor?.buffer ||
      highResTensor.dtype !== 'f32' ||
      !(highResTensor.usage & U.storage) ||
      !expectedHrShapes.includes(JSON.stringify(highResTensor.shape)) ||
      (highResTensor.byteLength !== undefined && highResTensor.byteLength !== expectedHrBytes)
    ) {
      throw new TypeError('complete resident F32 NAF high-res tensor required');
    }
  } else if (highResTensor !== undefined) {
    throw new TypeError('highResTensor supplied without high-res plan configuration');
  }
  if (plan.tokenRows !== null) {
    const expectedCoordBytes = plan.tokenRows * 3 * 4;
    if (
      !coordinateTensor?.buffer ||
      coordinateTensor.dtype !== 'i32' ||
      !(coordinateTensor.usage & U.storage) ||
      JSON.stringify(coordinateTensor.shape) !== JSON.stringify(plan.coordinateShape) ||
      (coordinateTensor.byteLength !== undefined && coordinateTensor.byteLength !== expectedCoordBytes)
    ) {
      throw new TypeError('complete resident I32[N,3] coordinateTensor required for sparse ProjGrid');
    }
  } else if (coordinateTensor !== undefined) {
    throw new TypeError('coordinateTensor supplied without tokenRows configuration');
  }

  const maxBinding = runtime.device?.limits?.maxStorageBufferBindingSize ?? 134217728;
  const projectedBytes = plan.rows * plan.outChannels * 4;
  if (projectedBytes > maxBinding) {
    throw new RangeError('projected conditioning tensor exceeds device maxStorageBufferBindingSize');
  }
  const wgLimit = runtime.device?.limits?.maxComputeWorkgroupsPerDimension ?? 65535;
  const owned = [];
  let disposed = false;
  let running = false;
  const allocate = (name, shape, dtype = 'f32') => {
    const t = runtime.createTensor({
      name: `pixal3d.proj-grid.${name}`,
      shape,
      dtype,
      usage: U.storage | U.copyDst | U.copySrc,
    });
    owned.push(t);
    return t;
  };
  const cleanup = () => {
    for (const t of owned) t.buffer?.destroy?.();
  };

  try {
    const cameraControls = allocate('camera-controls', [8]);
    const globalConditioning =
      plan.prefixTokens > 0 ? allocate('global', plan.globalShape) : null;
    const projectedConditioning = allocate('projected', plan.projectedShape);

    const operations = [];
    if (globalConditioning) {
      const globalCount = plan.prefixTokens * plan.channels;
      operations.push({
        stage: 'pixal3d-global-conditioning',
        dispatch: dispatch1D(globalCount, 64, wgLimit),
        kernel: runtime.defineComputeKernel({
          name: 'pixal3d.global-conditioning',
          code: globalSliceShader(globalCount),
          bindings: [
            { name: 'conditioning', resource: conditioningTensor, access: 'read-only-storage' },
            { name: 'global_out', resource: globalConditioning, access: 'storage' },
          ],
        }),
      });
    }

    const sampleBindings = [
      { name: 'conditioning', resource: conditioningTensor, access: 'read-only-storage' },
      { name: 'camera_controls', resource: cameraControls, access: 'read-only-storage' },
    ];
    if (plan.hasHighRes) {
      sampleBindings.push({ name: 'high_res', resource: highResTensor, access: 'read-only-storage' });
    }
    if (plan.tokenRows !== null) {
      sampleBindings.push({ name: 'coords', resource: coordinateTensor, access: 'read-only-storage' });
    }
    sampleBindings.push({ name: 'projected', resource: projectedConditioning, access: 'storage' });

    operations.push({
      stage: 'pixal3d-proj-grid-sample',
      dispatch: dispatch1D(plan.rows * plan.outChannels, 64, wgLimit),
      kernel: runtime.defineComputeKernel({
        name: 'pixal3d.proj-grid-sample',
        code: projGridSampleShader(plan),
        bindings: sampleBindings,
      }),
    });

    const outputs = Object.freeze({
      ...(globalConditioning ? { globalConditioning } : {}),
      projectedConditioning,
    });

    return Object.freeze({
      plan,
      runtime,
      routeId: route.routeId,
      inputs: Object.freeze({
        conditioning: conditioningTensor,
        ...(highResTensor ? { highRes: highResTensor } : {}),
        ...(coordinateTensor ? { coordinates: coordinateTensor } : {}),
      }),
      outputs,
      async run(
        {
          cameraAngleX = PIXAL3D_DEFAULT_FOV_RAD,
          distance,
          meshScale = 1.0,
        } = {},
        invocation,
      ) {
        if (disposed) throw new Error('Pixal3D ProjGrid adapter disposed');
        if (running) throw new Error('Pixal3D ProjGrid adapter in use');
        if (!Number.isFinite(cameraAngleX) || cameraAngleX <= 0 || cameraAngleX >= Math.PI) {
          throw new RangeError('finite cameraAngleX in (0, pi) required');
        }
        if (!Number.isFinite(meshScale) || meshScale <= 0) {
          throw new RangeError('finite positive meshScale required');
        }
        const effectiveDistance =
          distance ??
          computePixal3dDistanceFromFov({
            cameraAngleX,
            meshScale,
            imageResolution: plan.imageResolution,
          });
        if (!Number.isFinite(effectiveDistance)) {
          throw new RangeError('finite camera distance required');
        }
        const fovHalf = f(f(cameraAngleX) / 2.0);
        const focalLength = f(16.0 / f(Math.tan(fovHalf)));
        const fPixels = f(f(focalLength * plan.imageResolution) / 32.0);
        const scaleDenom = f(f(meshScale) * 2.0);
        const halfRes = f(plan.imageResolution / 2.0);
        const invRes = f(1.0 / plan.imageResolution);
        running = true;
        try {
          runtime.uploadTensor(
            cameraControls,
            new Float32Array([fPixels, f(effectiveDistance), scaleDenom, halfRes, invRes, 0, 0, 0]),
          );
          for (let i = 0; i < operations.length; i++) {
            const op = operations[i];
            await runtime.runKernel(op.kernel, {
              stage: op.stage,
              dispatch: op.dispatch,
              schedulerInvocation: invocation,
              yieldAfter: i === operations.length - 1,
            });
          }
          return outputs;
        } finally {
          running = false;
        }
      },
      releaseProjectedConditioning() {
        if (running) throw new Error('Pixal3D ProjGrid adapter in use');
        projectedConditioning?.buffer?.destroy?.();
        cameraControls?.buffer?.destroy?.();
      },
      dispose() {
        if (running) throw new Error('Pixal3D ProjGrid adapter in use');
        if (disposed) return;
        disposed = true;
        cleanup();
      },
    });
  } catch (error) {
    cleanup();
    throw error;
  }
}
