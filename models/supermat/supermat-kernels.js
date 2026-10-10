// Model-owned WGSL for the SuperMat single-image route. All arithmetic and
// storage are F32, matching the CPU F32 reference. Shapes and strides travel
// in uniforms; only layout and epilogue choices are baked into shader text.

const storage = (index, name, write = false) =>
  `@group(0) @binding(${index}) var<storage,${write ? 'read_write' : 'read'}> ${name}:array<f32>;`;
const uniform = (index, type) => `@group(0) @binding(${index}) var<uniform> p:${type};`;

export const GEMM_PARAMS_WORDS = 20;

// C[b,m,n] = alpha * sum_k A[b,m,k] * B[b,k,n] (+ biasM[m]) (+ biasM2[m]) (+ biasN[n]) (+ R[b,m,n])
// Element offsets/strides are uniforms. `aKContiguous` and `bNContiguous`
// choose the coalesced tile-load order; they do not change the arithmetic.
// `conv` replaces the B load with implicit im2col over an NCHW input.
// Tile shape: a 16x16 thread grid computes a (16*tm) x (16*tn) output tile,
// stepping K by bk. `aF16`/`bF16` read that operand as packed binary16 pairs
// (u32 words) and widen to F32; accumulation stays F32.
export function gemmTileShape({ tm = 4, tn = 4, bk = 16 } = {}) {
  return { tm, tn, bk, bm: 16 * tm, bn: 16 * tn };
}

// Shared pieces of the GEMM kernels: bindings, params struct, operand fetches,
// tile loaders (for `threads` threads filling bk x bm / bk x bn tiles) and the
// epilogue that turns accumulator value ACC into the stored output.
function gemmParts({ aKContiguous = true, bNContiguous = true, biasM = false, biasM2 = false, biasN = false,
  residual = false, conv = null, aF16 = false, bF16 = false }, { bm, bn, bk, threads, aLayout = 'k-major' }) {
  const operand = (index, name, half) => half
    ? `@group(0) @binding(${index}) var<storage,read> ${name}:array<u32>;`
    : storage(index, name);
  const fetch = (name, half, index) => half
    ? `unpack2x16float(${name}[(${index})>>1u])[(${index})&1u]`
    : `${name}[${index}]`;
  const bindings = [operand(0, 'a', aF16), operand(1, 'b', bF16)];
  let next = 2;
  if (biasM) bindings.push(storage(next++, 'bias_m'));
  if (biasM2) bindings.push(storage(next++, 'bias_m2'));
  if (biasN) bindings.push(storage(next++, 'bias_n'));
  if (residual) bindings.push(storage(next++, 'res'));
  bindings.push(storage(next++, 'c', true));
  bindings.push(uniform(next++, 'Params'));
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
  let valueB;
  if (conv) {
    const { kh, kw, stride, upsample } = conv;
    // p.b_sk/p.b_sn/p.b_sb are reused as input H, input W and output W.
    valueB = `let ci=k/${kh * kw}u;let r=k%${kh * kw}u;let ky=r/${kw}u;let kx=r%${kw}u;
      let oy=n/p.b_sb;let ox=n%p.b_sb;
      let iy=i32(oy*${stride}u+ky)-i32(p.pad_top);let ix=i32(ox*${stride}u+kx)-i32(p.pad_left);
      let eh=i32(p.b_sk${upsample ? '*2u' : ''});let ew=i32(p.b_sn${upsample ? '*2u' : ''});
      if(iy>=0&&ix>=0&&iy<eh&&ix<ew){
        let sy=u32(iy)${upsample ? '/2u' : ''};let sx=u32(ix)${upsample ? '/2u' : ''};
        value=${fetch('b', bF16, 'p.b_off+ci*p.b_sk*p.b_sn+sy*p.b_sn+sx')};
      }`;
  } else {
    valueB = `value=${fetch('b', bF16, 'p.b_off+bat*p.b_sb+k*p.b_sk+n*p.b_sn')};`;
  }
  const storeA = aLayout === 'k-major' ? `tile_a[kk*${bm}u+mm]=value;` : `tile_a[mm*${bk}u+kk]=value;`;
  const loaders = `    for(var q=0u;q<${(bk * bm) / threads}u;q++){
      let idx=tid+q*${threads}u;
      ${orderA}
      let m=m0+mm;let k=k0+kk;var value=0.0;
      if(m<p.M&&k<p.K){value=${fetch('a', aF16, 'p.a_off+bat*p.a_sb+m*p.a_sm+k*p.a_sk')};}
      ${storeA}
    }
    for(var q=0u;q<${(bk * bn) / threads}u;q++){
      let idx=tid+q*${threads}u;
      ${orderB}
      let n=n0+nn;let k=k0+kk;var value=0.0;
      if(n<p.N&&k<p.K){ ${valueB} }
      tile_b[kk*${bn}u+nn]=value;
    }`;
  let epilogue = 'var v=p.alpha*(ACC);';
  if (biasM) epilogue += 'v+=bias_m[m];';
  if (biasM2) epilogue += 'v+=bias_m2[m];';
  if (biasN) epilogue += 'v+=bias_n[n];';
  const cIndex = 'p.c_off+bat*p.c_sb+m*p.c_sm+n*p.c_sn';
  if (residual) epilogue += `v+=res[${cIndex}];`;
  epilogue += `c[${cIndex}]=v;`;
  return { header, loaders, epilogue };
}

