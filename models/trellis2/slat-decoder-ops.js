// Model-owned sparse decoder kernels. F16 values use F32 physical storage,
// with explicit IEEE-half rounding at source operation boundaries. This is
// not the occupancy decoder's F32 arithmetic and not a shared-kit extension.
import { WEBGPU_BUFFER_USAGE as U } from '../../webgpu-inference-kit/src/core.js';
const round = 'fn round_f16(v:f32)->f32{return unpack2x16float(pack2x16float(vec2<f32>(v,0.0))).x;}';
const index = 'let index=gid.x+gid.y*grid.x*256u;';
const entry = '@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(num_workgroups) grid:vec3<u32>)';
const binding = (i, name, type = 'f32', write = false) => `@group(0) @binding(${i}) var<storage,${write ? 'read_write' : 'read'}> ${name}:array<${type}>;`;

export function decoderDispatch(groups, limit = 65535) {
  if (!Number.isSafeInteger(groups) || groups < 1 || !Number.isSafeInteger(limit) || limit < 1) throw RangeError('positive dispatch geometry required');
  const x = Math.min(groups, limit), y = Math.ceil(groups / x);
  if (y > limit) throw RangeError('complete decoder dispatch exceeds device capacity');
  return [x, y, 1];
}

export function slatDecoderLinearShader(rows, ci, co, half = true) {
  return `${round}
${binding(0, 'input')}${binding(1, 'weight')}${binding(2, 'bias')}${binding(3, 'output', 'f32', true)}
var<workgroup> tile_a:array<f32,256>;var<workgroup> tile_b:array<f32,256>;
@compute @workgroup_size(16,16)
fn main(@builtin(local_invocation_id) lid:vec3<u32>,@builtin(workgroup_id) wid:vec3<u32>,@builtin(num_workgroups) grid:vec3<u32>){
 let tile=wid.x+wid.y*grid.x;let row=(tile/${Math.ceil(co / 16)}u)*16u+lid.y;
 let col=(tile%${Math.ceil(co / 16)}u)*16u+lid.x;var sum=0.0;
 for(var base=0u;base<${ci}u;base+=16u){
  var a=0.0;var b=0.0;
  if(row<${rows}u&&base+lid.x<${ci}u){a=input[row*${ci}u+base+lid.x];}
  if(col<${co}u&&base+lid.y<${ci}u){b=weight[col*${ci}u+base+lid.y];}
  tile_a[lid.y*16u+lid.x]=a;tile_b[lid.y*16u+lid.x]=b;workgroupBarrier();
  for(var k=0u;k<16u;k++){sum+=tile_a[lid.y*16u+k]*tile_b[k*16u+lid.x];}workgroupBarrier();
 }
 if(row<${rows}u&&col<${co}u){output[row*${co}u+col]=${half ? 'round_f16(sum+bias[col])' : 'sum+bias[col]'};}
}`;
}

export function slatDecoderSparseConvShader(rows, ci, co) {
  return `${round}
${binding(0, 'input')}${binding(1, 'neighbors', 'i32')}${binding(2, 'weight')}${binding(3, 'bias')}${binding(4, 'output', 'f32', true)}
var<workgroup> tile_a:array<f32,256>;var<workgroup> tile_b:array<f32,256>;
@compute @workgroup_size(16,16)
fn main(@builtin(local_invocation_id) lid:vec3<u32>,@builtin(workgroup_id) wid:vec3<u32>,@builtin(num_workgroups) grid:vec3<u32>){
 let tile=wid.x+wid.y*grid.x;let row=(tile/${Math.ceil(co / 16)}u)*16u+lid.y;
 let col=(tile%${Math.ceil(co / 16)}u)*16u+lid.x;var accumulated=0.0;
 // Source SparseConv3d executes27 separate F16-output matmuls and .at.add
 // updates. Combining them into one F32 dot would change that model law.
 for(var offset=0u;offset<27u;offset++){
  var source=-1;if(row<${rows}u){source=neighbors[row*27u+offset];}var sum=0.0;
  for(var base=0u;base<${ci}u;base+=16u){
   var a=0.0;var b=0.0;
   if(source>=0&&base+lid.x<${ci}u){a=input[u32(source)*${ci}u+base+lid.x];}
   if(col<${co}u&&base+lid.y<${ci}u){b=weight[(col*27u+offset)*${ci}u+base+lid.y];}
   tile_a[lid.y*16u+lid.x]=a;tile_b[lid.y*16u+lid.x]=b;workgroupBarrier();
   for(var k=0u;k<16u;k++){sum+=tile_a[lid.y*16u+k]*tile_b[k*16u+lid.x];}workgroupBarrier();
  }
  if(source>=0){accumulated=round_f16(accumulated+round_f16(sum));}
 }
 if(row<${rows}u&&col<${co}u){output[row*${co}u+col]=round_f16(accumulated+bias[col]);}
}`;
}

