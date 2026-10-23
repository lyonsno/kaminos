// Emission-weighted second moments of the undiffused light seed. A smooth
// extent proxy for the luminous source; neither its simulation box nor an
// exact silhouette. Runs once per field build, shared by all observers.
export const FIRE_EMISSION_EXTENT_WGSL = /* wgsl */`
var<workgroup> emissionMass: array<f32, 64>;
var<workgroup> emissionMean: array<vec3<f32>, 64>;
var<workgroup> emissionSquare: array<vec3<f32>, 64>;
@compute @workgroup_size(64)
fn csEmissionExtent(@builtin(local_invocation_index) tid: u32) {
  seatGridShape();
  let shape = vec3<u32>(IRRADIANCE_GRID, IRRADIANCE_GRID_Y, IRRADIANCE_GRID);
  var mass = 0.0;
  var mean = vec3<f32>(0.0);
  var square = vec3<f32>(0.0);
  for (var i = tid; i < shape.x * shape.y * shape.z; i += 64u) {
    let cell = vec3<u32>(i % shape.x, (i / shape.x) % shape.y, i / (shape.x * shape.y));
    let p = (vec3<f32>(cell) + 0.5) / vec3<f32>(shape);
    let lum = dot(max(irradianceSrc[i].rgb, vec3<f32>(0.0)), vec3<f32>(0.2126, 0.7152, 0.0722));
    mass += lum; mean += p * lum; square += p * p * lum;
  }
  emissionMass[tid] = mass; emissionMean[tid] = mean; emissionSquare[tid] = square;
  workgroupBarrier();
  for (var stride = 32u; stride > 0u; stride /= 2u) {
    if (tid < stride) {
      emissionMass[tid] += emissionMass[tid + stride];
      emissionMean[tid] += emissionMean[tid + stride];
      emissionSquare[tid] += emissionSquare[tid + stride];
    }
    workgroupBarrier();
  }
  if (tid == 0u) {
    let total = emissionMass[0];
    let center = emissionMean[0] / max(total, 1e-20);
    // Include each seed cell's finite support (uniform-cell variance).
    let variance = max(vec3<f32>(0.0), emissionSquare[0] / max(total, 1e-20) - center * center)
      + 1.0 / (12.0 * vec3<f32>(shape) * vec3<f32>(shape));
    textureStore(irradianceMetaOut, vec2<i32>(2, 0), vec4<f32>(center, select(0.0, 1.0, total > 0.0)));
    textureStore(irradianceMetaOut, vec2<i32>(3, 0), vec4<f32>(variance, 0.0));
  }
}
`;