// precision: 'f32' (default); 'f16-tiles' rounds both operand tiles to f16 in
// workgroup memory and multiplies in F32; 'f16-partial' also multiplies and
// accumulates each bk-wide K step in f16, adding the partial into F32 per step.
// Both f16 modes require the shader-f16 feature.
export function gemmShader({ tile = {}, precision = 'f32', ...layout } = {}) {
  if (precision !== 'f32') return gemmShaderF16({ tile, precision, ...layout });
  const { tm, tn, bk, bm, bn } = gemmTileShape(tile);
  const { header, loaders, epilogue } = gemmParts(layout, { bm, bn, bk, threads: 256 });
  return `
${header}
var<workgroup> tile_a:array<f32,${bk * bm}>;
var<workgroup> tile_b:array<f32,${bk * bn}>;
@compute @workgroup_size(16,16)
fn main(@builtin(local_invocation_id) lid:vec3<u32>, @builtin(workgroup_id) wid:vec3<u32>) {
  let tid=lid.y*16u+lid.x;
  let m0=wid.y*${bm}u;let n0=p.n_base+wid.x*${bn}u;let bat=wid.z;
  var acc:array<array<f32,${tn}>,${tm}>;
  for(var k0=0u;k0<p.K;k0+=${bk}u){
${loaders}
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
  const { tm, tn, bk, bm, bn } = gemmTileShape(tile);
  const { header, loaders, epilogue } = gemmParts(layout, { bm, bn, bk, threads: 256 });
  const half = precision === 'f16-partial';
  return `enable f16;
${header}
var<workgroup> tile_a:array<f16,${bk * bm}>;
var<workgroup> tile_b:array<f16,${bk * bn}>;
@compute @workgroup_size(16,16)
fn main(@builtin(local_invocation_id) lid:vec3<u32>, @builtin(workgroup_id) wid:vec3<u32>) {
  let tid=lid.y*16u+lid.x;
  let m0=wid.y*${bm}u;let n0=p.n_base+wid.x*${bn}u;let bat=wid.z;
  var acc:array<array<f32,${tn}>,${tm}>;
  for(var k0=0u;k0<p.K;k0+=${bk}u){
${loaders.replaceAll('tile_a[kk*', 'tile_a[kk*').replace(/(tile_a\[[^\]]+\])=value;/, '$1=f16(value);').replace(/(tile_b\[[^\]]+\])=value;/, '$1=f16(value);')}
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

// Subgroup-matrix GEMM (chromium-experimental-subgroup-matrix, Apple
// simdgroup matrices). One 32-lane subgroup per workgroup so every matrix
// offset derives from workgroup_id (WGSL requires uniform offsets). Each
// workgroup computes a 32x64 tile as 4x8 F32 8x8 results, K step 16.
export const SUBGROUP_MATRIX_TILE = Object.freeze({ bm: 32, bn: 64, bk: 16 });

export function gemmSubgroupMatrixShader(layout = {}) {
  const { bm, bn, bk } = SUBGROUP_MATRIX_TILE;
  const { header, loaders, epilogue } = gemmParts(layout, { bm, bn, bk, threads: 32, aLayout: 'm-major' });
  const rows = bm / 8, cols = bn / 8;
  const name = (i, j) => `acc${i}_${j}`;
  let declare = '', mma = '', store = '';
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    declare += `var ${name(i, j)}=subgroup_matrix_result<f32,8,8>();`;
    mma += `${name(i, j)}=subgroupMatrixMultiplyAccumulate(l${i},r${j},${name(i, j)});`;
    store += `subgroupMatrixStore(&outt,${i * 8 * bn + j * 8}u,${name(i, j)},false,${bn}u);`;
  }
  let loads = '';
  for (let i = 0; i < rows; i++) loads += `let l${i}=subgroupMatrixLoad<subgroup_matrix_left<f32,8,8>>(&tile_a,${i * 8 * bk}u+kk,false,${bk}u);`;
  for (let j = 0; j < cols; j++) loads += `let r${j}=subgroupMatrixLoad<subgroup_matrix_right<f32,8,8>>(&tile_b,kk*${bn}u+${j * 8}u,false,${bn}u);`;
  return `enable chromium_experimental_subgroup_matrix;
${header}
var<workgroup> tile_a:array<f32,${bm * bk}>;
var<workgroup> tile_b:array<f32,${bk * bn}>;
var<workgroup> outt:array<f32,${bm * bn}>;
@compute @workgroup_size(32)
fn main(@builtin(local_invocation_index) tid:u32, @builtin(workgroup_id) wid:vec3<u32>) {
  let m0=wid.y*${bm}u;let n0=p.n_base+wid.x*${bn}u;let bat=wid.z;
  ${declare}
  for(var k0=0u;k0<p.K;k0+=${bk}u){
${loaders}
    workgroupBarrier();
    for(var kk=0u;kk<${bk}u;kk+=8u){
      ${loads}
      ${mma}
    }
    workgroupBarrier();
  }
  ${store}
  workgroupBarrier();
  for(var e=tid;e<${bm * bn}u;e+=32u){
    let ml=e/${bn}u;let nl=e%${bn}u;let m=m0+ml;let n=n0+nl;
    if(m>=p.M||n>=p.N){continue;}
    ${epilogue.replace('ACC', `outt[ml*${bn}u+nl]`)}
  }
}`;
}

