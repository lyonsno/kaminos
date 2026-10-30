import {
  DEFAULT_TRANSMISSION_MIN_CONTRIBUTION,
  localLiquidOpticalQueryControls,
  normalizeTransmissionMinContribution,
} from './local-liquid-optical-query.mjs';
import { LOCAL_LIQUID_TRANSPORT_WGSL } from './local-liquid-transport.mjs';

const MLS_SCREEN_SPACE_SURFACE_SHADER = /* wgsl */`
struct Particle {
  position: vec3<f32>,
  life: f32,
  v: vec3<f32>,
  C: mat3x3<f32>,
}

struct RenderParams {
  viewProjection: mat4x4<f32>,
  inverseViewProjection: mat4x4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  cameraForward: vec4<f32>,
  cameraPosition: vec4<f32>,
  viewport: vec4<f32>,
  opticalModes: vec4<f32>,
  mlsDomain: vec4<f32>,
  hostFrameControls: vec4<f32>,
  mlsMaterial: vec4<f32>,
}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: RenderParams;
@group(0) @binding(2) var<storage, read> densities: array<f32>;
@group(0) @binding(4) var surfaceAccumulation: texture_2d<f32>;
@group(0) @binding(5) var refractionSceneColor: texture_2d<f32>;
@group(0) @binding(6) var refractionSceneSampler: sampler;
@group(0) @binding(7) var opticalSlabFrontDepth: texture_2d<f32>;
@group(0) @binding(8) var opticalSlabBackDepth: texture_2d<f32>;
@group(0) @binding(12) var hdrEnvironmentTexture: texture_2d<f32>;
@group(0) @binding(13) var deferredLinearDepthObject: texture_2d<f32>;

const REFLECTION_HIT_ENVIRONMENT = 0u;
const REFLECTION_HIT_DEFERRED_SCENE = 3u;
const REFLECTION_HIT_NONE = 4u;
const OPTICAL_PROVIDER_ENVIRONMENT = 0u;
const OPTICAL_PROVIDER_DEFERRED = 2u;
const OPTICAL_PROVIDER_NONE = 3u;

struct AccumVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) viewDepth: f32,
  @location(2) surface: f32,
  @location(3) speed: f32,
  @location(4) radius: f32,
}

@vertex
fn vs_accumulate(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> AccumVertexOutput {
  let quad = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0)
  );
  let particle = particles[instanceIndex];
  let corner = quad[vertexIndex];
  let rawDensity = select(0.0, densities[instanceIndex], instanceIndex < arrayLength(&densities));
  let restDensity = max(params.mlsMaterial.x, 0.25);
  let densityRatio = rawDensity / restDensity;
  let surface = select(0.55, clamp(1.15 - densityRatio * 0.72, 0.16, 1.0), rawDensity > 0.001);
  let densityRadius = select(1.0, clamp(densityRatio, 0.85, 1.15), rawDensity > 0.001);
  let radius = params.viewport.z * mix(0.88, 1.15, surface) * densityRadius;
  let worldCenter = params.mlsDomain.xyz + particle.position * params.mlsDomain.w;
  let worldPosition = worldCenter
    + params.cameraRight.xyz * radius * corner.x
    + params.cameraUp.xyz * radius * corner.y;
  var clip = params.viewProjection * vec4<f32>(worldPosition, 1.0);
  if (particle.life <= 0.0) {
    clip = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
  var output: AccumVertexOutput;
  output.position = clip;
  output.uv = corner;
  output.viewDepth = max(
    0.001,
    dot(worldCenter - params.cameraPosition.xyz, params.cameraForward.xyz)
  );
  output.surface = surface;
  output.speed = length(particle.v);
  output.radius = radius;
  return output;
}

struct AccumFragmentOutput {
  @location(0) accumulation: vec4<f32>,
  @location(1) frontDepth: vec4<f32>,
  @location(2) backDepth: vec4<f32>,
}

@fragment
fn fs_accumulate(input: AccumVertexOutput) -> AccumFragmentOutput {
  let r2 = dot(input.uv, input.uv);
  if (r2 > 1.0) { discard; }
  let cap = sqrt(max(0.0, 1.0 - r2));
  let edge = smoothstep(1.0, 0.46, r2);
  let surfaceWeight = mix(0.55, 1.0, input.surface);
  let thickness = edge * surfaceWeight * (0.35 + cap * 1.85);
  let opticalThickness = thickness * 0.22 * (0.55 + 0.45 * smoothstep(0.0, 3.6, input.speed));
  let depthWeight = edge * surfaceWeight;
  let supportSafeViewDepth = input.viewDepth;
  let frontSurfaceViewDepth = max(0.001, input.viewDepth + (-0.55 + 1.45 * r2) * input.radius);
  let smoothFrontViewDepth = frontSurfaceViewDepth;
  var output: AccumFragmentOutput;
  output.accumulation = vec4<f32>(opticalThickness, input.speed * opticalThickness, depthWeight, smoothFrontViewDepth * depthWeight);
  output.frontDepth = vec4<f32>(frontSurfaceViewDepth, supportSafeViewDepth, frontSurfaceViewDepth, frontSurfaceViewDepth);
  output.backDepth = vec4<f32>(max(0.001, input.viewDepth + (0.55 - 1.45 * r2) * input.radius));
  return output;
}

struct FullscreenVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex: u32) -> FullscreenVertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  let pos = positions[vertexIndex];
  var output: FullscreenVertexOutput;
  output.position = vec4<f32>(pos, 0.0, 1.0);
  output.uv = pos * 0.5 + vec2<f32>(0.5);
  return output;
}

fn readAccum(pixel: vec2<i32>) -> vec4<f32> {
  let dims = vec2<i32>(textureDimensions(surfaceAccumulation));
  return textureLoad(surfaceAccumulation, clamp(pixel, vec2<i32>(0), dims - vec2<i32>(1)), 0);
}

fn readRawFrontDepth(pixel: vec2<i32>) -> f32 {
  let dims = vec2<i32>(textureDimensions(opticalSlabFrontDepth));
  return textureLoad(opticalSlabFrontDepth, clamp(pixel, vec2<i32>(0), dims - vec2<i32>(1)), 0).x;
}

fn readSupportOrderingDepth(pixel: vec2<i32>) -> f32 {
  let dims = vec2<i32>(textureDimensions(opticalSlabFrontDepth));
  return textureLoad(opticalSlabFrontDepth, clamp(pixel, vec2<i32>(0), dims - vec2<i32>(1)), 0).y;
}

fn readRawBackDepth(pixel: vec2<i32>) -> f32 {
  let dims = vec2<i32>(textureDimensions(opticalSlabBackDepth));
  return textureLoad(opticalSlabBackDepth, clamp(pixel, vec2<i32>(0), dims - vec2<i32>(1)), 0).x;
}

fn readBackDepth(pixel: vec2<i32>) -> f32 {
  let centerDepth = readRawBackDepth(pixel);
  if (centerDepth <= 0.001) {
    return centerDepth;
  }
  let radius = max(params.viewport.z, 0.016);
  var depthSum = centerDepth * 2.0;
  var weightSum = 2.0;
  for (var y = -2; y <= 2; y = y + 1) {
    for (var x = -2; x <= 2; x = x + 1) {
      if (x == 0 && y == 0) { continue; }
      let sampleDepth = readRawBackDepth(pixel + vec2<i32>(x * 3, y * 3));
      if (sampleDepth <= 0.001) { continue; }
      let depthDelta = (sampleDepth - centerDepth) / (radius * 3.0);
      if (abs(depthDelta) > 2.5) { continue; }
      let weight = exp(-f32(x * x + y * y) / 4.5 - depthDelta * depthDelta);
      depthSum = depthSum + sampleDepth * weight;
      weightSum = weightSum + weight;
    }
  }
  return depthSum / max(weightSum, 0.0001);
}

fn weightedDepth(sampleValue: vec4<f32>) -> f32 {
  return sampleValue.w / max(sampleValue.z, 0.0001);
}

fn edgePreservingDepth(pixel: vec2<i32>, centerAccum: vec4<f32>) -> f32 {
  let centerDepth = weightedDepth(centerAccum);
  var depthSum = centerDepth * centerAccum.z * 2.0;
  var weightSum = centerAccum.z * 2.0;
  for (var y = -2; y <= 2; y = y + 1) {
    for (var x = -2; x <= 2; x = x + 1) {
      if (x == 0 && y == 0) { continue; }
      let sampleValue = readAccum(pixel + vec2<i32>(x, y));
      if (sampleValue.z < 0.018) { continue; }
      let sampleDepth = weightedDepth(sampleValue);
      let continuity = exp(-abs(sampleDepth - centerDepth) * 11.0);
      let spatial = exp(-f32(x * x + y * y) / 4.5);
      let weight = sampleValue.z * continuity * spatial;
      depthSum = depthSum + sampleDepth * weight;
      weightSum = weightSum + weight;
    }
  }
  return depthSum / max(weightSum, 0.0001);
}

// Multi-scale screen-space slab filter on the min-blended front surface
// (opticalSlabFrontDepth.x) so adjacent MLS particle paraboloids fuse into
// a continuous glossy sheet without mixing detached background water layers.
fn readFrontDepth(pixel: vec2<i32>) -> f32 {
  let centerDepth = readRawFrontDepth(pixel);
  if (centerDepth >= 29.5) {
    return centerDepth;
  }
  let radius = max(params.viewport.z, 0.016);
  let slabRange = radius * 5.0;
  var depthSum = centerDepth * 1.5;
  var weightSum = 1.5;
  for (var y = -2; y <= 2; y = y + 1) {
    for (var x = -2; x <= 2; x = x + 1) {
      if (x == 0 && y == 0) { continue; }
      let r2 = f32(x * x + y * y);
      let nearDepth = readRawFrontDepth(pixel + vec2<i32>(x * 2, y * 2));
      if (nearDepth < 29.5) {
        let nearDelta = (nearDepth - centerDepth) / slabRange;
        if (abs(nearDelta) <= 2.2) {
          let nearWeight = exp(-r2 / 4.5 - nearDelta * nearDelta * 0.5);
          depthSum = depthSum + nearDepth * nearWeight;
          weightSum = weightSum + nearWeight;
        }
      }
      let farDepth = readRawFrontDepth(pixel + vec2<i32>(x * 5, y * 5));
      if (farDepth < 29.5) {
        let farDelta = (farDepth - centerDepth) / slabRange;
        if (abs(farDelta) <= 2.2) {
          let farWeight = 0.65 * exp(-r2 / 4.5 - farDelta * farDelta * 0.5);
          depthSum = depthSum + farDepth * farWeight;
          weightSum = weightSum + farWeight;
        }
      }
    }
  }
  return depthSum / max(weightSum, 0.0001);
}

fn reconstructWorldPosition(pixel: vec2<i32>, viewDepth: f32) -> vec3<f32> {
  let dims = vec2<f32>(textureDimensions(surfaceAccumulation));
  var ndc = (vec2<f32>(pixel) + vec2<f32>(0.5)) / dims * 2.0 - vec2<f32>(1.0);
  ndc.y = -ndc.y;
  let nearHomogeneous = params.inverseViewProjection * vec4<f32>(ndc, 0.0, 1.0);
  let interiorHomogeneous = params.inverseViewProjection * vec4<f32>(ndc, 0.5, 1.0);
  let nearWorld = nearHomogeneous.xyz / max(abs(nearHomogeneous.w), 0.000001);
  let interiorWorld = interiorHomogeneous.xyz / max(abs(interiorHomogeneous.w), 0.000001);
  let rayDirection = normalize(interiorWorld - nearWorld);
  let nearViewDepth = dot(nearWorld - params.cameraPosition.xyz, params.cameraForward.xyz);
  let depthRate = max(dot(rayDirection, params.cameraForward.xyz), 0.000001);
  return nearWorld + rayDirection * ((viewDepth - nearViewDepth) / depthRate);
}

fn viewDirectionToWorld(viewDirection: vec3<f32>) -> vec3<f32> {
  return normalize(
    params.cameraRight.xyz * viewDirection.x
    + params.cameraUp.xyz * viewDirection.y
    - params.cameraForward.xyz * viewDirection.z
  );
}

struct DeferredSceneHit {
  valid: f32,
  distance: f32,
  uv: vec2<f32>,
  position: vec3<f32>,
  confidence: f32,
}

fn projectWorldToDeferred(worldPosition: vec3<f32>) -> vec4<f32> {
  let clip = params.viewProjection * vec4<f32>(worldPosition, 1.0);
  if (abs(clip.w) <= 0.001) { return vec4<f32>(-1.0); }
  let ndc = clip.xy / clip.w;
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, -ndc.y * 0.5 + 0.5);
  let viewDepth = dot(worldPosition - params.cameraPosition.xyz, params.cameraForward.xyz);
  return vec4<f32>(uv, viewDepth, select(0.0, 1.0, viewDepth > 0.001));
}

fn traceDeferredSceneInterval(
  rayOrigin: vec3<f32>,
  rayDirection: vec3<f32>,
  minimumDistance: f32,
  maximumDistance: f32,
  waterSegment: bool,
) -> DeferredSceneHit {
  var hit: DeferredSceneHit;
  hit.valid = 0.0;
  hit.distance = 60.0;
  hit.uv = vec2<f32>(-1.0);
  hit.position = rayOrigin + rayDirection * hit.distance;
  hit.confidence = 0.0;
  if (maximumDistance < minimumDistance) { return hit; }
  let dims = vec2<i32>(textureDimensions(deferredLinearDepthObject));
  let dimsFloat = vec2<f32>(dims);
  var distance = minimumDistance;
  var prevDistance = minimumDistance;
  var prevDepthDelta = -1.0;
  for (var stepIndex = 0u; stepIndex < 24u; stepIndex = stepIndex + 1u) {
    if (waterSegment) {
      distance = minimumDistance + (maximumDistance - minimumDistance) * f32(stepIndex) / 23.0;
    }
    if (distance > maximumDistance) { break; }
    let samplePosition = rayOrigin + rayDirection * distance;
    let projected = projectWorldToDeferred(samplePosition);
    if (projected.w < 0.5 || any(projected.xy <= vec2<f32>(0.001)) || any(projected.xy >= vec2<f32>(0.999))) {
      prevDistance = distance;
      distance = distance + 0.05 + distance * 0.105;
      continue;
    }
    let scenePixel = clamp(vec2<i32>(projected.xy * dimsFloat), vec2<i32>(0), dims - vec2<i32>(1));
    let sceneDepth = textureLoad(deferredLinearDepthObject, scenePixel, 0).x;
    let depthDelta = projected.z - sceneDepth;
    let crossingTolerance = 0.018 + distance * 0.008;
    let validHostDepth = (sceneDepth > params.hostFrameControls.z) && (sceneDepth < (params.hostFrameControls.y - 0.01));
    if (validHostDepth && depthDelta >= -crossingTolerance && depthDelta <= 0.09 + distance * 0.015) {
      let scenePosition = reconstructWorldPosition(scenePixel, sceneDepth);
      var alongRay = dot(scenePosition - rayOrigin, rayDirection);
      if (stepIndex > 0u && prevDepthDelta < 0.0 && depthDelta >= 0.0) {
        let t = clamp(-prevDepthDelta / max(depthDelta - prevDepthDelta, 0.0001), 0.0, 1.0);
        alongRay = mix(prevDistance, distance, t);
      }
      let across = reconstructWorldPosition(scenePixel + vec2<i32>(1, 0), sceneDepth) - scenePosition;
      let down = reconstructWorldPosition(scenePixel + vec2<i32>(0, 1), sceneDepth) - scenePosition;
      let pixelFootprint = max(length(across) + length(down), 0.0001);
      let transverseError = length(scenePosition - (rayOrigin + rayDirection * alongRay));
      if (alongRay < minimumDistance || alongRay > maximumDistance || transverseError > pixelFootprint * 1.35) {
        prevDistance = distance;
        prevDepthDelta = depthDelta;
        distance = distance + 0.05 + distance * 0.105;
        continue;
      }
      let refinedPosition = rayOrigin + rayDirection * alongRay;
      let refinedProjected = projectWorldToDeferred(refinedPosition);
      hit.valid = 1.0;
      hit.uv = clamp(select(projected.xy, refinedProjected.xy, refinedProjected.w > 0.5), vec2<f32>(0.001), vec2<f32>(0.999));
      hit.position = refinedPosition;
      hit.distance = alongRay;
      hit.confidence = 1.0 - smoothstep(0.0, 0.16, abs(depthDelta));
      return hit;
    }
    prevDistance = distance;
    prevDepthDelta = depthDelta;
    distance = distance + 0.05 + distance * 0.105;
  }
  return hit;
}

fn traceDeferredScene(rayOrigin: vec3<f32>, rayDirection: vec3<f32>) -> DeferredSceneHit {
  return traceDeferredSceneInterval(rayOrigin, rayDirection, 0.0, 60.0, false);
}

fn loadEnvironmentTexel(pixel: vec2<i32>) -> vec3<f32> {
  let dims = vec2<i32>(textureDimensions(hdrEnvironmentTexture));
  let wrappedX = ((pixel.x % dims.x) + dims.x) % dims.x;
  let safePixel = vec2<i32>(wrappedX, clamp(pixel.y, 0, dims.y - 1));
  return textureLoad(hdrEnvironmentTexture, safePixel, 0).rgb;
}

fn sampleEnvironment(rayDirection: vec3<f32>) -> vec3<f32> {
  let direction = normalize(rayDirection);
  let analyticSky = mix(vec3<f32>(0.10, 0.16, 0.20), vec3<f32>(0.54, 0.68, 0.78), clamp(direction.y * 0.5 + 0.5, 0.0, 1.0));
  if (params.hostFrameControls.x <= 0.5) {
    return analyticSky;
  }
  var longitude = 0.0;
  if (dot(direction.xz, direction.xz) > 0.0) {
    longitude = atan2(direction.z, direction.x);
  }
  let uv = vec2<f32>(fract(0.5 + longitude / (2.0 * 3.14159265)), acos(clamp(direction.y, -1.0, 1.0)) / 3.14159265);
  let dims = vec2<f32>(textureDimensions(hdrEnvironmentTexture));
  let texelPosition = uv * dims - vec2<f32>(0.5);
  let base = vec2<i32>(floor(texelPosition));
  let blend = fract(texelPosition);
  let top = mix(loadEnvironmentTexel(base), loadEnvironmentTexel(base + vec2<i32>(1, 0)), blend.x);
  let bottom = mix(loadEnvironmentTexel(base + vec2<i32>(0, 1)), loadEnvironmentTexel(base + vec2<i32>(1, 1)), blend.x);
  return mix(top, bottom, blend.y) * 0.72;
}

struct ReflectionSample {
  radiance: vec3<f32>,
  environmentRadiance: vec3<f32>,
}

struct OpticalQuerySample {
  radiance: vec3<f32>,
  environmentRadiance: vec3<f32>,
  distance: f32,
  hitKind: u32,
  providerKind: u32,
  position: vec3<f32>,
  confidence: f32,
}

fn makeNoOpticalQuerySample() -> OpticalQuerySample {
  var sample: OpticalQuerySample;
  sample.radiance = vec3<f32>(0.0);
  sample.environmentRadiance = vec3<f32>(0.0);
  sample.distance = 0.0;
  sample.hitKind = REFLECTION_HIT_NONE;
  sample.providerKind = OPTICAL_PROVIDER_NONE;
  sample.position = vec3<f32>(0.0);
  sample.confidence = 0.0;
  return sample;
}

struct ReflectionQuadrature {
  radiance: vec3<f32>,
  environmentRadiance: vec3<f32>,
}

fn sampleWorldOpticalQuery(rayOrigin: vec3<f32>, rayDirection: vec3<f32>) -> OpticalQuerySample {
  _ = rayOrigin;
  let surfaceRadiance = sampleEnvironment(rayDirection);
  var sample: OpticalQuerySample;
  sample.radiance = surfaceRadiance;
  sample.environmentRadiance = surfaceRadiance;
  sample.distance = 60.0;
  sample.hitKind = REFLECTION_HIT_ENVIRONMENT;
  sample.providerKind = OPTICAL_PROVIDER_ENVIRONMENT;
  sample.position = rayOrigin + rayDirection * 60.0;
  sample.confidence = 1.0;
  return sample;
}

fn deferredOpticalQuerySample(hit: DeferredSceneHit) -> OpticalQuerySample {
  var sample: OpticalQuerySample;
  sample.radiance = textureSampleLevel(refractionSceneColor, refractionSceneSampler, hit.uv, 0.0).rgb;
  sample.environmentRadiance = vec3<f32>(0.0);
  sample.distance = hit.distance;
  sample.hitKind = REFLECTION_HIT_DEFERRED_SCENE;
  sample.providerKind = OPTICAL_PROVIDER_DEFERRED;
  sample.position = hit.position;
  sample.confidence = hit.confidence;
  return sample;
}

fn sampleHybridOpticalQuery(rayOrigin: vec3<f32>, rayDirection: vec3<f32>) -> OpticalQuerySample {
  let hit = traceDeferredScene(rayOrigin, rayDirection);
  if (hit.valid > 0.5 && hit.confidence >= 0.55) {
    return deferredOpticalQuerySample(hit);
  }
  return sampleWorldOpticalQuery(rayOrigin, rayDirection);
}

fn sampleHostWaterSegment(rayOrigin: vec3<f32>, rayDirection: vec3<f32>, waterPath: f32) -> OpticalQuerySample {
  let hit = traceDeferredSceneInterval(rayOrigin, rayDirection, 0.0, waterPath, true);
  if (hit.valid > 0.5 && hit.confidence >= 0.55) {
    return deferredOpticalQuerySample(hit);
  }
  return makeNoOpticalQuerySample();
}

fn integrateTransmissionQuadrature(
  rayOrigin: vec3<f32>,
  centerDirection: vec3<f32>,
  center: OpticalQuerySample,
  coneRadius: f32,
  transmissionFootprintMode: i32,
) -> vec3<f32> {
  if (transmissionFootprintMode == 0) {
    return center.radiance;
  }
  let helperAxis = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(centerDirection.y) > 0.92);
  let tangent = normalize(cross(helperAxis, centerDirection));
  let bitangent = normalize(cross(centerDirection, tangent));
  var samples: array<OpticalQuerySample, 5>;
  samples[0] = center;
  samples[1] = sampleHybridOpticalQuery(rayOrigin, normalize(centerDirection + tangent * coneRadius));
  samples[2] = sampleHybridOpticalQuery(rayOrigin, normalize(centerDirection - tangent * coneRadius));
  samples[3] = sampleHybridOpticalQuery(rayOrigin, normalize(centerDirection + bitangent * coneRadius));
  samples[4] = sampleHybridOpticalQuery(rayOrigin, normalize(centerDirection - bitangent * coneRadius));
  var minimumIndex = 0;
  var maximumIndex = 0;
  var minimumLuminance = dot(samples[0].radiance, vec3<f32>(0.2126, 0.7152, 0.0722));
  var maximumLuminance = minimumLuminance;
  var radianceSum = vec3<f32>(0.0);
  for (var sampleIndex = 0; sampleIndex < 5; sampleIndex += 1) {
    let sampleLuminance = dot(samples[sampleIndex].radiance, vec3<f32>(0.2126, 0.7152, 0.0722));
    if (sampleLuminance < minimumLuminance) {
      minimumLuminance = sampleLuminance;
      minimumIndex = sampleIndex;
    }
    if (sampleLuminance > maximumLuminance) {
      maximumLuminance = sampleLuminance;
      maximumIndex = sampleIndex;
    }
    radianceSum += samples[sampleIndex].radiance;
  }
  if (maximumIndex == minimumIndex) {
    maximumIndex = select(0, 1, minimumIndex == 0);
  }
  return (radianceSum - samples[minimumIndex].radiance - samples[maximumIndex].radiance) / 3.0;
}

fn reflectionSampleFromOpticalQuery(query: OpticalQuerySample) -> ReflectionSample {
  var sample: ReflectionSample;
  sample.radiance = query.radiance;
  sample.environmentRadiance = query.environmentRadiance;
  return sample;
}

fn sampleWorldReflection(rayOrigin: vec3<f32>, rayDirection: vec3<f32>) -> ReflectionSample {
  return reflectionSampleFromOpticalQuery(sampleHybridOpticalQuery(rayOrigin, rayDirection));
}

fn integrateWorldReflectionQuadrature(
  worldPosition: vec3<f32>,
  cameraRay: vec3<f32>,
  worldNormal: vec3<f32>,
  coneRadius: f32,
  opticalFootprintMode: i32,
) -> ReflectionQuadrature {
  let centerDirection = normalize(reflect(cameraRay, worldNormal));
  let helperAxis = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(centerDirection.y) > 0.92);
  let tangent = normalize(cross(helperAxis, centerDirection));
  let bitangent = normalize(cross(centerDirection, tangent));
  let rayOrigin = worldPosition;
  let center = sampleWorldReflection(rayOrigin, centerDirection);
  let tangentPositive = sampleWorldReflection(rayOrigin, normalize(centerDirection + tangent * coneRadius));
  let tangentNegative = sampleWorldReflection(rayOrigin, normalize(centerDirection + tangent * -coneRadius));
  let bitangentPositive = sampleWorldReflection(rayOrigin, normalize(centerDirection + bitangent * coneRadius));
  let bitangentNegative = sampleWorldReflection(rayOrigin, normalize(centerDirection + bitangent * -coneRadius));
  var quadrature: ReflectionQuadrature;
  if (opticalFootprintMode == 0) {
    quadrature.radiance = center.radiance * 0.36
      + (tangentPositive.radiance + tangentNegative.radiance + bitangentPositive.radiance + bitangentNegative.radiance) * 0.16;
    quadrature.environmentRadiance = center.environmentRadiance * 0.36
      + (tangentPositive.environmentRadiance + tangentNegative.environmentRadiance + bitangentPositive.environmentRadiance + bitangentNegative.environmentRadiance) * 0.16;
    return quadrature;
  }
  let diagonalRadius = coneRadius * 0.70710678;
  let diagonalPositivePositive = sampleWorldReflection(rayOrigin, normalize(centerDirection + (tangent + bitangent) * diagonalRadius));
  let diagonalPositiveNegative = sampleWorldReflection(rayOrigin, normalize(centerDirection + (tangent - bitangent) * diagonalRadius));
  let diagonalNegativePositive = sampleWorldReflection(rayOrigin, normalize(centerDirection + (-tangent + bitangent) * diagonalRadius));
  let diagonalNegativeNegative = sampleWorldReflection(rayOrigin, normalize(centerDirection + (-tangent - bitangent) * diagonalRadius));
  var samples: array<ReflectionSample, 9>;
  samples[0] = center;
  samples[1] = tangentPositive;
  samples[2] = tangentNegative;
  samples[3] = bitangentPositive;
  samples[4] = bitangentNegative;
  samples[5] = diagonalPositivePositive;
  samples[6] = diagonalPositiveNegative;
  samples[7] = diagonalNegativePositive;
  samples[8] = diagonalNegativeNegative;
  var minimumIndex = 0;
  var maximumIndex = 0;
  var minimumLuminance = dot(samples[0].radiance, vec3<f32>(0.2126, 0.7152, 0.0722));
  var maximumLuminance = minimumLuminance;
  var radianceSum = vec3<f32>(0.0);
  var environmentRadianceSum = vec3<f32>(0.0);
  for (var sampleIndex = 0; sampleIndex < 9; sampleIndex += 1) {
    let sampleLuminance = dot(samples[sampleIndex].radiance, vec3<f32>(0.2126, 0.7152, 0.0722));
    if (sampleLuminance < minimumLuminance) {
      minimumLuminance = sampleLuminance;
      minimumIndex = sampleIndex;
    }
    if (sampleLuminance > maximumLuminance) {
      maximumLuminance = sampleLuminance;
      maximumIndex = sampleIndex;
    }
    radianceSum += samples[sampleIndex].radiance;
    environmentRadianceSum += samples[sampleIndex].environmentRadiance;
  }
  if (maximumIndex == minimumIndex) {
    maximumIndex = select(0, 1, minimumIndex == 0);
  }
  quadrature.radiance = (radianceSum - samples[minimumIndex].radiance - samples[maximumIndex].radiance) / 7.0;
  quadrature.environmentRadiance = (environmentRadianceSum
    - samples[minimumIndex].environmentRadiance
    - samples[maximumIndex].environmentRadiance) / 7.0;
  return quadrature;
}

${LOCAL_LIQUID_TRANSPORT_WGSL}

fn coherentSlabDepth(pixel: vec2<i32>, centerDepth: f32, backSurface: bool) -> f32 {
  let candidate = select(readFrontDepth(pixel), readBackDepth(pixel), backSurface);
  let populated = select((candidate < 29.5), (candidate > 0.001), backSurface);
  return select(centerDepth, candidate, populated && abs(candidate - centerDepth) < 0.72);
}

fn reconstructWorldReflectionNormal(pixel: vec2<i32>) -> vec3<f32> {
  return liquidWorldNormalAtRadius(pixel, 12, false);
}

fn reconstructWorldReflectionDetailNormal(pixel: vec2<i32>) -> vec3<f32> {
  return liquidWorldNormalAtRadius(pixel, 6, false);
}

fn reconstructEntryNormalAtRadius(pixel: vec2<i32>, centerDepth: f32, radius: i32) -> vec3<f32> {
  _ = centerDepth;
  return liquidWorldDirectionToView(liquidWorldNormalAtRadius(pixel, radius, false));
}

struct InterfaceNormalEstimate {
  detailNormal: vec3<f32>,
  macroNormal: vec3<f32>,
  microResidual: vec3<f32>,
  filteredNormal: vec3<f32>,
  variance: f32,
  denseBodyConfidence: f32,
}

fn estimateInterfaceNormal(
  pixel: vec2<i32>,
  centerDepth: f32,
  centerAccum: vec4<f32>,
  coverageContinuity: f32,
) -> InterfaceNormalEstimate {
  let detailNormal = reconstructEntryNormalAtRadius(pixel, centerDepth, 6);
  let macroNormal = reconstructEntryNormalAtRadius(pixel, centerDepth, 12);
  let variance = sqrt(max(1.0 - dot(detailNormal, macroNormal), 0.0));
  let denseBodyConfidence = smoothstep(0.68, 0.94, coverageContinuity)
    * smoothstep(2.35, 4.60, centerAccum.x)
    * smoothstep(1.15, 2.50, centerAccum.z);
  let normalBlend = denseBodyConfidence * clamp(0.14 + variance * 0.9, 0.14, 0.58);
  var estimate: InterfaceNormalEstimate;
  estimate.detailNormal = detailNormal;
  estimate.macroNormal = macroNormal;
  estimate.microResidual = detailNormal - macroNormal;
  estimate.filteredNormal = normalize(mix(detailNormal, macroNormal, normalBlend));
  estimate.variance = variance;
  estimate.denseBodyConfidence = denseBodyConfidence;
  return estimate;
}

fn reconstructExitNormalAtRadius(pixel: vec2<i32>, centerDepth: f32, radius: i32) -> vec3<f32> {
  _ = centerDepth;
  return -liquidWorldDirectionToView(liquidWorldNormalAtRadius(pixel, radius, true));
}

fn reconstructExitNormal(pixel: vec2<i32>, centerDepth: f32) -> vec3<f32> {
  return reconstructExitNormalAtRadius(pixel, centerDepth, 1);
}

struct OpticalSlab {
  entryDepth: f32,
  exitDepth: f32,
  geometricPathLength: f32,
  supportPerSpanConfidence: f32,
  exitValidity: f32,
}

fn evaluateOpticalSlab(pixel: vec2<i32>, centerAccum: vec4<f32>) -> OpticalSlab {
  let entryDepth = readFrontDepth(pixel);
  let exitDepth = readBackDepth(pixel);
  let rawSpan = max(0.0, exitDepth - entryDepth);
  let integratedWaterSpan = max(centerAccum.x * 0.065, params.viewport.z * 0.85);
  let geometricPathLength = min(rawSpan, integratedWaterSpan * 1.35);
  let spanInParticleDiameters = geometricPathLength / max(params.viewport.z * 2.0, 0.001);
  let supportPerSpan = centerAccum.z / max(spanInParticleDiameters, 1.0);
  let supportPerSpanConfidence = smoothstep(0.10, 0.72, supportPerSpan);
  let geometryValid = entryDepth < 29.5
    && exitDepth > entryDepth + 0.004
    && geometricPathLength < 3.2;
  var slab: OpticalSlab;
  slab.entryDepth = entryDepth;
  slab.exitDepth = exitDepth;
  slab.geometricPathLength = geometricPathLength;
  slab.supportPerSpanConfidence = supportPerSpanConfidence;
  slab.exitValidity = select(0.0, supportPerSpanConfidence, geometryValid);
  return slab;
}

fn reconstructRefractionOffset(normal: vec3<f32>, thickness: f32) -> vec2<f32> {
  let viewDir = vec3<f32>(0.0, 0.0, 1.0);
  let refracted = refract(-viewDir, normal, 1.0 / 1.333);
  let projectedDirection = refracted.xy / max(abs(refracted.z), 0.25);
  let offsetPixels = projectedDirection * clamp(thickness * 3.6, 1.0, 42.0);
  return clamp(offsetPixels, vec2<f32>(-28.0), vec2<f32>(28.0));
}

fn projectViewRayOffset(ray: vec3<f32>, pathLength: f32, entryDepth: f32) -> vec2<f32> {
  let focalPixels = params.viewport.y * 0.5 / tan(0.5 * 3.14159265 / 3.15);
  let projectedDirection = ray.xy / max(abs(ray.z), 0.25);
  return projectedDirection * pathLength * focalPixels / max(entryDepth, 0.08);
}

fn distributionGgx(noh: f32, roughness: f32) -> f32 {
  let alpha = roughness * roughness;
  let alphaSquared = alpha * alpha;
  let denominator = noh * noh * (alphaSquared - 1.0) + 1.0;
  return alphaSquared / max(3.14159265 * denominator * denominator, 0.0001);
}

fn geometrySchlickGgx(nod: f32, roughness: f32) -> f32 {
  let k = (roughness + 1.0) * (roughness + 1.0) * 0.125;
  return nod / max(nod * (1.0 - k) + k, 0.0001);
}

fn geometrySmith(nov: f32, nol: f32, roughness: f32) -> f32 {
  return geometrySchlickGgx(nov, roughness) * geometrySchlickGgx(nol, roughness);
}

fn fresnelSchlick(voh: f32, f0: vec3<f32>) -> vec3<f32> {
  return f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - voh, 5.0);
}

fn evaluateBoundedGgxDirectSpecular(
  normal: vec3<f32>,
  viewDirection: vec3<f32>,
  lightDirection: vec3<f32>,
  roughness: f32,
) -> vec3<f32> {
  let halfVector = normalize(viewDirection + lightDirection);
  let nov = clamp(dot(normal, viewDirection), 0.0, 1.0);
  let nol = clamp(dot(normal, lightDirection), 0.0, 1.0);
  let noh = clamp(dot(normal, halfVector), 0.0, 1.0);
  let voh = clamp(dot(viewDirection, halfVector), 0.0, 1.0);
  let distribution = distributionGgx(noh, roughness);
  let geometry = geometrySmith(nov, nol, roughness);
  let fresnel = fresnelSchlick(voh, vec3<f32>(0.02037));
  let specular = vec3<f32>(0.72, 0.92, 1.0) * 6.0 * distribution * geometry * fresnel * nol
    / max(4.0 * nov * nol, 0.0001);
  return min(specular, vec3<f32>(0.22));
}

@fragment
fn fs_refraction(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let dims = vec2<i32>(textureDimensions(surfaceAccumulation));
  let dimsFloat = vec2<f32>(dims);
  let pixel = clamp(vec2<i32>(fragmentPosition.xy), vec2<i32>(0), dims - vec2<i32>(1));
  let background = textureLoad(refractionSceneColor, pixel, 0);
  let centerAccum = readAccum(pixel);
  if (centerAccum.z < 0.018 || centerAccum.x < 0.012) {
    return background;
  }

  let supportOrderingDepth = readSupportOrderingDepth(pixel);
  let hostSceneDepth = textureLoad(deferredLinearDepthObject, pixel, 0).x;
  if (hostSceneDepth > 0.0 && supportOrderingDepth >= hostSceneDepth - 0.002) {
    return background;
  }

  let opticalLightingMode = i32(round(params.cameraForward.w));
  let opticalFootprintMode = i32(round(params.cameraPosition.w));
  let transmissionFootprintMode = i32(round(params.opticalModes.x));
  let bodyTransportMode = i32(round(params.opticalModes.y));
  let interfaceFrequencyMode = i32(round(params.opticalModes.z));
  let sceneUv = clamp((vec2<f32>(pixel) + vec2<f32>(0.5)) / dimsFloat, vec2<f32>(0.0), vec2<f32>(1.0));

  let centerCoverage = smoothstep(0.018, 0.10, centerAccum.z)
    * smoothstep(0.012, 0.085, centerAccum.x);
  var coverageSupportSum = 0.0;
  var coverageWeightSum = 0.0;
  for (var coverageY = -2; coverageY <= 2; coverageY = coverageY + 1) {
    for (var coverageX = -2; coverageX <= 2; coverageX = coverageX + 1) {
      let neighborAccum = readAccum(pixel + vec2<i32>(coverageX, coverageY));
      let neighborSupport = smoothstep(0.018, 0.075, neighborAccum.z)
        * smoothstep(0.012, 0.065, neighborAccum.x);
      let coverageWeight = 1.0 / (1.0 + f32(abs(coverageX) + abs(coverageY)));
      coverageSupportSum = coverageSupportSum + neighborSupport * coverageWeight;
      coverageWeightSum = coverageWeightSum + coverageWeight;
    }
  }
  let coverageContinuity = smoothstep(0.42, 0.90, coverageSupportSum / max(coverageWeightSum, 0.001));
  let legacyCoverage = centerCoverage * coverageContinuity;
  let shadingDepth = readFrontDepth(pixel);
  let slab = evaluateOpticalSlab(pixel, centerAccum);
  let interfaceNormal = estimateInterfaceNormal(pixel, shadingDepth, centerAccum, coverageContinuity);
  let denseCoverageClosure = max(legacyCoverage, smoothstep(0.48, 0.84, coverageContinuity));
  let geometricCoverage = mix(legacyCoverage, denseCoverageClosure, interfaceNormal.denseBodyConfidence);
  let coupledTransportNormal = interfaceNormal.filteredNormal;
  let transportNormal = select(coupledTransportNormal, interfaceNormal.macroNormal, interfaceFrequencyMode == 1);

  let thickness = centerAccum.x;
  let entryWorldPosition = reconstructWorldPosition(pixel, slab.entryDepth);
  let viewDir = -liquidWorldDirectionToView(liquidCameraDirection(pixel));
  let insideRay = refract(-viewDir, transportNormal, 1.0 / 1.333);
  let insideRayValid = length(insideRay) > 0.001;
  let insideWorldRay = viewDirectionToWorld(insideRay);
  let forwardDepthRate = dot(insideWorldRay, params.cameraForward.xyz);
  let metricRaySupported = insideRayValid && (forwardDepthRate > 0.000001);
  let metricScale = 1.0 / max(abs(insideRay.z), 0.25);
  var geometricPathLength = slab.geometricPathLength * metricScale;
  if (metricRaySupported) {
    geometricPathLength = liquidMetricPath(slab.geometricPathLength, forwardDepthRate);
  }
  let sceneBoundedSpan = max(hostSceneDepth - slab.entryDepth, 0.0);
  let metricSceneBoundedPath = select(
    sceneBoundedSpan * metricScale,
    liquidMetricPath(sceneBoundedSpan, max(forwardDepthRate, 0.000001)),
    metricRaySupported,
  );
  let insideOffset = projectViewRayOffset(insideRay, geometricPathLength, slab.entryDepth);
  let unclampedExitUv = projectWorldToDeferred(entryWorldPosition + insideWorldRay * geometricPathLength).xy;
  let exitInFrame = all(unclampedExitUv >= vec2<f32>(0.001)) && all(unclampedExitUv <= vec2<f32>(0.999));
  let exitUv = clamp(unclampedExitUv, vec2<f32>(0.001), vec2<f32>(0.999));
  let exitPixel = vec2<i32>(exitUv * dimsFloat);
  let sampledExitDepth = readBackDepth(exitPixel);
  let exitDepthValid = sampledExitDepth > slab.entryDepth + 0.004 && sampledExitDepth < 29.5;
  let exitNormal = reconstructExitNormal(exitPixel, sampledExitDepth);
  let exitMacroNormal = reconstructExitNormalAtRadius(exitPixel, sampledExitDepth, 3);
  let exitTransportNormal = select(exitNormal, exitMacroNormal, interfaceFrequencyMode == 1);
  let exitNormalVariance = sqrt(max(1.0 - dot(exitNormal, exitMacroNormal), 0.0));
  let exitRayAngularVariance = max(exitNormalVariance, interfaceNormal.variance * 0.85);
  let outgoingRay = refract(insideRay, -exitTransportNormal, 1.333);
  let outgoingRayValid = length(outgoingRay) > 0.001;
  var exitWorldPosition = reconstructWorldPosition(exitPixel, sampledExitDepth);
  var metricExitPath = geometricPathLength;
  if (metricRaySupported && exitDepthValid && exitInFrame) {
    let boundedExitSpan = min(
      max(0.0, sampledExitDepth - slab.entryDepth),
      max(centerAccum.x * 0.065, params.viewport.z * 0.85) * 1.35,
    );
    metricExitPath = liquidMetricPath(boundedExitSpan, forwardDepthRate);
    exitWorldPosition = entryWorldPosition + insideWorldRay * metricExitPath;
  }
  let outgoingWorldRay = viewDirectionToWorld(select(insideRay, outgoingRay, outgoingRayValid));
  let exitDirectionDelta = outgoingRay.xy / max(abs(outgoingRay.z), 0.25)
    - insideRay.xy / max(abs(insideRay.z), 0.25);
  let exitOffset = exitDirectionDelta * clamp(geometricPathLength * 7.0, 0.0, 12.0);
  let twoInterfaceOffset = clamp(insideOffset + exitOffset, vec2<f32>(-28.0), vec2<f32>(28.0));
  let entryOnlyOffset = reconstructRefractionOffset(transportNormal, thickness);
  let exitValidity = slab.exitValidity
    * select(0.0, 1.0, exitInFrame)
    * select(0.0, 1.0, insideRayValid && outgoingRayValid && exitDepthValid && metricRaySupported);
  var queryValidity = select(0.0, 1.0, exitValidity > 0.5);

  let transmissionMinContribution = clamp(params.hostFrameControls.w, 0.0, 1.0);
  let prelimViewToCamera = -liquidCameraDirection(pixel);
  let prelimNdv = clamp(dot(reconstructWorldReflectionNormal(pixel), prelimViewToCamera), 0.0, 1.0);
  let prelimFresnel = 0.02037 + (1.0 - 0.02037) * pow(1.0 - prelimNdv, 5.0);
  let insideSegmentActive = (1.0 - prelimFresnel) >= transmissionMinContribution;
  let geometricPathKnown = (slab.exitValidity > 0.5) && insideRayValid && metricRaySupported;
  var waterPath = min(metricExitPath, metricSceneBoundedPath);
  var queryOrigin = exitWorldPosition;
  var queryDirection = outgoingWorldRay;
  var submergedSurface = false;
  var refractionQuery = makeNoOpticalQuerySample();
  if (geometricPathKnown && insideSegmentActive) {
    let insideHit = sampleHostWaterSegment(entryWorldPosition, insideWorldRay, waterPath);
    if (insideHit.providerKind == OPTICAL_PROVIDER_DEFERRED && insideHit.distance >= 0.0 && insideHit.distance <= waterPath) {
      refractionQuery = insideHit;
      waterPath = insideHit.distance;
      submergedSurface = true;
      queryValidity = 1.0;
      queryOrigin = entryWorldPosition;
      queryDirection = insideWorldRay;
    }
  }
  let opticalThicknessPath = min(thickness * 0.06, metricSceneBoundedPath);
  let prelimSlabPath = min(
    select(
      mix(opticalThicknessPath, geometricPathLength, queryValidity),
      waterPath,
      geometricPathKnown,
    ),
    metricSceneBoundedPath,
  );
  let calibratedAbsorptionCoefficient = vec3<f32>(1.10, 0.42, 0.18);
  let prelimAbsorption = exp(-calibratedAbsorptionCoefficient * prelimSlabPath);
  let prelimTransmittance = exp(-1.8 * prelimSlabPath);
  let transmissionContribution = (1.0 - prelimFresnel)
    * min(max(prelimAbsorption.r, max(prelimAbsorption.g, prelimAbsorption.b)), prelimTransmittance);
  let transmissionRayActive = transmissionContribution >= transmissionMinContribution;
  queryValidity = select(0.0, queryValidity, transmissionRayActive);
  if (!submergedSurface && queryValidity > 0.5) {
    refractionQuery = sampleHybridOpticalQuery(queryOrigin, queryDirection);
  }
  let transmissionFootprintActivation = interfaceNormal.denseBodyConfidence
    * smoothstep(0.04, 0.34, exitRayAngularVariance)
    * queryValidity;
  let transmissionConeRadius = clamp(
    0.008 + transmissionFootprintActivation * (0.055 + exitRayAngularVariance * 0.18),
    0.008,
    0.22,
  );
  let effectiveTransmissionQuadratureMode = select(
    0,
    1,
    transmissionFootprintMode == 1 && transmissionFootprintActivation > 0.05 && !submergedSurface,
  );
  let offsetPixels = mix(entryOnlyOffset, twoInterfaceOffset, select(0.0, 1.0, exitValidity > 0.5));
  let refractedUv = clamp(sceneUv + offsetPixels / dimsFloat, vec2<f32>(0.001), vec2<f32>(0.999));
  var refractedScene = vec4<f32>(0.0);
  if (transmissionRayActive) {
    refractedScene = textureSampleLevel(refractionSceneColor, refractionSceneSampler, refractedUv, 0.0);
  }
  let geometricSlabPath = mix(opticalThicknessPath, geometricPathLength, queryValidity);
  let denseBodyPathActivation = interfaceNormal.denseBodyConfidence
    * smoothstep(0.035, 0.42, opticalThicknessPath - geometricPathLength)
    * queryValidity;
  let robustBodyPath = mix(
    geometricPathLength,
    max(geometricPathLength, opticalThicknessPath),
    denseBodyPathActivation,
  );
  let robustBodyPathWithFallback = mix(opticalThicknessPath, robustBodyPath, queryValidity);
  var absorptionPath = select(geometricSlabPath, robustBodyPathWithFallback, bodyTransportMode == 1);
  if (exitValidity > 0.5 && !transmissionRayActive) {
    absorptionPath = prelimSlabPath;
  }
  if (geometricPathKnown) {
    absorptionPath = waterPath;
  }
  absorptionPath = min(absorptionPath, metricSceneBoundedPath);
  let absorption = exp(-calibratedAbsorptionCoefficient * absorptionPath);

  var transmissionQuadratureRadiance = refractionQuery.radiance;
  if (queryValidity > 0.5) {
    transmissionQuadratureRadiance = integrateTransmissionQuadrature(
      queryOrigin,
      queryDirection,
      refractionQuery,
      transmissionConeRadius,
      effectiveTransmissionQuadratureMode,
    );
  }
  let bodyRadianceLowFrequency = transmissionQuadratureRadiance;
  let bodyRadianceDirectionalResidual = refractionQuery.radiance - bodyRadianceLowFrequency;
  let bodyRadianceResidualWeight = 1.0 - denseBodyPathActivation * 0.72;
  let pathConditionedDetailDecay = interfaceNormal.denseBodyConfidence
    * queryValidity
    * smoothstep(0.10, 0.85, absorptionPath);
  let transmissionDetailWeight = select(
    bodyRadianceResidualWeight,
    1.0 - pathConditionedDetailDecay * 0.58,
    interfaceFrequencyMode == 1,
  );
  let robustBodyRadiance = max(bodyRadianceLowFrequency + bodyRadianceDirectionalResidual * transmissionDetailWeight, vec3<f32>(0.0));
  let hasDeferredTransmissionHit = queryValidity > 0.5 && refractionQuery.providerKind == OPTICAL_PROVIDER_DEFERRED;
  let refractedRadiance = mix(
    refractedScene.rgb,
    select(transmissionQuadratureRadiance, robustBodyRadiance, bodyTransportMode == 1),
    select(0.0, queryValidity * refractionQuery.confidence * 0.55, hasDeferredTransmissionHit),
  );

  let reflectionEntryDepth = coherentSlabDepth(pixel, shadingDepth, false);
  let worldPosition = reconstructWorldPosition(pixel, reflectionEntryDepth);
  let worldNormal = reconstructWorldReflectionNormal(pixel);
  let viewToCamera = -liquidCameraDirection(pixel);
  let cameraRay = -viewToCamera;
  let ndv = clamp(dot(worldNormal, viewToCamera), 0.0, 1.0);
  let f0 = 0.02037;
  let fresnel = f0 + (1.0 - f0) * pow(1.0 - ndv, 5.0);
  let reflectionDetailNormal = reconstructWorldReflectionDetailNormal(pixel);
  let unresolvedNormalVariance = sqrt(max(1.0 - dot(worldNormal, reflectionDetailNormal), 0.0));
  let microReflectionWeight = select(
    0.0,
    clamp(
      (1.0 - interfaceNormal.denseBodyConfidence) * 0.18
        + interfaceNormal.denseBodyConfidence * unresolvedNormalVariance * 0.12,
      0.0,
      0.24,
    ),
    interfaceFrequencyMode == 1,
  );
  let reflectionSurfaceNormal = normalize(mix(worldNormal, reflectionDetailNormal, microReflectionWeight));
  let reflectionRoughness = clamp(
    0.06 + unresolvedNormalVariance * 2.1 + pow(1.0 - ndv, 2.0) * 0.34,
    0.06,
    1.0,
  );
  let footprintActivation = interfaceNormal.denseBodyConfidence
    * smoothstep(0.08, 0.42, unresolvedNormalVariance);
  let baselineReflectionConeRadius = clamp(0.018 + reflectionRoughness * 0.10, 0.018, 0.118);
  let varianceFilteredConeRadius = clamp(
    baselineReflectionConeRadius + footprintActivation * (0.018 + reflectionRoughness * 0.024),
    0.018,
    0.16,
  );
  let reflectionConeRadius = select(baselineReflectionConeRadius, varianceFilteredConeRadius, opticalFootprintMode == 1);
  let effectiveFootprintQuadratureMode = select(0, 1, opticalFootprintMode == 1 && footprintActivation > 0.05);

  let reflectionQuadrature = integrateWorldReflectionQuadrature(
    worldPosition,
    cameraRay,
    reflectionSurfaceNormal,
    reflectionConeRadius,
    effectiveFootprintQuadratureMode,
  );
  let reflectionRadiance = reflectionQuadrature.radiance;

  let absorptionLoss = vec3<f32>(1.0) - absorption;
  let ambientScale = select(
    1.0,
    clamp(length(sampleEnvironment(vec3<f32>(0.0, 1.0, 0.0))) * 2.2, 0.10, 1.0),
    params.hostFrameControls.x > 0.5,
  );
  let waterScatter = vec3<f32>(0.035, 0.18, 0.26) * absorptionLoss * ambientScale;
  let directRoughness = clamp(interfaceNormal.variance * interfaceNormal.denseBodyConfidence, 0.0, 0.48);
  let directRoughnessWeight = smoothstep(0.025, 0.34, directRoughness);
  let broadSpecularExponent = mix(38.0, 12.0, directRoughnessWeight);
  let crestSpecularExponent = mix(128.0, 46.0, directRoughnessWeight);
  let directLight = max(dot(transportNormal, normalize(vec3<f32>(-0.28, 0.64, 1.72))), 0.0);
  let broadSpecular = pow(directLight, broadSpecularExponent) * 0.32;
  let crestSpecular = pow(directLight, crestSpecularExponent) * 0.46 * mix(1.0, 0.82, directRoughnessWeight);
  let transmittedTransport = select(vec3<f32>(0.0), refractedRadiance * absorption * (1.0 - fresnel), transmissionRayActive);
  let reflectedTransport = reflectionRadiance * fresnel;
  let scatterTransport = waterScatter * (1.0 - fresnel);
  var color = transmittedTransport + reflectedTransport + scatterTransport;
  if (opticalLightingMode == 1) {
    let ggxRoughness = clamp(0.12 + directRoughness * 1.8, 0.12, 0.68);
    color += evaluateBoundedGgxDirectSpecular(
      worldNormal,
      viewToCamera,
      normalize(vec3<f32>(-0.28, 0.64, 1.72)),
      ggxRoughness,
    );
  } else if (opticalLightingMode == 2) {
    color += vec3<f32>(0.72, 0.92, 1.0) * broadSpecular
      + vec3<f32>(1.0) * crestSpecular * (0.22 + fresnel * 0.78);
  }
  return vec4<f32>(mix(background.rgb, color, geometricCoverage), background.a);
}
`;

