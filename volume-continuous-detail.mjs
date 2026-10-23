import { waveletCurlUnit, waveletBlendWeights, waveletTurbulenceWgsl } from './volume-wavelet-turbulence.mjs';

export const CONTINUOUS_DETAIL_BASIS = Object.freeze({identity:'periodic-curl-64x8-rgba16float-v1',size:64,period:8});

// Cache the basis, not the displaced material: ray samples still resolve subcell detail.
export async function createContinuousDetailBasis(device) {
  const {size,period,identity}=CONTINUOUS_DETAIL_BASIS;
  const texture=device.createTexture({label:identity,dimension:'3d',size:[size,size,size],format:'rgba16float',
    usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
  try {
    const module=device.createShaderModule({label:identity,code:waveletTurbulenceWgsl({latticePeriod:period})+/* wgsl */`
@group(0) @binding(0) var basis: texture_storage_3d<rgba16float, write>;
@compute @workgroup_size(4,4,4) fn build(@builtin(global_invocation_id) cell: vec3<u32>) {
  if (any(cell >= vec3<u32>(${size}u))) { return; }
  let p=(vec3<f32>(cell)+vec3<f32>(0.5))*${period/size};
  textureStore(basis,vec3<i32>(cell),vec4<f32>(waveletCurlUnit(p),1.0));
}`});
    const info=await module.getCompilationInfo();
    const errors=info.messages.filter(message=>message.type==='error');
    if(errors.length)throw new Error(`Continuous detail basis WGSL: ${errors.map(m=>m.message).join('\n')}`);
    const pipeline=await device.createComputePipelineAsync({label:identity,layout:'auto',compute:{module,entryPoint:'build'}});
    const bindings=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView()}]});
    const encoder=device.createCommandEncoder({label:identity});
    const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bindings);
    pass.dispatchWorkgroups(size/4,size/4,size/4);pass.end();device.queue.submit([encoder.finish()]);
    const sampler=device.createSampler({label:identity,addressModeU:'repeat',addressModeV:'repeat',addressModeW:'repeat',minFilter:'linear',magFilter:'linear'});
    return {texture,sampler,receipt:{...CONTINUOUS_DETAIL_BASIS,bytes:size**3*8,generation:'once-per-device',materialBaked:false},dispose(){texture.destroy();}};
  }catch(error){texture.destroy();throw error;}
}

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export function resolveContinuousDetail(controls = {}) {
  const amount = Math.min(2, Math.max(0, finite(controls.renderDetail, 0)));
  const scale = Math.min(4, Math.max(0.5, finite(controls.renderDetailScale, 2)));
  const fine = Math.min(1, Math.max(0, finite(controls.renderDetailFine, 0.35)));
  return { identity: 'continuous-advected-material-displacement-v0', amount, scale, fine, admitted: amount > 0 };
}

// A bounded lookup displacement, not a velocity or a conservative transport law.
export function continuousDetailOffset(a, b, step, amount, scale, fineWeight = 0.35) {
  const config = resolveContinuousDetail({ renderDetail: amount, renderDetailScale: scale, renderDetailFine: fineWeight });
  const noise = c => {
    const p = c.map(x => x / config.scale);
    const coarse = waveletCurlUnit(p);
    const fine = waveletCurlUnit(p.map((x, i) => x * 2 + [17.1, 31.7, 11.3][i]));
    return coarse.map((x, i) => x + config.fine * fine[i]);
  };
  if (!config.admitted) return [0, 0, 0];
  const weights = waveletBlendWeights(step), na = noise(a), nb = noise(b);
  const n = na.map((x, i) => weights.a * x + weights.b * nb[i]);
  const gain = config.amount / Math.sqrt(1 + n.reduce((s, x) => s + x * x, 0));
  return n.map(x => x * gain);
}

export const CONTINUOUS_DETAIL_WGSL = /* wgsl */`
override CONTINUOUS_DETAIL_ANALYTIC: bool = false;
@group(0) @binding(34) var continuousDetailBasis: texture_3d<f32>;
@group(0) @binding(35) var continuousDetailSampler: sampler;
fn continuousDetailCurl(p: vec3<f32>) -> vec3<f32> {
  if (CONTINUOUS_DETAIL_ANALYTIC) { return waveletCurlUnit(p); }
  return textureSampleLevel(continuousDetailBasis, continuousDetailSampler, p / ${CONTINUOUS_DETAIL_BASIS.period.toFixed(1)}, 0.0).xyz;
}
fn continuousDetailNoise(coord: vec3<f32>) -> vec3<f32> {
  let p = coord / u.continuous_detail.y;
  var n = continuousDetailCurl(p);
  if (u.continuous_detail.z > 0.0) { n += u.continuous_detail.z * continuousDetailCurl(p * 2.0 + vec3<f32>(17.1, 31.7, 11.3)); }
  return n;
}
fn continuousDetailPosition(p: vec3<f32>) -> vec3<f32> {
  if (u.continuous_detail.x <= 0.0) { return p; }
  let cell = worldToCell(p);
  if (sceneSolidAt(vec3<i32>(floor(cell)))) { return p; }
  let a = continuousDetailNoise(waveletCoordSample(cell, 0));
  let b = continuousDetailNoise(waveletCoordSample(cell, 1));
  // The generation stamp stays with the consumed texture during both moving and held draws.
  let phase = textureLoad(waveletCoordSrc, vec3<i32>(0), 0).w;
  let weight = waveletBlendA(u32(phase), WAVELET_COHERENCE_PERIOD_STEPS);
  let n = mix(b, a, weight);
  let edge = min(cell, vec3<f32>(f32(GRID), f32(GRID_Y), f32(GRID)) - cell);
  let fade = smoothstep(0.0, 1.0, min(edge.x, min(edge.y, edge.z)));
  let offset = n * (u.continuous_detail.x * fade / sqrt(1.0 + dot(n, n)));
  return cellToWorld(sceneClipCharacteristic(cell, cell + offset));
}
`;
