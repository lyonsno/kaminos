// Tiled GEMM / implicit-GEMM convolution WGSL generator (extracted from the
// SuperMat port, byte-identical output). The caller owns buffers, bind groups,
// dispatch and scheduling; this module emits shader text and the tile policy.
//
// C[b,m,n] = alpha * sum_k A[b,m,k] * B[b,k,n] (+ biasM[m]) (+ biasM2[m]) (+ biasN[n]) (+ R[b,m,n])
// Arithmetic: each output accumulates k in order with F32 fma; bias and
// residual are added in the epilogue. precision 'f16-tiles' rounds operand
// tiles to f16 in workgroup memory (F32 accumulation); 'f16-partial' also
// accumulates each bk-wide K step in f16. Both need shader-f16.
// Bindings (in order): a, b, [bias_m], [bias_m2], [bias_n], [res], [norm_ss], c, uniform Params
// (TILED_GEMM_PARAMS_WORDS u32 words: M,N,K,alpha(f32) | a_off,a_sm,a_sk,a_sb |
// b_off,b_sk,b_sn,b_sb | c_off,c_sm,c_sn,c_sb | pad_top,pad_left,n_base,0).
// Dispatch: [ceil(nCount/bn), ceil(M/bm), batch] workgroups of 16x16 threads.
// Storage types per binding: 'f32', 'f16' (native, shader-f16) or 'f16packed'
// (binary16 pairs in u32). conv: { kh, kw, stride, upsample } replaces the B
// load with implicit im2col over NCHW input (b_sk/b_sn/b_sb = input H, input W,
// output W). normB: { silu } applies a per-channel [scale, shift] (+SiLU) to B
// while loading (conv only). aPairs: packed-f16 A, K-contiguous, even K and
// strides: one u32 load yields two consecutive k.

const ELEMENT = { f32: 'f32', f16: 'f16', f16packed: 'u32' };
const binding = (index, name, type = 'f32', write = false) =>
  `@group(0) @binding(${index}) var<storage,${write ? 'read_write' : 'read'}> ${name}:array<${ELEMENT[type]}>;`;
const storage = (index, name, write = false) => binding(index, name, 'f32', write);
const load = (name, type, index) => type === 'f16packed'
  ? `unpack2x16float(${name}[(${index})>>1u])[(${index})&1u]`
  : type === 'f16' ? `f32(${name}[${index}])` : `${name}[${index}]`;
const store = (name, type, index, value) => type === 'f16' ? `${name}[${index}]=f16(${value});` : `${name}[${index}]=${value};`;
const enables = (types, extra = false) => (extra || Object.values(types).includes('f16') ? 'enable f16;\n' : '');
const uniform = (index, type) => `@group(0) @binding(${index}) var<uniform> p:${type};`;

export const TILED_GEMM_PARAMS_WORDS = 20;

// C[b,m,n] = alpha * sum_k A[b,m,k] * B[b,k,n] (+ biasM[m]) (+ biasM2[m]) (+ biasN[n]) (+ R[b,m,n])
// Element offsets/strides are uniforms. `aKContiguous` and `bNContiguous`
// choose the coalesced tile-load order; they do not change the arithmetic.
// `conv` replaces the B load with implicit im2col over an NCHW input.
// Tile shape: a 16x16 thread grid computes a (16*tm) x (16*tn) output tile,
// stepping K by bk. `aF16`/`bF16` read that operand as packed binary16 pairs
// (u32 words) and widen to F32; accumulation stays F32.
export function tiledGemmTileShape({ tm = 4, tn = 4, bk = 16 } = {}) {
  return { tm, tn, bk, bm: 16 * tm, bn: 16 * tn };
}