export const GROUPNORM_CHUNK = 4096;

// Per-chunk two-pass statistics of one contiguous NCHW group range.
export function groupNormPartialShader() {
  return `
struct Params { group_size:u32, chunks:u32, z0:u32, z1:u32 };
${storage(0, 'x')}${storage(1, 'partial', true)}${uniform(2, 'Params')}
var<workgroup> red:array<f32,256>;
fn reduce(lane:u32, value:f32)->f32{
  red[lane]=value;workgroupBarrier();
  for(var s=128u;s>0u;s/=2u){if(lane<s){red[lane]+=red[lane+s];}workgroupBarrier();}
  let total=red[0];workgroupBarrier();return total;
}
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) lane:u32, @builtin(workgroup_id) wid:vec3<u32>) {
  let chunk=wid.x;let group=wid.y;
  let start=chunk*${GROUPNORM_CHUNK}u;let end=min(start+${GROUPNORM_CHUNK}u,p.group_size);
  let base=group*p.group_size;
  var sum=0.0;for(var i=start+lane;i<end;i+=256u){sum+=x[base+i];}
  let count=f32(end-start);let mean=reduce(lane,sum)/count;
  var sq=0.0;for(var i=start+lane;i<end;i+=256u){let d=x[base+i]-mean;sq+=d*d;}
  let m2=reduce(lane,sq);
  if(lane==0u){let o=(group*p.chunks+chunk)*3u;partial[o]=count;partial[o+1u]=mean;partial[o+2u]=m2;}
}`;
}

// Chan combination of chunk statistics into mean and reciprocal std.
export function groupNormCombineShader(eps) {
  return `
struct Params { group_size:u32, chunks:u32, groups:u32, z1:u32 };
${storage(0, 'partial')}${storage(1, 'stats', true)}${uniform(2, 'Params')}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>) {
  let group=gid.x;if(group>=p.groups){return;}
  var count=0.0;var mean=0.0;var m2=0.0;
  for(var c=0u;c<p.chunks;c++){
    let o=(group*p.chunks+c)*3u;let nb=partial[o];let mb=partial[o+1u];let m2b=partial[o+2u];
    let n=count+nb;let delta=mb-mean;
    mean=mean+delta*nb/n;m2=m2+m2b+delta*delta*count*nb/n;count=n;
  }
  stats[group*2u]=mean;stats[group*2u+1u]=inverseSqrt(m2/count+${formatFloat(eps)});
}`;
}