export function slatDecoderNormShader(rows, channels, affine = true, half = true, eps = 1e-6) {
  const end = affine ? 3 : 1;
  return `${round}${binding(0, 'input')}${affine ? binding(1, 'weight') + binding(2, 'bias') : ''}${binding(end, 'output', 'f32', true)}
var<workgroup> partial:array<f32,256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) wid:vec3<u32>,@builtin(num_workgroups) grid:vec3<u32>){
 let row=wid.x+wid.y*grid.x;if(row>=${rows}u){return;}var sum=0.0;
 for(var c=lane;c<${channels}u;c+=256u){sum+=input[row*${channels}u+c];}partial[lane]=sum;workgroupBarrier();
 for(var stride=128u;stride>0u;stride/=2u){if(lane<stride){partial[lane]+=partial[lane+stride];}workgroupBarrier();}
 let mean=partial[0]/${channels}.0;workgroupBarrier();sum=0.0;
 for(var c=lane;c<${channels}u;c+=256u){let d=input[row*${channels}u+c]-mean;sum+=d*d;}partial[lane]=sum;workgroupBarrier();
 for(var stride=128u;stride>0u;stride/=2u){if(lane<stride){partial[lane]+=partial[lane+stride];}workgroupBarrier();}
 let inverse=inverseSqrt(partial[0]/${channels}.0+${eps});
 for(var c=lane;c<${channels}u;c+=256u){var value=(input[row*${channels}u+c]-mean)*inverse;
  ${affine ? 'value=value*weight[c]+bias[c];' : ''}output[row*${channels}u+c]=${half ? 'round_f16(value)' : 'value'};}
}`;
}

export const slatDecoderSiluShader = (count, inPlace = false) => `${inPlace ? binding(0, 'table') + binding(1, 'input', 'f32', true) : binding(0, 'input') + binding(1, 'table') + binding(2, 'output', 'f32', true)}
${entry}{${index}if(index<${count}u){let bits=pack2x16float(vec2<f32>(input[index],0.0))&65535u;${inPlace ? 'input' : 'output'}[index]=table[bits];}}`;
export const slatDecoderResidualShader = count => `${round}${binding(0, 'skip')}${binding(1, 'output', 'f32', true)}
${entry}{${index}if(index<${count}u){output[index]=round_f16(skip[index]+output[index]);}}`;