function multiplyMat4(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

export async function createMlsJuiceRenderer({
  device,
  solver,
  hostEnvironment = false,
  transmissionMinContribution = DEFAULT_TRANSMISSION_MIN_CONTRIBUTION,
}) {
  let activeTransmissionMinContribution = normalizeTransmissionMinContribution(transmissionMinContribution);
  const renderParamsBuffer = device.createBuffer({
    size: 288,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    label: 'MLS screen-space surface render params',
  });
  const ownedBuffers = [renderParamsBuffer];
  const resources = [];
  let width = 0;
  let height = 0;

  const fallbackEnvTexture = device.createTexture({
    size: [2, 2],
    format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });

  async function compileShaderModule(code) {
    const m = device.createShaderModule({ label: 'MLS screen-space surface shader', code });
    const errors = (await m.getCompilationInfo()).messages.filter(msg => msg.type === 'error');
    if (errors.length) throw Error(errors.map(msg => msg.message).join('; '));
    return m;
  }

  try {
    const particleBuffer = solver.particles ?? solver.particleBuffer;
    let densityBuffer = solver.densities;
    if (!densityBuffer) {
      densityBuffer = device.createBuffer({
        size: Math.max(4, (solver.config?.capacity ?? 1) * 4),
        usage: GPUBufferUsage.STORAGE ?? 0x0080,
        label: 'MLS fallback densities',
      });
      ownedBuffers.push(densityBuffer);
    }

    const screenSpaceModule = await compileShaderModule(MLS_SCREEN_SPACE_SURFACE_SHADER);
    const refractionSceneSampler = device.createSampler({
      label: 'MLS refraction scene sampler',
      magFilter: 'linear',
      minFilter: 'linear',
    });

    const accumulationPipeline = await device.createRenderPipelineAsync({
      label: 'MLS particle depth-thickness accumulation',
      layout: 'auto',
      vertex: { module: screenSpaceModule, entryPoint: 'vs_accumulate' },
      fragment: {
        module: screenSpaceModule,
        entryPoint: 'fs_accumulate',
        targets: [
          {
            format: 'rgba16float',
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
          {
            format: 'rgba16float',
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'min' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'min' },
            },
          },
          {
            format: 'rgba16float',
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    });

    const refractionCompositePipeline = await device.createRenderPipelineAsync({
      label: 'MLS screen-space refraction composite',
      layout: 'auto',
      vertex: { module: screenSpaceModule, entryPoint: 'vs_fullscreen' },
      fragment: {
        module: screenSpaceModule,
        entryPoint: 'fs_refraction',
        targets: [{ format: 'rgba16float' }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    });

    const accumulationBindGroup = device.createBindGroup({
      layout: accumulationPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: particleBuffer } },
        { binding: 1, resource: { buffer: renderParamsBuffer } },
        { binding: 2, resource: { buffer: densityBuffer } },
      ],
    });

    const createRenderTexture = format => {
      const t = device.createTexture({
        size: [width, height],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      resources.push(t);
      return t;
    };

    let surfaceAccumulationTexture = null;
    let opticalSlabFrontDepthTexture = null;
    let opticalSlabBackDepthTexture = null;

    return {
      setOpticalSettings(next = {}) {
        if (Object.hasOwn(next, 'transmissionMinContribution') && next.transmissionMinContribution !== undefined) {
          activeTransmissionMinContribution = normalizeTransmissionMinContribution(next.transmissionMinContribution);
        }
        return { transmissionMinContribution: activeTransmissionMinContribution };
      },
      encode({
        encoder,
        hostCamera,
        environment = null,
        sceneColor,
        sceneDepth,
        target,
        width: fullWidth,
        height: fullHeight,
        beforeComposite = null,
        afterComposite = null,
      }) {
        const w = Math.max(1, Math.floor(fullWidth));
        const h = Math.max(1, Math.floor(fullHeight));
        if (w !== width || h !== height) {
          for (const t of resources) t.destroy();
          resources.length = 0;
          width = w;
          height = h;
          surfaceAccumulationTexture = createRenderTexture('rgba16float');
          opticalSlabFrontDepthTexture = createRenderTexture('rgba16float');
          opticalSlabBackDepthTexture = createRenderTexture('rgba16float');
        }

        const c = solver.config;
        hostCamera.updateMatrixWorld?.();
        const view = hostCamera.matrixWorldInverse.elements;
        const projection = hostCamera.projectionMatrix.elements;
        const inverseProjection = hostCamera.projectionMatrixInverse?.elements ?? new Float32Array(16);
        const inverseView = hostCamera.matrixWorld.elements;
        const viewProjection = multiplyMat4(projection, view);
        const inverseViewProjection = multiplyMat4(inverseView, inverseProjection);
        const right = [inverseView[0], inverseView[1], inverseView[2]];
        const up = [inverseView[4], inverseView[5], inverseView[6]];
        const forward = [-inverseView[8], -inverseView[9], -inverseView[10]];
        const eye = [inverseView[12], inverseView[13], inverseView[14]];
        const baseParticleRadius = c.particleRadius ?? (c.cell ?? 0.05) * 0.65;
        const near = hostCamera.near ?? 0.1;
        const far = hostCamera.far ?? 100;

        const renderData = new Float32Array(72);
        renderData.set(viewProjection, 0);
        renderData.set(inverseViewProjection, 16);
        renderData.set([...right, 0], 32);
        renderData.set([...up, 0], 36);
        renderData.set([...forward, 1], 40); // opticalLightingMode = 1 (bounded_ggx)
        renderData.set([...eye, 1], 44); // opticalFootprintMode = 1 (variance_filtered)
        renderData.set([width, height, baseParticleRadius, c.capacity], 48);
        renderData.set([1, 1, 1, 1], 52); // dense_exit_filtered, robust_dense_body, macro_micro_separated, consumerPresentation
        renderData.set([...c.min, c.cell], 56);
        renderData.set(
          localLiquidOpticalQueryControls({ near, far }, Boolean(hostEnvironment), activeTransmissionMinContribution),
          60,
        );
        renderData.set([c.restDensity ?? 4.0, c.particleRadius ?? (c.cell ?? 0.05) * 0.65, 1.333, 0], 64);
        device.queue.writeBuffer(renderParamsBuffer, 0, renderData);

        const accumulationView = surfaceAccumulationTexture.createView();
        const frontDepthView = opticalSlabFrontDepthTexture.createView();
        const backDepthView = opticalSlabBackDepthTexture.createView();

        const accumulationPass = encoder.beginRenderPass({
          label: 'MLS screen-space accumulation pass',
          colorAttachments: [
            {
              view: accumulationView,
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: 'clear',
              storeOp: 'store',
            },
            {
              view: frontDepthView,
              clearValue: { r: 30, g: 30, b: 30, a: 30 },
              loadOp: 'clear',
              storeOp: 'store',
            },
            {
              view: backDepthView,
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        });
        accumulationPass.setPipeline(accumulationPipeline);
        accumulationPass.setBindGroup(0, accumulationBindGroup);
        accumulationPass.draw(6, c.capacity);
        accumulationPass.end();

        beforeComposite?.({ frontDepthView });

        const compositeBindGroup = device.createBindGroup({
          layout: refractionCompositePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 1, resource: { buffer: renderParamsBuffer } },
            { binding: 4, resource: accumulationView },
            { binding: 5, resource: sceneColor },
            { binding: 6, resource: refractionSceneSampler },
            { binding: 7, resource: frontDepthView },
            { binding: 8, resource: backDepthView },
            { binding: 12, resource: (hostEnvironment && environment) ? environment : fallbackEnvTexture.createView() },
            { binding: 13, resource: sceneDepth },
          ],
        });

        const compositePass = encoder.beginRenderPass({
          label: 'MLS screen-space refraction composite pass',
          colorAttachments: [
            {
              view: target,
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        });
        compositePass.setPipeline(refractionCompositePipeline);
        compositePass.setBindGroup(0, compositeBindGroup);
        compositePass.draw(3, 1);
        compositePass.end();

        afterComposite?.({ frontDepthView });
      },
      read: () => ({
        method: 'mls_screen_space_refraction_v1',
        opticalTransportRoute: 'wgsl-host-camera-depth-radiance-query-v1',
        renderScale: 1,
        width,
        height,
        passes: ['surface_accumulation', 'screen_space_refraction_composite'],
        transmissionMinContribution: activeTransmissionMinContribution,
        refractionCutoffEnabled: true,
        environment: hostEnvironment ? 'host_environment_world_radiance' : 'analytic_sky_not_host_environment',
        surfaceTension: false,
      }),
      dispose() {
        fallbackEnvTexture.destroy();
        for (const b of ownedBuffers) b.destroy();
        for (const t of resources) t.destroy();
      },
    };
  } catch (error) {
    fallbackEnvTexture.destroy();
    for (const b of ownedBuffers) b.destroy();
    for (const t of resources) t.destroy();
    throw error;
  }
}