// y = (x - mean[g]) * rstd[g] * gamma[c] + beta[c], optionally SiLU.
export function groupNormApplyShader({ silu }) {
  return `
struct Params { total:u32, hw:u32, channels_per_group:u32, z0:u32 };
${storage(0, 'x')}${storage(1, 'stats')}${storage(2, 'gamma')}${storage(3, 'beta')}${storage(4, 'y', true)}${uniform(5, 'Params')}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>) {
  let i=gid.x+gid.y*grid.x*256u;if(i>=p.total){return;}
  let c=i/p.hw;let g=c/p.channels_per_group;
  var v=(x[i]-stats[g*2u])*stats[g*2u+1u]*gamma[c]+beta[c];
  ${silu ? 'v=v/(1.0+exp(-v));' : ''}
  y[i]=v;
}`;
}

// Row LayerNorm over the last dimension of a token-major [rows, channels] tensor.
export function layerNormShader(eps) {
  return `
struct Params { rows:u32, channels:u32, z0:u32, z1:u32 };
${storage(0, 'x')}${storage(1, 'gamma')}${storage(2, 'beta')}${storage(3, 'y', true)}${uniform(4, 'Params')}
var<workgroup> red:array<f32,256>;
fn reduce(lane:u32, value:f32)->f32{
  red[lane]=value;workgroupBarrier();
  for(var s=128u;s>0u;s/=2u){if(lane<s){red[lane]+=red[lane+s];}workgroupBarrier();}
  let total=red[0];workgroupBarrier();return total;
}
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) lane:u32, @builtin(workgroup_id) wid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>) {
  let row=wid.x+wid.y*grid.x;if(row>=p.rows){return;}
  let base=row*p.channels;
  var sum=0.0;for(var c=lane;c<p.channels;c+=256u){sum+=x[base+c];}
  let mean=reduce(lane,sum)/f32(p.channels);
  var sq=0.0;for(var c=lane;c<p.channels;c+=256u){let d=x[base+c]-mean;sq+=d*d;}
  let rstd=inverseSqrt(reduce(lane,sq)/f32(p.channels)+${formatFloat(eps)});
  for(var c=lane;c<p.channels;c+=256u){y[base+c]=(x[base+c]-mean)*rstd*gamma[c]+beta[c];}
}`;
}

// In-place row softmax over [rows, cols].
export function softmaxShader() {
  return `
struct Params { rows:u32, cols:u32, z0:u32, z1:u32 };
${storage(0, 's', true)}${uniform(1, 'Params')}
var<workgroup> red:array<f32,256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) lane:u32, @builtin(workgroup_id) wid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>) {
  let row=wid.x+wid.y*grid.x;if(row>=p.rows){return;}
  let base=row*p.cols;
  var mx=-3.402823e38;for(var c=lane;c<p.cols;c+=256u){mx=max(mx,s[base+c]);}
  red[lane]=mx;workgroupBarrier();
  for(var k=128u;k>0u;k/=2u){if(lane<k){red[lane]=max(red[lane],red[lane+k]);}workgroupBarrier();}
  mx=red[0];workgroupBarrier();
  var sum=0.0;for(var c=lane;c<p.cols;c+=256u){let e=exp(s[base+c]-mx);s[base+c]=e;sum+=e;}
  red[lane]=sum;workgroupBarrier();
  for(var k=128u;k>0u;k/=2u){if(lane<k){red[lane]+=red[lane+k];}workgroupBarrier();}
  let inv=1.0/red[0];
  for(var c=lane;c<p.cols;c+=256u){s[base+c]=s[base+c]*inv;}
}`;
}