const hashKey = resolution => `fn key_for(p:vec3<i32>)->u32{return 1u+(u32(p.x)*${resolution}u+u32(p.y))*${resolution}u+u32(p.z);}`;
export function slatDecoderHashShaders(rows, resolution, capacity) {
  const common = hashKey(resolution), mask = capacity - 1;
  return {
    clear: `${binding(0, 'keys', 'atomic<u32>', true)}${binding(1, 'values', 'u32', true)}${binding(2, 'status', 'atomic<u32>', true)}
${entry}{${index}if(index<${capacity}u){atomicStore(&keys[index],0u);values[index]=0u;}if(index==0u){atomicStore(&status[0],0u);}}`,
    insert: `${common}${binding(0, 'coordinates', 'i32')}${binding(1, 'keys', 'atomic<u32>', true)}${binding(2, 'values', 'u32', true)}${binding(3, 'status', 'atomic<u32>', true)}
${entry}{${index}if(index>=${rows}u){return;}
 let p=vec3<i32>(coordinates[index*3u],coordinates[index*3u+1u],coordinates[index*3u+2u]);
 if(any(p<vec3<i32>(0))||any(p>=vec3<i32>(${resolution}))){atomicOr(&status[0],1u);return;}
 let key=key_for(p);var slot=(key*2654435761u)&${mask}u;var examined=0u;
 loop{let claimed=atomicCompareExchangeWeak(&keys[slot],0u,key);
  if(claimed.exchanged){values[slot]=index+1u;return;}
  if(claimed.old_value==key){atomicOr(&status[0],2u);return;}
  // Spurious weak failure at an empty slot retries that slot, not a lost key.
  if(claimed.old_value==0u){continue;}
  slot=(slot+1u)&${mask}u;examined++;if(examined>=${capacity}u){atomicOr(&status[0],4u);return;}
 }}`, 
    neighbors: `${common}${binding(0, 'coordinates', 'i32')}${binding(1, 'keys', 'u32')}${binding(2, 'values', 'u32')}${binding(3, 'neighbors', 'i32', true)}
${entry}{${index}if(index>=${rows * 27}u){return;}let row=index/27u;let offset=index%27u;
 let p=vec3<i32>(coordinates[row*3u]+i32(offset/9u)-1,coordinates[row*3u+1u]+i32((offset/3u)%3u)-1,coordinates[row*3u+2u]+i32(offset%3u)-1);
 neighbors[index]=-1;if(any(p<vec3<i32>(0))||any(p>=vec3<i32>(${resolution}))){return;}
 let key=key_for(p);var slot=(key*2654435761u)&${mask}u;
 for(var i=0u;i<${capacity}u;i++){let stored=keys[slot];if(stored==0u){return;}
  if(stored==key){neighbors[index]=i32(values[slot])-1;return;}slot=(slot+1u)&${mask}u;}
}`
  };
}

export const slatDecoderChildCountsShader = rows => `${binding(0, 'logits')}${binding(1, 'counts', 'u32', true)}
${entry}{${index}if(index>=${rows}u){return;}var count=0u;for(var child=0u;child<8u;child++){if(logits[index*8u+child]>0.0){count++;}}counts[index]=count;}`;

// Hierarchical256-wide scan preserves every parent, unlike serial scanning of
// millions of generated cells or an atomic append with unstable child order.
export const slatDecoderScanShader = count => `${binding(0, 'input', 'u32')}${binding(1, 'prefix', 'u32', true)}${binding(2, 'sums', 'u32', true)}
var<workgroup> scratch:array<u32,256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) wid:vec3<u32>,@builtin(num_workgroups) grid:vec3<u32>){
 let group=wid.x+wid.y*grid.x;let i=group*256u+lane;var own=0u;if(i<${count}u){own=input[i];}scratch[lane]=own;workgroupBarrier();
 for(var offset=1u;offset<256u;offset*=2u){var prior=0u;if(lane>=offset){prior=scratch[lane-offset];}workgroupBarrier();scratch[lane]+=prior;workgroupBarrier();}
 if(i<${count}u){prefix[i]=scratch[lane]-own;}if(lane==255u&&group<${Math.ceil(count / 256)}u){sums[group]=scratch[lane];}
}`;
export const slatDecoderScanAddShader = count => `${binding(0, 'parent', 'u32')}${binding(1, 'prefix', 'u32', true)}
${entry}{${index}if(index<${count}u){prefix[index]+=parent[index/256u];}}`;

