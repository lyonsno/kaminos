import {PARTICLE_LIGHT_MATERIAL_WGSL} from './volume-optical-particles.mjs';
import {PARTICLE_STATE_WGSL} from './volume-particle-state.mjs';

export const RECEIVER_SUCCESSION_WGSL = /* wgsl */`
${PARTICLE_LIGHT_MATERIAL_WGSL}
${PARTICLE_STATE_WGSL}

struct Coverage {
  origin: vec4<f32>,
  extent: vec4<f32>,
  grid: vec4<u32>,
  work: vec4<u32>,
  shape: vec4<f32>,
}
struct Cell { lo: vec3<f32>, hi: vec3<f32>, site: u32 }
struct Site {
  primary: vec2<u32>,
  successor: vec2<u32>,
  fadeStart: u32,
  fading: u32,
  recruiting: u32,
}

@group(0) @binding(0) var<uniform> coverage: Coverage;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;
@group(0) @binding(2) var<storage, read> generations: array<u32>;
@group(0) @binding(3) var<storage, read> fine: array<vec4<f32>>;
@group(0) @binding(4) var<uniform> optical: Options;
@group(0) @binding(5) var<storage, read_write> sites: array<Site>;
@group(0) @binding(6) var<storage, read_write> offers: array<atomic<u32>>;
@group(0) @binding(7) var<storage, read_write> centers: array<vec4<f32>>;
@group(0) @binding(8) var<storage, read> radiance: array<vec4<f32>>;
@group(0) @binding(9) var<storage, read_write> weights: array<f32>;

// Split along the longest remaining axis in proportion to leaf count. This
// gives exactly the requested number of fixed sites, including prime counts,
// with one owning cell for each position and no particle-by-site cross product.
fn cellFor(position: vec3<f32>, wanted: u32, byPosition: bool) -> Cell {
  var lo = coverage.origin.xyz;
  var hi = lo + coverage.extent.xyz;
  var site = 0u;
  var count = coverage.work.y;
  while (count > 1u) {
    let span = hi - lo;
    var axis = select(0u, 1u, span.y > span.x);
    axis = select(axis, 2u, span.z > span[axis]);
    let left = count / 2u;
    let split = lo[axis] + span[axis] * f32(left) / f32(count);
    if (select(wanted < site + left, position[axis] < split, byPosition)) {
      hi[axis] = split;
      count = left;
    } else {
      lo[axis] = split;
      site += left;
      count -= left;
    }
  }
  return Cell(lo, hi, site);
}

fn cellDistance(p: vec3<f32>, cell: Cell) -> f32 {
  let q = abs((p - cell.lo) / (cell.hi - cell.lo) * 2.0 - 1.0);
  return max(q.x, max(q.y, q.z));
}

fn contributes(p: Particle) -> bool {
  return p.anchor.w > 0.0 && p.shape.w > 0.0 &&
    (any(particleLightIntrinsic(p) > vec3<f32>(0.0)) || particleLightExtinction(p, optical) > 0.0);
}

fn validKey(key: vec2<u32>, cell: Cell) -> bool {
  if (key.y == 0u || key.y == 0xffffffffu || key.x >= coverage.work.x ||
    key.y != generations[key.x]) {
    return false;
  }
  let p = particles[key.x];
  return contributes(p) && cellDistance(p.anchor.xyz, cell) < coverage.shape.y;
}

fn approaching(p: Particle, cell: Cell) -> bool {
  let at = vec3<u32>(clamp(
    floor((p.anchor.xyz - coverage.origin.xyz) / coverage.extent.w),
    vec3<f32>(0), vec3<f32>(coverage.grid.xyz - vec3<u32>(1))));
  let offset = at.x + coverage.grid.x * (at.y + coverage.grid.y * at.z);
  let velocity = fine[offset * 4u].xyz * coverage.extent.w + vec3<f32>(0, p.motion.y, 0);
  return dot(velocity, (cell.lo + cell.hi) * 0.5 - p.anchor.xyz) > 0.0;
}

@compute @workgroup_size(64)
fn prepareSites(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= coverage.work.y) { return; }
  let cell = cellFor(vec3<f32>(0), i, false);
  var site = sites[i];
  let wasFading = site.fading != 0u;
  if (!validKey(site.primary, cell)) {
    site.primary = vec2<u32>(0);
    site.fading = 0u;
  }
  if (validKey(site.successor, cell)) {
    let p = particles[site.successor.x];
    let inCore = cellDistance(p.anchor.xyz, cell) <= coverage.shape.x;
    if (site.primary.y == 0u && (inCore || wasFading)) {
      site.primary = site.successor;
      site.successor = vec2<u32>(0);
      site.fading = 0u;
    } else if (site.fading == 0u && !inCore && !approaching(p, cell)) {
      site.successor = vec2<u32>(0);
    }
  } else {
    site.successor = vec2<u32>(0);
    site.fading = 0u;
  }
  let hasCore = site.primary.y != 0u &&
    cellDistance(particles[site.primary.x].anchor.xyz, cell) <= coverage.shape.x;
  site.recruiting = select(0u, 1u, !hasCore && site.successor.y == 0u);
  sites[i] = site;
  atomicStore(&offers[i], 0xffffffffu);
}

@compute @workgroup_size(64)
fn offerCandidates(@builtin(global_invocation_id) id: vec3<u32>) {
  let slot = id.x;
  if (slot >= coverage.work.x) { return; }
  let p = particles[slot];
  if (p.anchor.w <= 0.0 || any(p.anchor.xyz < coverage.origin.xyz) ||
    any(p.anchor.xyz >= coverage.origin.xyz + coverage.extent.xyz)) { return; }
  let cell = cellFor(p.anchor.xyz, 0u, true);
  let site = sites[cell.site];
  if (site.recruiting == 0u || (site.primary.y != 0u && site.primary.x == slot)) { return; }
  let generation = generations[slot];
  if (generation == 0u || generation == 0xffffffffu || !contributes(p)) { return; }
  let distance = cellDistance(p.anchor.xyz, cell);
  if (distance >= coverage.shape.y ||
    (distance > coverage.shape.x && !approaching(p, cell))) { return; }
  // Pack an ordered distance bucket and exact slot. This quantizes the tie
  // break only. Every admitted particle is still eligible to make an offer.
  let bucket = u32(clamp(distance, 0.0, 1.0) * f32(coverage.work.w));
  atomicMin(&offers[cell.site], bucket * coverage.work.x + slot);
}

@compute @workgroup_size(64)
fn resolveSites(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= coverage.work.y) { return; }
  var site = sites[i];
  let cell = cellFor(vec3<f32>(0), i, false);
  let offer = atomicLoad(&offers[i]);
  if (site.recruiting != 0u && offer != 0xffffffffu) {
    let slot = offer % coverage.work.x;
    let key = vec2<u32>(slot, generations[slot]);
    if (site.primary.y == 0u && cellDistance(particles[slot].anchor.xyz, cell) <= coverage.shape.x) {
      site.primary = key;
    } else {
      site.successor = key;
    }
  }
  let first = i * 2u;
  centers[first] = vec4<f32>(0);
  centers[first + 1u] = vec4<f32>(0);
  if (site.primary.y != 0u) {
    centers[first] = vec4<f32>(particles[site.primary.x].anchor.xyz, coverage.shape.z);
  }
  if (site.successor.y != 0u) {
    let position = particles[site.successor.x].anchor.xyz;
    if (site.fading != 0u || cellDistance(position, cell) <= coverage.shape.x) {
      centers[first + 1u] = vec4<f32>(position, coverage.shape.z);
    }
  }
  sites[i] = site;
}

@compute @workgroup_size(64)
fn assignHandoverWeights(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= coverage.work.y) { return; }
  let first = i * 2u;
  var site = sites[i];
  let oldValid = centers[first].w > 0.0 && radiance[first].w > 0.0;
  let newValid = centers[first + 1u].w > 0.0 && radiance[first + 1u].w > 0.0;
  weights[first] = select(0.0, 1.0, oldValid);
  weights[first + 1u] = 0.0;
  if (newValid) {
    if (site.fading == 0u || coverage.work.z < site.fadeStart) {
      site.fadeStart = coverage.work.z;
      site.fading = 1u;
    }
    let t = min(1.0, f32(coverage.work.z - site.fadeStart) / coverage.shape.w);
    let weight = select(1.0, smoothstep(0.0, 1.0, t), oldValid);
    weights[first] = 1.0 - weight;
    weights[first + 1u] = weight;
    if (weight >= 1.0) {
      site.primary = site.successor;
      site.successor = vec2<u32>(0);
      site.fading = 0u;
    }
  } else {
    site.fading = 0u;
  }
  sites[i] = site;
}
`;

