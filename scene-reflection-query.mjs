// Coordinates are view-space meters and top-left texture UVs. A world-space
// provider can later return the same hit without changing the material sampler.
export const SCENE_REFLECTION_QUERY_WGSL = /* wgsl */`
struct SceneReflectionHit {
  radiance: vec3<f32>, confidence: f32,
  position: vec3<f32>, distance: f32,
  uv: vec2<f32>, kind: u32,
}
fn reflectionViewPosition(uv: vec2<f32>, depth: f32, inverseProjection: mat4x4<f32>) -> vec3<f32> {
  let p = inverseProjection * vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
  return p.xyz / p.w;
}
fn reflectionRandom(pixel: vec2<u32>, frame: u32) -> vec2<f32> {
  var v = pixel.x * 1973u + pixel.y * 9277u + frame * 26699u + 911u;
  v = (v ^ (v >> 16u)) * 2246822519u; v = (v ^ (v >> 13u)) * 3266489917u;
  let x = f32(v & 16777215u) / 16777216.0;
  v = (v ^ (v >> 16u)) * 2246822519u;
  return vec2<f32>(x, f32(v & 16777215u) / 16777216.0);
}
// Spherical-cap visible-GGX sampling, in a frame whose Z axis is the normal.
fn reflectionGGX(view: vec3<f32>, normal: vec3<f32>, perceptualRoughness: f32, xi: vec2<f32>) -> vec3<f32> {
  let helper = select(vec3<f32>(0.0, 0.0, 1.0), vec3<f32>(1.0, 0.0, 0.0), abs(normal.z) > 0.999);
  let tangent = normalize(cross(helper, normal)); let bitangent = cross(normal, tangent);
  let v = vec3<f32>(dot(view, tangent), dot(view, bitangent), max(dot(view, normal), 0.0001));
  let alpha = max(perceptualRoughness * perceptualRoughness, 0.001);
  let stretched = normalize(vec3<f32>(alpha * v.xy, v.z));
  let z = 1.0 - xi.y * (1.0 + stretched.z);
  let r = sqrt(max(1.0 - z * z, 0.0)); let phi = 6.28318530718 * xi.x;
  let cap = vec3<f32>(r * cos(phi), r * sin(phi), z);
  let h = cap + stretched;
  let halfVector = normalize(vec3<f32>(alpha * h.xy, max(h.z, 0.00001)));
  let outgoing = reflect(-v, halfVector);
  return normalize(tangent * outgoing.x + bitangent * outgoing.y + normal * outgoing.z);
}
// Visible-GGX reflection-direction density. The ray represents a finite solid
// angle, rather than one arbitrarily bright source texel. The reconstruction's
// centre/neighbor weights (1 and eight .5s) give 25/3 effective spatial samples.
fn reflectionSourceLevel(view: vec3<f32>, normal: vec3<f32>, direction: vec3<f32>, roughness: f32,
  hitPosition: vec3<f32>, hitNormal: vec3<f32>, distance: f32,
  projection: mat4x4<f32>, dimensions: vec2<u32>) -> f32 {
  let alpha = max(roughness * roughness, 0.001);
  let a2 = alpha * alpha;
  let halfVector = normalize(view + direction);
  let nv = max(dot(normal, view), 0.0001);
  let nh = max(dot(normal, halfVector), 0.0);
  let denominator = nh * nh * (a2 - 1.0) + 1.0;
  let distribution = a2 / (3.14159265359 * denominator * denominator);
  let masking = 2.0 * nv / (nv + sqrt(a2 + (1.0 - a2) * nv * nv));
  let pdf = max(distribution * masking / (4.0 * nv), 0.000001);
  let focal = vec2<f32>(abs(projection[0][0]), abs(projection[1][1])) * vec2<f32>(dimensions) * 0.5;
  let cameraCosine = abs(dot(hitNormal, normalize(-hitPosition)));
  let rayCosine = max(abs(dot(hitNormal, direction)), 0.0001);
  let area = distance * distance * focal.x * focal.y * cameraCosine /
    ((25.0 / 3.0) * pdf * hitPosition.z * hitPosition.z * rayCosine);
  return max(0.0, 0.5 * log2(max(area, 1.0)));
}
fn traceSceneReflection(
  origin: vec3<f32>, direction: vec3<f32>,
  depthMap: texture_depth_2d, colorMap: texture_2d<f32>, colorSampler: sampler, normalMap: texture_2d<f32>,
  projection: mat4x4<f32>, inverseProjection: mat4x4<f32>,
  maxDistance: f32, thickness: f32, nearPlane: f32, steps: u32,
  view: vec3<f32>, normal: vec3<f32>, roughness: f32
) -> SceneReflectionHit {
  var hit: SceneReflectionHit;
  hit.radiance = vec3<f32>(0.0); hit.confidence = 0.0;
  hit.position = origin; hit.distance = 0.0; hit.uv = vec2<f32>(0.0); hit.kind = 0u;
  var rayLength = maxDistance;
  if (direction.z > 0.0) { rayLength = min(rayLength, (-nearPlane * 1.01 - origin.z) / direction.z); }
  if (rayLength <= 0.0) { return hit; }
  let end = origin + direction * rayLength;
  let a = projection * vec4<f32>(origin, 1.0); let b = projection * vec4<f32>(end, 1.0);
  let startUV = vec2<f32>(a.x / a.w * 0.5 + 0.5, 0.5 - a.y / a.w * 0.5);
  let endUV = vec2<f32>(b.x / b.w * 0.5 + 0.5, 0.5 - b.y / b.w * 0.5);
  let deltaUV = endUV - startUV;
  var clipEnd = 1.0;
  for (var axis = 0u; axis < 2u; axis++) {
    if (deltaUV[axis] > 0.0) { clipEnd = min(clipEnd, (0.9999 - startUV[axis]) / deltaUV[axis]); }
    if (deltaUV[axis] < 0.0) { clipEnd = min(clipEnd, (0.0001 - startUV[axis]) / deltaUV[axis]); }
  }
  if (clipEnd <= 0.0) { return hit; }
  let dimensions = vec2<i32>(textureDimensions(depthMap));
  let projectedPixels = length(deltaUV * clipEnd * vec2<f32>(dimensions));
  if (projectedPixels < 1.0) { return hit; }
  let count = min(steps, max(1u, u32(ceil(projectedPixels))));
  var priorT = 0.0; var priorDelta = -thickness;
  for (var i = 1u; i <= count; i++) {
    let progress = f32(i) / f32(count); let t = clipEnd * progress * progress;
    let q = startUV + deltaUV * t;
    let pixel = clamp(vec2<i32>(q * vec2<f32>(dimensions)), vec2<i32>(0), dimensions - vec2<i32>(1));
    let depth = textureLoad(depthMap, pixel, 0);
    let rayZ = mix(origin.z / a.w, end.z / b.w, t) / mix(1.0 / a.w, 1.0 / b.w, t);
    let surface = reflectionViewPosition(q, depth, inverseProjection);
    let difference = surface.z - rayZ;
    if (depth < 1.0 && difference >= 0.0 && priorDelta < 0.0) {
      var lo = priorT; var hi = t;
      for (var refine = 0u; refine < 6u; refine++) {
        let mid = (lo + hi) * 0.5; let sampleUV = startUV + deltaUV * mid;
        let samplePixel = clamp(vec2<i32>(sampleUV * vec2<f32>(dimensions)), vec2<i32>(0), dimensions - vec2<i32>(1));
        let d = textureLoad(depthMap, samplePixel, 0);
        let z = mix(origin.z / a.w, end.z / b.w, mid) / mix(1.0 / a.w, 1.0 / b.w, mid);
        let p = reflectionViewPosition(sampleUV, d, inverseProjection);
        if (d < 1.0 && p.z - z >= 0.0) { hi = mid; } else { lo = mid; }
      }
      let hitUV = startUV + deltaUV * hi;
      let hitPixel = clamp(vec2<i32>(hitUV * vec2<f32>(dimensions)), vec2<i32>(0), dimensions - vec2<i32>(1));
      let d = textureLoad(depthMap, hitPixel, 0);
      let z = mix(origin.z / a.w, end.z / b.w, hi) / mix(1.0 / a.w, 1.0 / b.w, hi);
      let p = reflectionViewPosition(hitUV, d, inverseProjection);
      let penetration = p.z - z;
      let n = textureLoad(normalMap, hitPixel, 0).xyz;
      if (d < 1.0 && penetration >= 0.0 && penetration <= thickness && dot(n, direction) < 0.0 && length(p - origin) > thickness * 0.25) {
        let edge = min(min(hitUV.x, hitUV.y), min(1.0 - hitUV.x, 1.0 - hitUV.y));
        let level = min(reflectionSourceLevel(view, normal, direction, roughness, p, normalize(n),
          length(p - origin), projection, textureDimensions(colorMap)), f32(textureNumLevels(colorMap) - 1u));
        let filtered = textureSampleLevel(colorMap, colorSampler, hitUV, level);
        hit.radiance = filtered.rgb / max(filtered.a, 0.00001);
        hit.confidence = smoothstep(0.0, 0.035, edge) * filtered.a;
        hit.position = p; hit.distance = length(p - origin); hit.uv = hitUV; hit.kind = 1u;
        return hit;
      }
    }
    priorT = t; priorDelta = difference;
  }
  return hit;
}
fn sampleSceneReflection(
  uv: vec2<f32>, depthMap: texture_depth_2d, colorMap: texture_2d<f32>, colorSampler: sampler, normalMap: texture_2d<f32>,
  projection: mat4x4<f32>, inverseProjection: mat4x4<f32>,
  maxDistance: f32, thickness: f32, nearPlane: f32, steps: u32, frame: u32, roughnessCutoff: f32
) -> vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(depthMap));
  let pixel = clamp(vec2<i32>(uv * vec2<f32>(dimensions)), vec2<i32>(0), dimensions - vec2<i32>(1));
  let d = textureLoad(depthMap, pixel, 0); let nr = textureLoad(normalMap, pixel, 0);
  if (d >= 1.0 || nr.w >= roughnessCutoff || dot(nr.xyz, nr.xyz) < 0.5) { return vec4<f32>(0.0); }
  let p = reflectionViewPosition(uv, d, inverseProjection); let n = normalize(nr.xyz);
  let direction = reflectionGGX(normalize(-p), n, nr.w, reflectionRandom(vec2<u32>(pixel), frame));
  if (dot(direction, n) <= 0.0) { return vec4<f32>(0.0); }
  let origin = p + n * max(0.002, abs(p.z) * 0.0002);
  let hit = traceSceneReflection(origin, direction, depthMap, colorMap, colorSampler, normalMap, projection, inverseProjection,
    maxDistance, thickness, nearPlane, steps, normalize(-p), n, nr.w);
  return vec4<f32>(hit.radiance * hit.confidence, hit.confidence);
}
`;