export function slatDecoderScatterShader(rows, ci, co) {
  const perChild = ci / 8, repeat = co / perChild;
  return `${binding(0, 'coordinates', 'i32')}${binding(1, 'parent')}${binding(2, 'convolved')}${binding(3, 'logits')}${binding(4, 'prefix', 'u32')}
${binding(5, 'new_coordinates', 'i32', true)}${binding(6, 'features', 'f32', true)}${binding(7, 'skip', 'f32', true)}
${entry}{${index}if(index>=${rows * 8 * co}u){return;}let col=index%${co}u;let cell=index/${co}u;let child=cell%8u;let row=cell/8u;
 if(logits[row*8u+child]<=0.0){return;}var earlier=0u;for(var j=0u;j<child;j++){if(logits[row*8u+j]>0.0){earlier++;}}
 let destination=prefix[row]+earlier;
 if(col==0u){new_coordinates[destination*3u]=coordinates[row*3u]*2+i32(child%2u);
  new_coordinates[destination*3u+1u]=coordinates[row*3u+1u]*2+i32((child/2u)%2u);
  new_coordinates[destination*3u+2u]=coordinates[row*3u+2u]*2+i32(child/4u);}
 features[destination*${co}u+col]=convolved[(row*8u+child)*${co}u+col];
 skip[destination*${co}u+col]=parent[row*${ci}u+child*${perChild}u+col/${repeat}u];
}`;
}