// GEGLU: out[n, i] = x[n, i] * gelu_erf(x[n, inner + i]) for x = [rows, 2*inner].
export function gegluShader() {
  return `
struct Params { rows:u32, inner:u32, z0:u32, z1:u32 };
${storage(0, 'x')}${storage(1, 'y', true)}${uniform(2, 'Params')}
fn erf_approx(v:f32)->f32{
  // Abramowitz-Stegun 7.1.26, |error| < 1.5e-7.
  let s=sign(v);let a=abs(v);let t=1.0/(1.0+0.3275911*a);
  let poly=((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592;
  return s*(1.0-poly*t*exp(-a*a));
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>) {
  let i=gid.x+gid.y*grid.x*256u;if(i>=p.rows*p.inner){return;}
  let row=i/p.inner;let col=i%p.inner;
  let h=x[row*2u*p.inner+col];let g=x[row*2u*p.inner+p.inner+col];
  y[i]=h*(0.5*g*(1.0+erf_approx(g*0.70710678118654752)));
}`;
}

// y = scale * x + shift, elementwise (latent scaling, x0 rule, postprocess),
// optionally followed by clamp to [0, 1] or SiLU.
export function affineShader({ clamp01 = false, silu = false } = {}) {
  return `
struct Params { total:u32, scale:f32, shift:f32, z0:u32 };
${storage(0, 'x')}${storage(1, 'y', true)}${uniform(2, 'Params')}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>) {
  let i=gid.x+gid.y*grid.x*256u;if(i>=p.total){return;}
  var v=p.scale*x[i]+p.shift;
  ${clamp01 ? 'v=clamp(v,0.0,1.0);' : ''}
  ${silu ? 'v=v/(1.0+exp(-v));' : ''}
  y[i]=v;
}`;
}

function formatFloat(value) {
  const text = Number(value).toExponential();
  return text.includes('.') || text.includes('e') ? text : `${text}.0`;
}

export const FLASH_HEAD_DIM = 64;
export const FLASH_QUERY_TILE = 64;
const FLASH_KEY_TILE = 32;

// Streaming (online-softmax) multi-head attention for head dim 64. One thread
// owns one query row of one head and folds 32-key tiles of K and V from
// workgroup memory into a running max, normalizer and F32 accumulator, so no
// [heads, queries, keys] score matrix is ever stored. Q/K/V/out are
// token-major with head h at columns [h*64, h*64+64).
export function flashAttentionShader() {
  const D = FLASH_HEAD_DIM, T = FLASH_KEY_TILE;
  return `
struct Params { queries:u32, keys:u32, q_stride:u32, kv_stride:u32, out_stride:u32, row_base:u32, scale:f32, z0:u32 };
${storage(0, 'q')}${storage(1, 'k')}${storage(2, 'v')}${storage(3, 'o', true)}${uniform(4, 'Params')}
var<workgroup> kt:array<f32,${T * D}>;
var<workgroup> vt:array<f32,${T * D}>;
@compute @workgroup_size(${FLASH_QUERY_TILE})
fn main(@builtin(local_invocation_index) lane:u32, @builtin(workgroup_id) wid:vec3<u32>) {
  let head=wid.y;let row=p.row_base+wid.x*${FLASH_QUERY_TILE}u+lane;let live=row<p.queries;
  var qv:array<f32,${D}>;var acc:array<f32,${D}>;
  if(live){for(var d=0u;d<${D}u;d++){qv[d]=q[row*p.q_stride+head*${D}u+d]*p.scale;}}
  var running_max=-3.402823e38;var norm=0.0;
  for(var k0=0u;k0<p.keys;k0+=${T}u){
    for(var i=lane;i<${T * D}u;i+=${FLASH_QUERY_TILE}u){
      let key=k0+i/${D}u;let d=i%${D}u;var kval=0.0;var vval=0.0;
      if(key<p.keys){kval=k[key*p.kv_stride+head*${D}u+d];vval=v[key*p.kv_stride+head*${D}u+d];}
      kt[i]=kval;vt[i]=vval;
    }
    workgroupBarrier();
    if(live){
      var s:array<f32,${T}>;var tile_max=running_max;
      for(var j=0u;j<${T}u;j++){
        var dot=0.0;
        for(var d=0u;d<${D}u;d++){dot=fma(qv[d],kt[j*${D}u+d],dot);}
        if(k0+j>=p.keys){dot=-3.402823e38;}
        s[j]=dot;tile_max=max(tile_max,dot);
      }
      let correction=exp(running_max-tile_max);
      norm*=correction;
      for(var d=0u;d<${D}u;d++){acc[d]*=correction;}
      for(var j=0u;j<${T}u;j++){
        if(k0+j>=p.keys){continue;}
        let w=exp(s[j]-tile_max);norm+=w;
        for(var d=0u;d<${D}u;d++){acc[d]=fma(w,vt[j*${D}u+d],acc[d]);}
      }
      running_max=tile_max;
    }
    workgroupBarrier();
  }
  if(live){let inv=1.0/norm;for(var d=0u;d<${D}u;d++){o[row*p.out_stride+head*${D}u+d]=acc[d]*inv;}}
}`;
}

