import { buildPhaseMatchedHybridSmokePlan } from './smoke-splat-motion-source.mjs';

export const SPATIAL_STRATA_HYBRID_SMOKE_ROUTE_IDENTITY = 'spatial-strata-hybrid-smoke-v0';
export const SPATIAL_STRATA_HYBRID_SMOKE_LIVE_ROUTE_IDENTITY = 'spatial-strata-hybrid-smoke-live-coupled-v0';
export const SPATIAL_STRATA_HYBRID_SMOKE_RENDERER_IDENTITY = 'phase-matched-spatial-strata-front-back-raster-v0';
export const SPATIAL_STRATA_HYBRID_SMOKE_LIVE_APPEARANCE_IDENTITY = 'temperature-lit-sparse-live-smoke-v0';
export const SPATIAL_STRATA_HYBRID_SMOKE_LIVE_COARSE_COVERAGE = 1.8;
export const SPATIAL_STRATA_HYBRID_SMOKE_LIVE_FINE_COVERAGE = 1.7;
export const SPATIAL_STRATA_HYBRID_SMOKE_OFFLINE_FINE_COVERAGE = 1.22;
export const SPATIAL_STRATA_HYBRID_SMOKE_LIVE_OPTICAL_GAIN = 12;

const PACKED_SPLAT_FLOATS = 16;
const DESCRIPTOR_FLOATS = 8;
const UNIFORM_FLOATS = 36;