export function createSLatDecoderKernelOps(runtime) {
  if (!runtime?.createTensor || !runtime?.defineComputeKernel || !runtime?.runKernel || !runtime?.readTensor || !runtime?.uploadTensor) throw TypeError('registered sparse decoder runtime required');
  const resources = new Set(), limit = runtime.device?.limits?.maxStorageBufferBindingSize ?? 134217728,
    dispatchLimit = runtime.device?.limits?.maxComputeWorkgroupsPerDimension ?? 65535;
  let sequence = 0, metadataReadbackBytes = 0, convolutionsExecuted = 0;
  const allocate = (name, shape, dtype = 'f32') => {
    const count = shape.reduce((a, b) => a * b, 1);
    if (!Number.isSafeInteger(count) || count < 1 || count > 0xffffffff || count * 4 > limit) throw RangeError('complete decoder tensor exceeds effective device binding capacity');
    const t = runtime.createTensor({ name: `trellis.slat-decoder.${name}.${sequence++}`, shape, dtype, usage: U.storage | U.copyDst | U.copySrc });resources.add(t);return t;
  };
  const release = t => { if (resources.delete(t)) t.buffer?.destroy?.(); };
  const dispatch = (stage, code, args, groups, invocation, readBindings = args.length - 1) => {
    const kernel = runtime.defineComputeKernel({ name: `trellis.${stage}.${sequence++}`, code,
      bindings: args.map((resource, i) => ({ name: `b${i}`, resource, access: i < readBindings ? 'read-only-storage' : 'storage' })) });
    return runtime.runKernel(kernel, { stage, dispatch: decoderDispatch(groups, dispatchLimit), schedulerInvocation: invocation, yieldAfter: true });
  };
  const word = async t => {
    const raw = await runtime.readTensor(t), data = raw instanceof ArrayBuffer ? new Uint32Array(raw) : raw;
    if (!(data instanceof Uint32Array) || data.length !== 1) throw Error('complete decoder scalar metadata required');
    metadataReadbackBytes += 4;return data[0];
  };
  return Object.freeze({ allocate, release,
    upload(name, shape, values) { const t = allocate(name, shape);runtime.uploadTensor(t, values);return t; },
    get metadataReadbackBytes() { return metadataReadbackBytes; },
    get convolutionsExecuted() { return convolutionsExecuted; },
    async settle() { await runtime.device?.queue?.onSubmittedWorkDone?.(); },
    async neighbors(coordinates, resolution, invocation) {
      const rows = coordinates.shape[0];let capacity = 1;while (capacity < rows * 2) capacity *= 2;
      const keys = allocate('hash-keys', [capacity], 'u32'), values = allocate('hash-rows', [capacity], 'u32'),
        status = allocate('hash-status', [1], 'u32'), neighbors = allocate('neighbors', [rows, 27], 'i32'), code = slatDecoderHashShaders(rows, resolution, capacity);
      try {
        await dispatch('decoder-hash-clear', code.clear, [keys, values, status], Math.ceil(capacity / 256), invocation, 0);
        await dispatch('decoder-hash-insert', code.insert, [coordinates, keys, values, status], Math.ceil(rows / 256), invocation, 1);
        const error = await word(status);if (error) throw Error(`invalid, duplicate or overflowing sparse coordinate hash: status${error}`);
        await dispatch('decoder-neighbors', code.neighbors, [coordinates, keys, values, neighbors], Math.ceil(rows * 27 / 256), invocation);
        await runtime.device?.queue?.onSubmittedWorkDone?.();return neighbors;
      } finally { release(keys);release(values);release(status); }
    },
    linear(input, weight, bias, output, half, invocation) {
      const [rows, ci] = input.shape, co = output.shape[1];
      return dispatch('decoder-linear', slatDecoderLinearShader(rows, ci, co, half), [input, weight, bias, output], Math.ceil(rows / 16) * Math.ceil(co / 16), invocation);
    },
    async conv(input, neighbors, weight, bias, output, invocation) {
      const [rows, ci] = input.shape, co = output.shape[1];
      await dispatch('decoder-sparse-conv', slatDecoderSparseConvShader(rows, ci, co), [input, neighbors, weight, bias, output], Math.ceil(rows / 16) * Math.ceil(co / 16), invocation);
      convolutionsExecuted++;
    },
    norm(input, weight, bias, output, half, eps, invocation) {
      const [rows, channels] = input.shape, affine = !!weight;
      return dispatch('decoder-layernorm', slatDecoderNormShader(rows, channels, affine, half, eps), affine ? [input, weight, bias, output] : [input, output], rows, invocation);
    },
    silu(input, table, output, invocation) { const same = input === output;return dispatch('decoder-silu', slatDecoderSiluShader(input.byteLength / 4, same), same ? [table, input] : [input, table, output], Math.ceil(input.byteLength / 1024), invocation); },
    residual(skip, output, invocation) { return dispatch('decoder-residual', slatDecoderResidualShader(skip.byteLength / 4), [skip, output], Math.ceil(skip.byteLength / 1024), invocation); },
    async subdivision(logits, invocation) {
      const rows = logits.shape[0], counts = allocate('child-counts', [rows], 'u32'), levels = [];
      await dispatch('decoder-child-counts', slatDecoderChildCountsShader(rows), [logits, counts], Math.ceil(rows / 256), invocation);
      let input = counts, n = rows;
      while (true) {
        const groups = Math.ceil(n / 256), prefix = allocate('scan-prefix', [n], 'u32'), sums = allocate('scan-sums', [groups], 'u32');
        levels.push({ prefix, sums, n });
        await dispatch('decoder-child-scan', slatDecoderScanShader(n), [input, prefix, sums], groups, invocation, 1);
        if (groups === 1) break;input = sums;n = groups;
      }
      for (let i = levels.length - 2; i >= 0; i--) await dispatch('decoder-child-scan-add', slatDecoderScanAddShader(levels[i].n),
        [levels[i + 1].prefix, levels[i].prefix], Math.ceil(levels[i].n / 256), invocation, 1);
      const count = await word(levels.at(-1).sums);
      if (count > rows * 8) throw Error('learned child count exceeds capacity');
      if (!count) throw Error('learned decoder generated empty cells; no replacement support');
      const prefix = levels[0].prefix;
      release(counts);for (const l of levels) { release(l.sums);if (l.prefix !== prefix) release(l.prefix); }
      return { prefix, count };
    },
    scatter(coordinates, parent, convolved, logits, prefix, outputCoordinates, output, skip, invocation) {
      const [rows, ci] = parent.shape, co = output.shape[1];
      return dispatch('decoder-subdivision-scatter', slatDecoderScatterShader(rows, ci, co),
        [coordinates, parent, convolved, logits, prefix, outputCoordinates, output, skip], Math.ceil(rows * 8 * co / 256), invocation, 5);
    },
    dispose() { for (const t of [...resources]) release(t); }
  });
}