// Shared pieces of the GEMM kernels: bindings, params struct, operand fetches,
// tile loaders (for `threads` threads filling bk x bm / bk x bn tiles) and the
// epilogue that turns accumulator value ACC into the stored output.
export function tiledGemmParts({ aKContiguous = true, bNContiguous = true, biasM = false, biasM2 = false, biasN = false,
  residual = false, conv = null, aF16 = false, bF16 = false, types = {}, normB = null, aPairs = false },
  { bm, bn, bk, threads, aLayout = 'k-major' }) {
  const t = { a: types.a ?? (aF16 ? 'f16packed' : 'f32'), b: types.b ?? (bF16 ? 'f16packed' : 'f32'),
    biasM: types.biasM ?? 'f32', biasM2: types.biasM2 ?? 'f32', biasN: types.biasN ?? 'f32',
    residual: types.residual ?? 'f32', c: types.c ?? 'f32' };
  const bindings = [binding(0, 'a', t.a), binding(1, 'b', t.b)];
  let next = 2;
  if (biasM) bindings.push(binding(next++, 'bias_m', t.biasM));
  if (biasM2) bindings.push(binding(next++, 'bias_m2', t.biasM2));
  if (biasN) bindings.push(binding(next++, 'bias_n', t.biasN));
  if (residual) bindings.push(binding(next++, 'res', t.residual));
  // normB: GroupNorm (+SiLU) of the conv input applied while loading B tiles.
  // normB: per-channel [scale, shift] (scale = rstd*gamma, shift = beta - mean*scale).
  if (normB) {
    if (!conv) throw new Error('fused input normalization requires a conv GEMM');
    bindings.push(storage(next++, 'norm_ss'));
  }
  bindings.push(binding(next++, 'c', t.c, true));
  bindings.push(uniform(next++, 'Params'));
  const used = { a: t.a, b: t.b, c: t.c, ...(biasM ? { biasM: t.biasM } : {}), ...(biasM2 ? { biasM2: t.biasM2 } : {}),
    ...(biasN ? { biasN: t.biasN } : {}), ...(residual ? { residual: t.residual } : {}) };
  const header = `struct Params {
  M:u32, N:u32, K:u32, alpha:f32,
  a_off:u32, a_sm:u32, a_sk:u32, a_sb:u32,
  b_off:u32, b_sk:u32, b_sn:u32, b_sb:u32,
  c_off:u32, c_sm:u32, c_sn:u32, c_sb:u32,
  pad_top:u32, pad_left:u32, n_base:u32, z1:u32,
};
${bindings.join('\n')}`;
  const orderA = aKContiguous ? `let kk=idx%${bk}u;let mm=idx/${bk}u;` : `let mm=idx%${bm}u;let kk=idx/${bm}u;`;
  const orderB = bNContiguous || conv ? `let nn=idx%${bn}u;let kk=idx/${bn}u;` : `let kk=idx%${bk}u;let nn=idx/${bk}u;`;
  let valueB, prologue = '';
  if (conv) {
    const { kh, kw, stride, upsample } = conv;
    // p.b_sk/p.b_sn/p.b_sb are reused as input H, input W and output W.
    // When each thread's B column is fixed for the whole K loop (threads a
    // multiple of bn), its output position and input origin are computed once.
    const hoisted = threads % bn === 0;
    if (hoisted) {
      prologue = `let b_n=n0+tid%${bn}u;let b_oy=b_n/p.b_sb;let b_ox=b_n%p.b_sb;
  let b_iy0=i32(b_oy*${stride}u)-i32(p.pad_top);let b_ix0=i32(b_ox*${stride}u)-i32(p.pad_left);
  let b_eh=i32(p.b_sk${upsample ? '*2u' : ''});let b_ew=i32(p.b_sn${upsample ? '*2u' : ''});`;
    }
    valueB = `let ci=k/${kh * kw}u;let r=k%${kh * kw}u;let ky=r/${kw}u;let kx=r%${kw}u;
      ${hoisted ? 'let iy=b_iy0+i32(ky);let ix=b_ix0+i32(kx);let eh=b_eh;let ew=b_ew;' : `let oy=n/p.b_sb;let ox=n%p.b_sb;
      let iy=i32(oy*${stride}u+ky)-i32(p.pad_top);let ix=i32(ox*${stride}u+kx)-i32(p.pad_left);
      let eh=i32(p.b_sk${upsample ? '*2u' : ''});let ew=i32(p.b_sn${upsample ? '*2u' : ''});`}
      if(iy>=0&&ix>=0&&iy<eh&&ix<ew){
        let sy=u32(iy)${upsample ? '/2u' : ''};let sx=u32(ix)${upsample ? '/2u' : ''};
        value=${load('b', t.b, 'p.b_off+ci*p.b_sk*p.b_sn+sy*p.b_sn+sx')};
        ${normB ? `value=fma(value,norm_ss[ci*2u],norm_ss[ci*2u+1u]);
        ${normB.silu ? 'value=value/(1.0+exp(-value));' : ''}` : ''}
      }`;
  } else {
    valueB = `value=${load('b', t.b, 'p.b_off+bat*p.b_sb+k*p.b_sk+n*p.b_sn')};`;
  }
  const storeA = aLayout === 'k-major' ? `tile_a[kk*${bm}u+mm]=value;` : `tile_a[mm*${bk}u+kk]=value;`;
  // aPairs: packed-f16 A, K-contiguous, even K/strides/offset, k-major tile:
  // each u32 load yields two consecutive k (TILE() is the tile-precision cast).
  const pairs = aPairs && t.a === 'f16packed' && aLayout === 'k-major' && bk % 2 === 0 && (bk * bm) % (2 * threads) === 0;
  const loadA = pairs ? `    for(var q=0u;q<${(bk * bm) / (2 * threads)}u;q++){
      let idx=tid+q*${threads}u;
      let kp=idx%${bk / 2}u;let mm=idx/${bk / 2}u;
      let m=m0+mm;let k=k0+2u*kp;var v=vec2<f32>(0.0);
      if(m<p.M&&k<p.K){v=unpack2x16float(a[(p.a_off+bat*p.a_sb+m*p.a_sm+k)>>1u]);}
      tile_a[(2u*kp)*${bm}u+mm]=TILE(v.x);tile_a[(2u*kp+1u)*${bm}u+mm]=TILE(v.y);
    }` : `    for(var q=0u;q<${(bk * bm) / threads}u;q++){
      let idx=tid+q*${threads}u;
      ${orderA}
      let m=m0+mm;let k=k0+kk;var value=0.0;
      if(m<p.M&&k<p.K){value=${load('a', t.a, 'p.a_off+bat*p.a_sb+m*p.a_sm+k*p.a_sk')};}
      ${storeA}
    }`;
  const loaders = `${loadA}
    for(var q=0u;q<${(bk * bn) / threads}u;q++){
      let idx=tid+q*${threads}u;
      ${orderB}
      let n=n0+nn;let k=k0+kk;var value=0.0;
      if(n<p.N&&k<p.K){ ${valueB} }
      tile_b[kk*${bn}u+nn]=value;
    }`;
  let epilogue = 'var v=p.alpha*(ACC);';
  if (biasM) epilogue += `v+=${load('bias_m', t.biasM, 'm')};`;
  if (biasM2) epilogue += `v+=${load('bias_m2', t.biasM2, 'm')};`;
  if (biasN) epilogue += `v+=${load('bias_n', t.biasN, 'n')};`;
  const cIndex = 'p.c_off+bat*p.c_sb+m*p.c_sm+n*p.c_sn';
  if (residual) epilogue += `v+=${load('res', t.residual, cIndex)};`;
  epilogue += store('c', t.c, cIndex, 'v');
  return { header, loaders, epilogue, used, prologue };
}