const SPATIAL_STRATA_HYBRID_SMOKE_WGSL = `
struct PackedSplat { a: vec4<f32>, b: vec4<f32>, c: vec4<f32>, d: vec4<f32> };
struct Descriptor { transform: vec4<f32>, phase: vec4<f32> };
struct Uniforms {
  viewProj: mat4x4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  cameraPosition: vec4<f32>,
  params: vec4<f32>,
  counts: vec4<f32>,
};
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) extinctionMass: f32,
  @location(2) densityTemperature: vec2<f32>,
  @location(3) hierarchyRole: f32,
  @location(4) supportArea: f32,
  @location(5) linearDepth: f32,
};
struct HybridSmokeOutput {
  @location(0) frontColor: vec4<f32>,
  @location(1) frontInterval: vec4<f32>,
  @location(2) backColor: vec4<f32>,
  @location(3) backInterval: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> phase0: array<PackedSplat>;
@group(0) @binding(1) var<storage, read> phase1: array<PackedSplat>;
@group(0) @binding(2) var<storage, read> descriptors: array<Descriptor>;
@group(0) @binding(3) var<uniform> u: Uniforms;
@group(0) @binding(4) var hybridSplatDepthMoments: texture_2d<f32>;

fn quadCorner(vertexIndex: u32) -> vec2<f32> {
  let index = vertexIndex % 6u;
  if (index == 0u) { return vec2<f32>(-1.0, -1.0); }
  if (index == 1u) { return vec2<f32>(1.0, -1.0); }
  if (index == 2u) { return vec2<f32>(-1.0, 1.0); }
  if (index == 3u) { return vec2<f32>(-1.0, 1.0); }
  if (index == 4u) { return vec2<f32>(1.0, -1.0); }
  return vec2<f32>(1.0, 1.0);
}

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) drawInstance: u32) -> VertexOut {
  let flameInstanceCount = max(1u, u32(u.params.y));
  let sourceIndex = drawInstance / flameInstanceCount;
  let flameInstanceIndex = drawInstance % flameInstanceCount;
  let descriptor = descriptors[flameInstanceIndex];
  let productIndex = u32(descriptor.phase.x);
  let productCount = select(u32(u.counts.y), u32(u.counts.x), productIndex == 0u);
  var out: VertexOut;
  if (sourceIndex >= productCount) {
    out.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    out.local = vec2<f32>(2.0);
    out.extinctionMass = 0.0;
    out.densityTemperature = vec2<f32>(0.0);
    out.hierarchyRole = 0.0;
    out.supportArea = 1.0;
    out.linearDepth = 0.0;
    return out;
  }
  var splat = phase0[sourceIndex];
  if (productIndex == 1u) { splat = phase1[sourceIndex]; }
  let corner = quadCorner(vertexIndex);
  let instanceScale = descriptor.transform.w;
  let relativeAge = descriptor.phase.y;
  let phaseTime = select(
    0.0,
    fract(u.params.x * u.params.w + relativeAge * 0.5) * 0.20,
    u.counts.w > 0.5,
  );
  let transformedPosition = (splat.a.xyz + splat.d.xyz * phaseTime) * instanceScale + descriptor.transform.xyz;
  let radiusX = max(0.008, splat.b.z) * instanceScale;
  let radiusY = max(0.008, splat.b.w) * instanceScale;
  let radiusZ = max(0.008, splat.c.x) * instanceScale;
  let principalAxisPacked = vec3<f32>(splat.a.w, splat.b.x, splat.b.y);
  let principalAxis = principalAxisPacked / max(length(principalAxisPacked), 0.000001);
  let radialRadius = sqrt(radiusX * radiusZ);
  let radialVariance = radialRadius * radialRadius;
  let varianceDelta = radiusY * radiusY - radialVariance;
  let axisRight = dot(principalAxis, u.cameraRight.xyz);
  let axisUp = dot(principalAxis, u.cameraUp.xyz);
  let covarianceXX = radialVariance + varianceDelta * axisRight * axisRight;
  let covarianceYY = radialVariance + varianceDelta * axisUp * axisUp;
  let covarianceXY = varianceDelta * axisRight * axisUp;
  let discriminant = length(vec2<f32>(covarianceXX - covarianceYY, 2.0 * covarianceXY));
  let majorVariance = max(0.0000001, (covarianceXX + covarianceYY + discriminant) * 0.5);
  let minorVariance = max(0.0000001, (covarianceXX + covarianceYY - discriminant) * 0.5);
  let angle = 0.5 * atan2(2.0 * covarianceXY, covarianceXX - covarianceYY);
  let footprintRight = u.cameraRight.xyz * cos(angle) + u.cameraUp.xyz * sin(angle);
  let footprintUp = -u.cameraRight.xyz * sin(angle) + u.cameraUp.xyz * cos(angle);
  let liveProduct = 1.0 - clamp(u.counts.w, 0.0, 1.0);
  let offlineFootprint = mix(
    u.params.z,
    ${SPATIAL_STRATA_HYBRID_SMOKE_OFFLINE_FINE_COVERAGE},
    splat.d.w,
  );
  let liveCoverage = mix(
    u.params.z,
    ${SPATIAL_STRATA_HYBRID_SMOKE_LIVE_FINE_COVERAGE},
    splat.d.w,
  );
  let footprintScale = mix(offlineFootprint, liveCoverage, liveProduct);
  let projectedRadiusX = sqrt(majorVariance) * footprintScale;
  let projectedRadiusY = sqrt(minorVariance) * footprintScale;
  let world = transformedPosition
    + footprintRight * corner.x * projectedRadiusX
    + footprintUp * corner.y * projectedRadiusY;
  out.position = u.viewProj * vec4<f32>(world, 1.0);
  out.local = corner;
  out.extinctionMass = splat.c.y;
  out.densityTemperature = splat.c.zw;
  out.hierarchyRole = splat.d.w;
  out.supportArea = 3.14159265 * projectedRadiusX * projectedRadiusY;
  out.linearDepth = length(transformedPosition - u.cameraPosition.xyz);
  return out;
}

@fragment
fn fs(in: VertexOut) -> HybridSmokeOutput {
  let radius2 = dot(in.local, in.local);
  if (radius2 > 1.0 || in.extinctionMass <= 0.0) { discard; }
  let gaussian = exp(-radius2 * mix(2.6, 4.2, in.hierarchyRole));
  let liveProduct = 1.0 - clamp(u.counts.w, 0.0, 1.0);
  let opticalGain = mix(1.0, ${SPATIAL_STRATA_HYBRID_SMOKE_LIVE_OPTICAL_GAIN}, liveProduct);
  let tauCeiling = mix(0.36, 0.52, liveProduct);
  let tau = clamp((in.extinctionMass / max(in.supportArea, 0.000001)) * gaussian * opticalGain, 0.0, tauCeiling);
  let opacity = 1.0 - exp(-tau);
  let densityCue = clamp(in.densityTemperature.x * 0.45, 0.0, 1.0);
  let heatCue = clamp(in.densityTemperature.y * 0.16, 0.0, 0.35);
  let coarseColor = mix(vec3<f32>(0.045, 0.055, 0.060), vec3<f32>(0.100, 0.105, 0.108), densityCue);
  let fineColor = mix(vec3<f32>(0.072, 0.078, 0.080), vec3<f32>(0.145, 0.126, 0.105), heatCue);
  let liveDensityCue = clamp(in.densityTemperature.x * 4.5, 0.0, 1.0);
  let liveHeatCue = clamp(in.densityTemperature.y * 5.0, 0.0, 0.82);
  let liveCoarseColor = mix(vec3<f32>(0.110, 0.085, 0.060), vec3<f32>(0.380, 0.180, 0.055), liveDensityCue);
  let liveFineColor = mix(vec3<f32>(0.085, 0.090, 0.092), vec3<f32>(0.560, 0.245, 0.072), liveHeatCue);
  let offlineColor = mix(coarseColor, fineColor, in.hierarchyRole);
  let liveColor = mix(liveCoarseColor, liveFineColor, in.hierarchyRole);
  let premultiplied = vec4<f32>(mix(offlineColor, liveColor, liveProduct) * opacity, opacity);
  let pixel = vec2<i32>(in.position.xy);
  let dimensions = vec2<i32>(textureDimensions(hybridSplatDepthMoments));
  let moments = textureLoad(hybridSplatDepthMoments, clamp(pixel, vec2<i32>(0), dimensions - vec2<i32>(1)), 0);
  let flamePresent = moments.y > 0.000001;
  let flameDepth = moments.x / max(moments.y, 0.000001);
  let smokeIsFront = !flamePresent || in.linearDepth <= flameDepth;
  var out: HybridSmokeOutput;
  if (smokeIsFront) {
    out.frontColor = premultiplied;
    out.frontInterval = vec4<f32>(in.linearDepth, 1.0, in.linearDepth, in.linearDepth);
    out.backColor = vec4<f32>(0.0);
    out.backInterval = vec4<f32>(65504.0, 65504.0, 65504.0, 0.0);
  } else {
    out.frontColor = vec4<f32>(0.0);
    out.frontInterval = vec4<f32>(0.0);
    out.backColor = premultiplied;
    out.backInterval = vec4<f32>(in.linearDepth, 1.0, in.linearDepth, in.linearDepth);
  }
  return out;
}
`;