// Vectorized streaming attention: same online-softmax recurrence as
// flashAttentionShader, with Q held as 16 vec4s and K/V tiles in vec4
// workgroup memory so each key dot and value update is 16 vec4 FMAs.
export function flashAttentionVec4Shader({ keyTile = 32 } = {}) {
  const D4 = FLASH_HEAD_DIM / 4, T = keyTile;
  return `
struct Params { queries:u32, keys:u32, q_stride:u32, kv_stride:u32, out_stride:u32, row_base:u32, scale:f32, z0:u32 };
${storage(0, 'q')}${storage(1, 'k')}${storage(2, 'v')}${storage(3, 'o', true)}${uniform(4, 'Params')}
var<workgroup> kt:array<vec4<f32>,${T * D4}>;
var<workgroup> vt:array<vec4<f32>,${T * D4}>;
@compute @workgroup_size(${FLASH_QUERY_TILE})
fn main(@builtin(local_invocation_index) lane:u32, @builtin(workgroup_id) wid:vec3<u32>) {
  let head=wid.y;let row=p.row_base+wid.x*${FLASH_QUERY_TILE}u+lane;let live=row<p.queries;
  var qv:array<vec4<f32>,${D4}>;var acc:array<vec4<f32>,${D4}>;
  if(live){
    let qb=row*p.q_stride+head*${FLASH_HEAD_DIM}u;
    for(var d=0u;d<${D4}u;d++){qv[d]=vec4<f32>(q[qb+4u*d],q[qb+4u*d+1u],q[qb+4u*d+2u],q[qb+4u*d+3u])*p.scale;}
  }
  var running_max=-3.402823e38;var norm=0.0;
  for(var k0=0u;k0<p.keys;k0+=${T}u){
    for(var i=lane;i<${T * D4}u;i+=${FLASH_QUERY_TILE}u){
      let key=k0+i/${D4}u;let d=i%${D4}u;var kv=vec4<f32>(0.0);var vv=vec4<f32>(0.0);
      if(key<p.keys){
        let b=key*p.kv_stride+head*${FLASH_HEAD_DIM}u+4u*d;
        kv=vec4<f32>(k[b],k[b+1u],k[b+2u],k[b+3u]);vv=vec4<f32>(v[b],v[b+1u],v[b+2u],v[b+3u]);
      }
      kt[i]=kv;vt[i]=vv;
    }
    workgroupBarrier();
    if(live){
      var s:array<f32,${T}>;var tile_max=running_max;
      for(var j=0u;j<${T}u;j++){
        var dot4=vec4<f32>(0.0);
        for(var d=0u;d<${D4}u;d++){dot4=fma(qv[d],kt[j*${D4}u+d],dot4);}
        var dot=dot4.x+dot4.y+dot4.z+dot4.w;
        if(k0+j>=p.keys){dot=-3.402823e38;}
        s[j]=dot;tile_max=max(tile_max,dot);
      }
      let correction=exp(running_max-tile_max);
      norm*=correction;
      for(var d=0u;d<${D4}u;d++){acc[d]*=correction;}
      for(var j=0u;j<${T}u;j++){
        if(k0+j>=p.keys){continue;}
        let w=exp(s[j]-tile_max);norm+=w;
        for(var d=0u;d<${D4}u;d++){acc[d]=fma(vec4<f32>(w),vt[j*${D4}u+d],acc[d]);}
      }
      running_max=tile_max;
    }
    workgroupBarrier();
  }
  if(live){
    let inv=1.0/norm;let ob=row*p.out_stride+head*${FLASH_HEAD_DIM}u;
    for(var d=0u;d<${D4}u;d++){let r=acc[d]*inv;o[ob+4u*d]=r.x;o[ob+4u*d+1u]=r.y;o[ob+4u*d+2u]=r.z;o[ob+4u*d+3u]=r.w;}
  }
}`;
}