// precision: 'f32' (default); 'f16-tiles' rounds both operand tiles to f16 in
// workgroup memory and multiplies in F32; 'f16-partial' also multiplies and
// accumulates each bk-wide K step in f16, adding the partial into F32 per step.
// Both f16 modes require the shader-f16 feature.
export function createWebGpuTiledGemmShader({ tile = {}, precision = 'f32', ...layout } = {}) {
  if (!TILED_GEMM_PRECISIONS.includes(precision)) throw new RangeError(`unsupported precision ${precision}`);
  if (precision !== 'f32') return gemmShaderF16({ tile, precision, ...layout });
  const { tm, tn, bk, bm, bn } = tiledGemmTileShape(tile);
  const { header, loaders, epilogue, used, prologue } = tiledGemmParts(layout, { bm, bn, bk, threads: 256 });
  return `${enables(used)}
${header}
var<workgroup> tile_a:array<f32,${bk * bm}>;
var<workgroup> tile_b:array<f32,${bk * bn}>;
@compute @workgroup_size(16,16)
fn main(@builtin(local_invocation_id) lid:vec3<u32>, @builtin(workgroup_id) wid:vec3<u32>) {
  let tid=lid.y*16u+lid.x;
  let m0=wid.y*${bm}u;let n0=p.n_base+wid.x*${bn}u;let bat=wid.z;
  var acc:array<array<f32,${tn}>,${tm}>;
  ${prologue}
  for(var k0=0u;k0<p.K;k0+=${bk}u){
${loaders.replaceAll('TILE(', '(')}
    workgroupBarrier();
    for(var kk=0u;kk<${bk}u;kk++){
      var av:array<f32,${tm}>;var bv:array<f32,${tn}>;
      for(var i=0u;i<${tm}u;i++){av[i]=tile_a[kk*${bm}u+lid.y+16u*i];}
      for(var j=0u;j<${tn}u;j++){bv[j]=tile_b[kk*${bn}u+lid.x+16u*j];}
      for(var i=0u;i<${tm}u;i++){for(var j=0u;j<${tn}u;j++){acc[i][j]=fma(av[i],bv[j],acc[i][j]);}}
    }
    workgroupBarrier();
  }
  for(var i=0u;i<${tm}u;i++){
    let m=m0+lid.y+16u*i;
    if(m>=p.M){continue;}
    for(var j=0u;j<${tn}u;j++){
      let n=n0+lid.x+16u*j;
      if(n>=p.N){continue;}
      ${epilogue.replace('ACC', 'acc[i][j]')}
    }
  }
}`;
}