function copyPackedUpload(device, upload, index) {
  if (!(upload?.packed instanceof Float32Array)) throw new Error(`hybrid smoke product ${index} has no packed upload`);
  if (upload.packed.length % PACKED_SPLAT_FLOATS !== 0) throw new Error(`hybrid smoke product ${index} packing is invalid`);
  const buffer = device.createBuffer({
    label: `kaminos spatial-strata smoke product ${index}`,
    size: upload.packed.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Float32Array(buffer.getMappedRange()).set(upload.packed);
  buffer.unmap();
  return buffer;
}

function resolveProductBuffer(device, upload, index) {
  if (upload?.packedBuffer) {
    if (upload.productDevice !== device) throw new Error(`hybrid smoke product ${index} belongs to another GPU device`);
    return { buffer: upload.packedBuffer, ownedByRenderer: false };
  }
  return { buffer: copyPackedUpload(device, upload, index), ownedByRenderer: true };
}

export function createSpatialStrataHybridSmokeRenderer({
  device,
  products,
  productSource = null,
  fineLodFraction = 1,
  requestedRoute = SPATIAL_STRATA_HYBRID_SMOKE_ROUTE_IDENTITY,
  effectiveRoute = SPATIAL_STRATA_HYBRID_SMOKE_ROUTE_IDENTITY,
  coarseCoverageScale = SPATIAL_STRATA_HYBRID_SMOKE_LIVE_COARSE_COVERAGE,
  motionRate = 0.16,
} = {}) {
  if (!device?.createRenderPipeline) throw new TypeError('a WebGPU device is required');
  if (productSource !== null && typeof productSource !== 'function') throw new TypeError('productSource must be a function');
  if (productSource && products !== undefined) throw new Error('provide products or productSource, not both');
  if (!productSource && (!Array.isArray(products) || products.length !== 2)) {
    throw new Error(`the spatial-strata hybrid renderer requires exactly two products, got ${products?.length ?? 0}`);
  }
  const productSourceMode = productSource ? 'live-owned-product-source' : 'offline-packed-product-source';
  let plan = null;
  let productBufferBindings = [];
  let productWriteTicks = [];
  if (!productSource) {
    plan = buildPhaseMatchedHybridSmokePlan({
      products,
      flameInstances: [{ index: 0, phaseHistoryOffsetSlots: 0, transform: { translate: [0, 0, 0], scale: 1 } }],
      fineLodFraction,
      requestedRoute,
      effectiveRoute,
    });
    productBufferBindings = plan.productUploads.map((upload, index) => resolveProductBuffer(device, upload, index));
    productWriteTicks = [plan.oldestSlotWriteTick, plan.latestSlotWriteTick];
  }
  const shader = device.createShaderModule({
    label: `kaminos ${SPATIAL_STRATA_HYBRID_SMOKE_RENDERER_IDENTITY} wgsl`,
    code: SPATIAL_STRATA_HYBRID_SMOKE_WGSL,
  });
  const premultipliedOver = {
    color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  };
  const extremaMax = {
    color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
    alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
  };
  const backIntervalExtrema = {
    color: { srcFactor: 'one', dstFactor: 'one', operation: 'min' },
    alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
  };
  const pipeline = device.createRenderPipeline({
    label: `kaminos ${SPATIAL_STRATA_HYBRID_SMOKE_RENDERER_IDENTITY}`,
    layout: 'auto',
    vertex: { module: shader, entryPoint: 'vs' },
    fragment: {
      module: shader,
      entryPoint: 'fs',
      targets: [
        { format: 'rgba16float', blend: premultipliedOver },
        { format: 'rgba16float', blend: extremaMax },
        { format: 'rgba16float', blend: premultipliedOver },
        { format: 'rgba16float', blend: backIntervalExtrema },
      ],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
  });
  const uniformBuffer = device.createBuffer({
    label: 'kaminos spatial-strata hybrid smoke uniforms',
    size: UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  let descriptorBuffer = null;
  let descriptorCapacity = 0;
  let bindGroup = null;
  let boundMomentsTexture = null;
  let lastUpdateMs = 0;
  let lastElapsedSeconds = null;
  let phaseBindingSignature = '';
  let productBindingSignature = '';

  function ensureDescriptorBuffer(instanceCount) {
    if (descriptorBuffer && descriptorCapacity >= instanceCount) return;
    descriptorBuffer?.destroy();
    descriptorCapacity = instanceCount;
    descriptorBuffer = device.createBuffer({
      label: 'kaminos phase-matched spatial-strata smoke descriptors',
      size: Math.max(1, descriptorCapacity) * DESCRIPTOR_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    bindGroup = null;
  }

  function update({ flameInstances, viewProj, cameraMatrix, cameraPosition, elapsedSeconds = 0 } = {}) {
    const activeProducts = productSource ? productSource() : products;
    if (!Array.isArray(activeProducts) || activeProducts.length !== 2) {
      throw new Error(`spatial-strata hybrid smoke requires two consecutive products, got ${activeProducts?.length ?? 0}`);
    }
    const nextProductBindingSignature = JSON.stringify(activeProducts.map(product => [
      product?.identity,
      product?.slotIdentity?.slotWriteTick,
    ]));
    const nextPhaseBindingSignature = JSON.stringify([nextProductBindingSignature, flameInstances.map(instance => [
      instance.index,
      instance.phaseHistoryOffsetSlots,
      instance.transform?.translate,
      instance.transform?.scale,
    ])]);
    if (nextPhaseBindingSignature !== phaseBindingSignature) {
      plan = buildPhaseMatchedHybridSmokePlan({
        products: activeProducts,
        flameInstances,
        fineLodFraction,
        requestedRoute,
        effectiveRoute,
      });
      if (nextProductBindingSignature !== productBindingSignature) {
        if (productSource) {
          productBufferBindings = plan.productUploads.map((upload, index) => resolveProductBuffer(device, upload, index));
        }
        productWriteTicks = [plan.oldestSlotWriteTick, plan.latestSlotWriteTick];
        productBindingSignature = nextProductBindingSignature;
        bindGroup = null;
        boundMomentsTexture = null;
      }
      ensureDescriptorBuffer(plan.flameInstanceCount);
      const descriptors = new Float32Array(plan.flameInstanceCount * DESCRIPTOR_FLOATS);
      for (const binding of plan.instanceBindings) {
        const offset = binding.instanceIndex * DESCRIPTOR_FLOATS;
        descriptors.set([...binding.translation, binding.scale], offset);
        descriptors.set([binding.productIndex, binding.relativeAgeSlots, binding.productWriteTick, 1], offset + 4);
      }
      device.queue.writeBuffer(descriptorBuffer, 0, descriptors);
      phaseBindingSignature = nextPhaseBindingSignature;
    }
    const uniforms = new Float32Array(UNIFORM_FLOATS);
    uniforms.set(viewProj, 0);
    uniforms.set([cameraMatrix[0], cameraMatrix[1], cameraMatrix[2], 0], 16);
    uniforms.set([cameraMatrix[4], cameraMatrix[5], cameraMatrix[6], 0], 20);
    uniforms.set([...cameraPosition, 1], 24);
    uniforms.set([elapsedSeconds, plan.flameInstanceCount, coarseCoverageScale, motionRate], 28);
    uniforms.set([
      plan.productUploads[0].selectedCount,
      plan.productUploads[1].selectedCount,
      2,
      productSource ? 0 : 1,
    ], 32);
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);
    lastUpdateMs = performance.now();
    lastElapsedSeconds = elapsedSeconds;
    return plan;
  }

  function encodeSpatialStrataSmoke(encoder, {
    hybridSplatDepthMoments,
    frontColor,
    frontInterval,
    backColor,
    backInterval,
  } = {}) {
    if (!descriptorBuffer || !plan?.flameInstanceCount) throw new Error('spatial-strata smoke renderer must be updated before encode');
    if (boundMomentsTexture !== hybridSplatDepthMoments || !bindGroup) {
      bindGroup = device.createBindGroup({
        label: 'kaminos phase-matched spatial-strata hybrid bind group',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: productBufferBindings[0].buffer } },
          { binding: 1, resource: { buffer: productBufferBindings[1].buffer } },
          { binding: 2, resource: { buffer: descriptorBuffer } },
          { binding: 3, resource: { buffer: uniformBuffer } },
          { binding: 4, resource: hybridSplatDepthMoments.createView() },
        ],
      });
      boundMomentsTexture = hybridSplatDepthMoments;
    }
    const pass = encoder.beginRenderPass({
      label: `kaminos ${SPATIAL_STRATA_HYBRID_SMOKE_RENDERER_IDENTITY} pass`,
      colorAttachments: [
        { view: frontColor.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
        { view: frontInterval.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
        { view: backColor.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
        { view: backInterval.createView(), clearValue: { r: 65504, g: 65504, b: 65504, a: 0 }, loadOp: 'clear', storeOp: 'store' },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6, plan.drawInstanceCount);
    pass.end();
    return plan;
  }

  return {
    update,
    encodeSpatialStrataSmoke,
    debugState() {
      const compactPlan = plan ? {
        identity: plan.identity,
        status: plan.status,
        requestedRoute: plan.requestedRoute,
        effectiveRoute: plan.effectiveRoute,
        temporalAuthority: plan.temporalAuthority,
        temporalHorizonProducts: plan.temporalHorizonProducts,
        latestSlotWriteTick: plan.latestSlotWriteTick,
        oldestSlotWriteTick: plan.oldestSlotWriteTick,
        flameInstanceCount: plan.flameInstanceCount,
        uniqueProductCount: plan.uniqueProductCount,
        fineLodFraction: plan.fineLodFraction,
        maxSelectedProductCount: plan.maxSelectedProductCount,
        drawInstanceCount: plan.drawInstanceCount,
        drawAuthority: plan.drawAuthority,
        drawMode: plan.drawMode,
        rejectedExtinctionMass: plan.rejectedExtinctionMass,
        productUploads: plan.productUploads.map(upload => ({
          productIdentity: upload.productIdentity,
          selectedCount: upload.selectedCount,
          sourceCount: upload.sourceCount,
          capacity: upload.capacity,
          activeCount: upload.activeCount,
          requestedRepresentation: upload.requestedRepresentation,
          effectiveRepresentation: upload.effectiveRepresentation,
          fallbackReason: upload.fallbackReason,
          drawAuthority: upload.drawAuthority ?? null,
          drawMode: upload.drawMode ?? null,
          coarseCount: upload.coarseCount,
          fineCount: upload.fineCount,
          sourceExtinctionMass: upload.sourceExtinctionMass,
          representedExtinctionMass: upload.representedExtinctionMass,
          rejectedExtinctionMass: upload.rejectedExtinctionMass,
          coarseMassCompensation: upload.coarseMassCompensation,
        })),
        instanceBindings: plan.instanceBindings,
      } : null;
      return {
        identity: SPATIAL_STRATA_HYBRID_SMOKE_RENDERER_IDENTITY,
        status: plan?.status ?? 'unbound',
        requestedRoute,
        effectiveRoute,
        productSourceMode,
        appearanceIdentity: productSource
          ? SPATIAL_STRATA_HYBRID_SMOKE_LIVE_APPEARANCE_IDENTITY
          : 'offline-spatial-strata-smoke-appearance-v0',
        coverage: {
          authority: productSource
            ? 'live-coarse-uniform-fine-fixed-v0'
            : 'offline-coarse-uniform-fine-fixed-v0',
          coarse: coarseCoverageScale,
          fine: productSource
            ? SPATIAL_STRATA_HYBRID_SMOKE_LIVE_FINE_COVERAGE
            : SPATIAL_STRATA_HYBRID_SMOKE_OFFLINE_FINE_COVERAGE,
        },
        productWriteTicks: [...productWriteTicks],
        lastUpdateMs,
        lastElapsedSeconds,
        temporalHorizonProducts: plan?.temporalHorizonProducts ?? 0,
        uniqueProductCount: plan?.uniqueProductCount ?? 0,
        flameInstanceCount: plan?.flameInstanceCount ?? 0,
        drawInstanceCount: plan?.drawInstanceCount ?? 0,
        drawAuthority: plan?.drawAuthority ?? null,
        drawMode: plan?.drawMode ?? null,
        rejectedExtinctionMass: plan?.rejectedExtinctionMass ?? null,
        plan: compactPlan,
      };
    },
    dispose() {
      descriptorBuffer?.destroy();
      uniformBuffer.destroy();
      productBufferBindings.forEach(binding => {
        if (binding.ownedByRenderer) binding.buffer.destroy();
      });
      productBufferBindings = [];
      descriptorBuffer = null;
      bindGroup = null;
      boundMomentsTexture = null;
    },
  };
}
