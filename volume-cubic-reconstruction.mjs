// Uniform-grid Catmull-Rom basis; camera sampling only, never advection.
export function catmullRomWeights(t) {
  const t2 = t * t, t3 = t2 * t;
  return [
    -.5 * t + t2 - .5 * t3,
    1 - 2.5 * t2 + 1.5 * t3,
    .5 * t + 2 * t2 - 1.5 * t3,
    -.5 * t2 + .5 * t3,
  ].map(value => value === 0 ? 0 : value);
}

export const CUBIC_RECONSTRUCTION_WGSL = /* wgsl */ `
fn cameraCubicEnabled() -> bool {
  return u.reserved_render_controls.y > 0.5;
}

fn cameraCubicWeights(t: f32) -> vec4<f32> {
  let t2 = t * t;
  let t3 = t2 * t;
  return vec4<f32>(
    -0.5 * t + t2 - 0.5 * t3,
    1.0 - 2.5 * t2 + 1.5 * t3,
    0.5 * t + 2.0 * t2 - 1.5 * t3,
    -0.5 * t2 + 0.5 * t3
  );
}

// kind 0..3: packed fluid slots; 4: front; 5: boundary sidecar.
fn sampleWorldCameraCubic(p: vec3<f32>, kind: u32) -> vec4<f32> {
  let q = clamp(worldToCell(p) - vec3<f32>(0.5), vec3<f32>(0.0),
    vec3<f32>(f32(GRID) - 1.001, f32(GRID_Y) - 1.001, f32(GRID) - 1.001));
  let base = vec3<i32>(floor(q)) - vec3<i32>(1);
  let f = fract(q);
  let wx = cameraCubicWeights(f.x);
  let wy = cameraCubicWeights(f.y);
  let wz = cameraCubicWeights(f.z);
  var value = vec4<f32>(0.0);
  var lo = vec4<f32>(1e30);
  var hi = vec4<f32>(-1e30);
  for (var z = 0; z < 4; z = z + 1) {
    for (var y = 0; y < 4; y = y + 1) {
      for (var x = 0; x < 4; x = x + 1) {
        let cell = base + vec3<i32>(x, y, z);
        var tap: vec4<f32>;
        if (kind < 4u) { tap = readSlot(cell, kind); }
        else if (kind == 4u) { tap = vec4<f32>(readFrontField(cell)); }
        else { tap = sampleBoundarySidecarCell(cell); }
        value = value + tap * wx[x] * wy[y] * wz[z];
        // No new extrema or support outside the eight-cell admission stencil.
        if (x >= 1 && x <= 2 && y >= 1 && y <= 2 && z >= 1 && z <= 2) {
          lo = min(lo, tap);
          hi = max(hi, tap);
        }
      }
    }
  }
  return clamp(value, lo, hi);
}

fn sampleWorldCameraSidecar(p: vec3<f32>) -> vec4<f32> {
  if (cameraCubicEnabled()) { return sampleWorldCameraCubic(p, 5u); }
  return sampleWorldBoundarySidecar(p);
}
`;