function gemmShaderF16({ tile = {}, precision, ...layout }) {
  const { tm, tn, bk, bm, bn } = tiledGemmTileShape(tile);
  const { header, loaders, epilogue, used, prologue } = tiledGemmParts(layout, { bm, bn, bk, threads: 256 });
  const half = precision === 'f16-partial';
  return `${enables(used, true)}
${header}
var<workgroup> tile_a:array<f16,${bk * bm}>;
var<workgroup> tile_b:array<f16,${bk * bn}>;
@compute @workgroup_size(16,16)
fn main(@builtin(local_invocation_id) lid:vec3<u32>, @builtin(workgroup_id) wid:vec3<u32>) {
  let tid=lid.y*16u+lid.x;
  let m0=wid.y*${bm}u;let n0=p.n_base+wid.x*${bn}u;let bat=wid.z;
  var acc:array<array<f32,${tn}>,${tm}>;
  ${prologue}
  for(var k0=0u;k0<p.K;k0+=${bk}u){
${loaders.replaceAll('TILE(', 'f16(').replace(/(tile_a\[[^\]]+\])=value;/, '$1=f16(value);').replace(/(tile_b\[[^\]]+\])=value;/, '$1=f16(value);')}
    workgroupBarrier();
    ${half ? `var part:array<array<f16,${tn}>,${tm}>;` : ''}
    for(var kk=0u;kk<${bk}u;kk++){
      var av:array<f16,${tm}>;var bv:array<f16,${tn}>;
      for(var i=0u;i<${tm}u;i++){av[i]=tile_a[kk*${bm}u+lid.y+16u*i];}
      for(var j=0u;j<${tn}u;j++){bv[j]=tile_b[kk*${bn}u+lid.x+16u*j];}
      for(var i=0u;i<${tm}u;i++){for(var j=0u;j<${tn}u;j++){
        ${half ? 'part[i][j]=fma(av[i],bv[j],part[i][j]);' : 'acc[i][j]=fma(f32(av[i]),f32(bv[j]),acc[i][j]);'}
      }}
    }
    ${half ? `for(var i=0u;i<${tm}u;i++){for(var j=0u;j<${tn}u;j++){acc[i][j]+=f32(part[i][j]);}}` : ''}
    workgroupBarrier();
  }
  for(var i=0u;i<${tm}u;i++){
    let m=m0+lid.y+16u*i;
    if(m>=p.M){continue;}
    for(var j=0u;j<${tn}u;j++){
      let n=n0+lid.x+16u*j;
      if(n>=p.N){continue;}
      ${epilogue.replace('ACC', 'acc[i][j]')}
    }
  }
}`;
}


export const TILED_GEMM_PRECISIONS = Object.freeze(['f32', 'f16-tiles', 'f16-partial']);

// Per-shape tile policy: use `large` when it still yields >= minWorkgroups
// workgroups (large GEMMs and convs), else `base`. Both must share bn so
// column-range splits stay tile-aligned. Tile shape does not change any
// output's summation order.
export function chooseTiledGemmTile({ M, N, batch = 1 }, { base = { tm: 4, tn: 4, bk: 16 }, large = null, minWorkgroups = 1024 } = {}) {
  if (!large) return base;
  const big = tiledGemmTileShape(large), small = tiledGemmTileShape(base);
  if (big.bn !== small.bn) throw new RangeError('large and base tiles must share the column width');
  return Math.ceil(N / big.bn) * Math.ceil(M / big.bm) * batch >= minWorkgroups ? large : base;
}
