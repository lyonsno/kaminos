// Static browser bridge copied from the point-triangle submodule shape in /Users/noahlyons/dev/webgpu-geometry-primitives@3a8441b.
// Kaminos currently runs as a no-bundler static app, so the clay route imports
// this point-triangle subset until a package install/import-map path exists.
export const POINT_TRIANGLE_FEATURE = Object.freeze({
  FACE: 0,
  VERTEX_0: 1,
  VERTEX_1: 2,
  VERTEX_2: 3,
  EDGE_0_1: 4,
  EDGE_1_2: 5,
  EDGE_2_0: 6,
});

export const POINT_TRIANGLE_SOURCE_CONTRACT = 'kaolin-kpm-001-forward-distance-feature-codes';
export const POINT_TRIANGLE_JOB_FLOATS = 16;
export const POINT_TRIANGLE_RESULT_BYTES = 16;
export const POINT_TRIANGLE_PACKAGE_COMMIT = '3a8441b';
export const POINT_TRIANGLE_IMPORT_PATH = './vendor/webgpu-geometry-primitives/point-triangle.js';

function assertVec3(value, name) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new TypeError(`${name} must be a finite vec3 array`);
  }
}

function assertTriangle(value, name) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${name} must contain three vec3 vertices`);
  }
  value.forEach((vertex, index) => assertVec3(vertex, `${name}[${index}]`));
}

export function packPointTriangleDistanceJobs(jobs) {
  if (!Array.isArray(jobs)) {
    throw new TypeError('jobs must be an array');
  }
  const packed = new Float32Array(jobs.length * POINT_TRIANGLE_JOB_FLOATS);
  jobs.forEach((job, index) => {
    assertVec3(job.point, `jobs[${index}].point`);
    assertTriangle(job.triangle, `jobs[${index}].triangle`);
    const triangleIndex = job.triangleIndex ?? index;
    if (!Number.isInteger(triangleIndex) || triangleIndex < 0 || triangleIndex > 0x00ffffff) {
      throw new RangeError(`jobs[${index}].triangleIndex must be an integer in [0, 16777215]`);
    }
    const offset = index * POINT_TRIANGLE_JOB_FLOATS;
    const [a, b, c] = job.triangle;
    packed.set([...job.point, 0], offset);
    packed.set([...a, triangleIndex], offset + 4);
    packed.set([...b, 0], offset + 8);
    packed.set([...c, 0], offset + 12);
  });
  return packed;
}

export const pointTriangleDistanceWgsl = /* wgsl */`
struct PointTriangleJob {
  point: vec4f,
  triA: vec4f,
  triB: vec4f,
  triC: vec4f,
};

struct PointTriangleResult {
  distanceSq: f32,
  feature: u32,
  triangleIndex: u32,
  _pad: u32,
};

@group(0) @binding(0) var<storage, read> jobs: array<PointTriangleJob>;
@group(0) @binding(1) var<storage, read_write> results: array<PointTriangleResult>;

fn sq_len(v: vec3f) -> f32 {
  return dot(v, v);
}

fn closest_segment(p: vec3f, a: vec3f, b: vec3f) -> vec3f {
  let ab = b - a;
  let denom = max(dot(ab, ab), 0.00000001);
  let t = clamp(dot(p - a, ab) / denom, 0.0, 1.0);
  return a + ab * t;
}

@compute @workgroup_size(64)
fn point_triangle_distance_main(@builtin(global_invocation_id) global_id: vec3u) {
  let i = global_id.x;
  if (i >= arrayLength(&jobs)) {
    return;
  }
  let job = jobs[i];
  let p = job.point.xyz;
  let a = job.triA.xyz;
  let b = job.triB.xyz;
  let c = job.triC.xyz;
  var best = sq_len(p - a);
  var feature = 1u;
  let d1 = sq_len(p - b);
  if (d1 < best) {
    best = d1;
    feature = 2u;
  }
  let d2 = sq_len(p - c);
  if (d2 < best) {
    best = d2;
    feature = 3u;
  }
  let e01 = sq_len(p - closest_segment(p, a, b));
  if (e01 < best) {
    best = e01;
    feature = 4u;
  }
  let e12 = sq_len(p - closest_segment(p, b, c));
  if (e12 < best) {
    best = e12;
    feature = 5u;
  }
  let e20 = sq_len(p - closest_segment(p, c, a));
  if (e20 < best) {
    best = e20;
    feature = 6u;
  }
  let n = cross(b - a, c - a);
  let nn = dot(n, n);
  if (nn > 0.00000001) {
    let projected = p - n * (dot(p - a, n) / nn);
    let v0 = b - a;
    let v1 = c - a;
    let v2 = projected - a;
    let d00 = dot(v0, v0);
    let d01 = dot(v0, v1);
    let d11 = dot(v1, v1);
    let d20 = dot(v2, v0);
    let d21 = dot(v2, v1);
    let denom = d00 * d11 - d01 * d01;
    if (abs(denom) > 0.00000001) {
      let bv = (d11 * d20 - d01 * d21) / denom;
      let bw = (d00 * d21 - d01 * d20) / denom;
      let bu = 1.0 - bv - bw;
      let faceDist = sq_len(p - projected);
      if (bu >= -0.0000001 && bv >= -0.0000001 && bw >= -0.0000001 && faceDist < best) {
        best = faceDist;
        feature = 0u;
      }
    }
  }
  results[i] = PointTriangleResult(best, feature, u32(job.triA.w), 0u);
}
`;