const bindings = {
  prepareSites: [0,1,2,3,4,5,6],
  offerCandidates: [0,1,2,3,4,5,6],
  resolveSites: [0,1,2,5,6,7],
  assignHandoverWeights: [0,5,7,8,9],
};

export function createReceiverSuccession(device, retire) {
  const module = device.createShaderModule({label: 'packet receiver succession', code: RECEIVER_SUCCESSION_WGSL});
  const pipelines = {};
  let data = null;
  let stateKey = null;
  const run = (encoder, name, buffers, count) => {
    const pipeline = pipelines[name] ??= device.createComputePipeline({
      label: name, layout: 'auto', compute: {module, entryPoint: name},
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: bindings[name].map(binding => ({binding, resource: {buffer: buffers[binding]}})),
    });
    const pass = encoder.beginComputePass({label: name});
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();
  };
  return {
    select(encoder, material, settings, centers) {
      const {domain, identity, slots, particles, birthGenerations, options, fine} = material;
      if (!fine || fine.size < 64 * domain.dims.reduce((a,b) => a*b, 1)) {
        throw new Error('Receiver succession requires current Fine velocity');
      }
      const count = settings.receivers;
      if (data?.count !== count) {
        if (data) retire(Object.values(data.buffers));
        const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
        data = {count, buffers: {
          params: device.createBuffer({size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST}),
          sites: device.createBuffer({size: 32 * count, usage: storage}),
          offers: device.createBuffer({size: 4 * count, usage: storage}),
          weights: device.createBuffer({size: 8 * count, usage: storage | GPUBufferUsage.COPY_SRC}),
        }};
        stateKey = null;
      }
      const {params, sites, offers, weights} = data.buffers;
      const key = JSON.stringify([identity.epoch, domain.origin, domain.dims, domain.pitch]);
      if (key !== stateKey) {
        encoder.clearBuffer(sites);
        stateKey = key;
      }
      const input = new ArrayBuffer(80);
      const floats = new Float32Array(input), ints = new Uint32Array(input);
      floats.set(domain.origin);
      floats.set([...domain.dims.map(n => n * domain.pitch), domain.pitch], 4);
      ints.set(domain.dims, 8);
      const buckets = Math.min(65535, Math.floor(0xffffffff / slots) - 1);
      ints.set([slots, count, identity.step, buckets], 12);
      floats.set([settings.receiverCore, settings.receiverShell, settings.receiverRadius, settings.receiverHandoverSteps], 16);
      device.queue.writeBuffer(params, 0, input);
      const buffers = [params, particles, birthGenerations, fine, options, sites, offers, centers];
      run(encoder, 'prepareSites', buffers, count);
      run(encoder, 'offerCandidates', buffers, slots);
      run(encoder, 'resolveSites', buffers, count);
      return {
        weights,
        finish(radiance) {
          run(encoder, 'assignHandoverWeights', [...buffers, radiance, weights], count);
        },
      };
    },
    get bytes() {
      return data ? Object.values(data.buffers).reduce((sum, buffer) => sum + buffer.size, 0) : 0;
    },
    dispose() {
      if (data) retire(Object.values(data.buffers));
      data = null;
      stateKey = null;
    },
  };
}
