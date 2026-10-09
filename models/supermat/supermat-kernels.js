// Model-owned WGSL for the SuperMat single-image route. All arithmetic and
// storage are F32, matching the CPU F32 reference. Shapes and strides travel
// in uniforms; only layout and epilogue choices are baked into shader text.

const storage = (index, name, write = false) =>
  `@group(0) @binding(${index}) var<storage,${write ? 'read_write' : 'read'}> ${name}:array<f32>;`;
const uniform = (index, type) => `@group(0) @binding(${index}) var<uniform> p:${type};`;

export const GEMM_TILE = 64;
export const GEMM_PARAMS_WORDS = 20;

// C[b,m,n] = alpha * sum_k A[b,m,k] * B[b,k,n] (+ biasM[m]) (+ biasM2[m]) (+ biasN[n]) (+ R[b,m,n])
// Element offsets/strides are uniforms. `aKContiguous` and `bNContiguous`
// choose the coalesced tile-load order; they do not change the arithmetic.
// `conv` replaces the B load with implicit im2col over an NCHW input.
export function gemmShader({ aKContiguous = true, bNContiguous = true, biasM = false, biasM2 = false,
  biasN = false, residual = false, conv = null } = {}) {
  const bindings = [storage(0, 'a'), storage(1, 'b')];
  let next = 2;
  if (biasM) bindings.push(storage(next++, 'bias_m'));
  if (biasM2) bindings.push(storage(next++, 'bias_m2'));
  if (biasN) bindings.push(storage(next++, 'bias_n'));
  if (residual) bindings.push(storage(next++, 'res'));
  bindings.push(storage(next++, 'c', true));
  bindings.push(uniform(next++, 'Params'));
  const loadA = aKContiguous
    ? 'let kk=idx%16u;let mm=idx/16u;'
    : 'let mm=idx%64u;let kk=idx/64u;';
  const loadBOrder = bNContiguous || conv
    ? 'let nn=idx%64u;let kk=idx/64u;'
    : 'let kk=idx%16u;let nn=idx/16u;';
  let loadB;
  if (conv) {
    const { kh, kw, stride, upsample } = conv;
    // p.b_sk/p.b_sn/p.b_sb are reused as input H, input W and output W.
    loadB = `let ci=k/${kh * kw}u;let r=k%${kh * kw}u;let ky=r/${kw}u;let kx=r%${kw}u;
      let oy=n/p.b_sb;let ox=n%p.b_sb;
      let iy=i32(oy*${stride}u+ky)-i32(p.pad_top);let ix=i32(ox*${stride}u+kx)-i32(p.pad_left);
      let eh=i32(p.b_sk${upsample ? '*2u' : ''});let ew=i32(p.b_sn${upsample ? '*2u' : ''});
      if(iy>=0&&ix>=0&&iy<eh&&ix<ew){
        let sy=u32(iy)${upsample ? '/2u' : ''};let sx=u32(ix)${upsample ? '/2u' : ''};
        value=b[p.b_off+ci*p.b_sk*p.b_sn+sy*p.b_sn+sx];
      }`;
  } else {
    loadB = 'value=b[p.b_off+bat*p.b_sb+k*p.b_sk+n*p.b_sn];';
  }
  let epilogue = 'var v=p.alpha*acc[i][j];';
  if (biasM) epilogue += 'v+=bias_m[m];';
  if (biasM2) epilogue += 'v+=bias_m2[m];';
  if (biasN) epilogue += 'v+=bias_n[n];';
  const cIndex = 'p.c_off+bat*p.c_sb+m*p.c_sm+n*p.c_sn';
  if (residual) epilogue += `v+=res[${cIndex}];`;
  return `
struct Params {
  M:u32, N:u32, K:u32, alpha:f32,
  a_off:u32, a_sm:u32, a_sk:u32, a_sb:u32,
  b_off:u32, b_sk:u32, b_sn:u32, b_sb:u32,
  c_off:u32, c_sm:u32, c_sn:u32, c_sb:u32,
  pad_top:u32, pad_left:u32, z0:u32, z1:u32,
};
${bindings.join('\n')}
var<workgroup> tile_a:array<f32,1024>;
var<workgroup> tile_b:array<f32,1024>;
@compute @workgroup_size(16,16)
fn main(@builtin(local_invocation_id) lid:vec3<u32>, @builtin(workgroup_id) wid:vec3<u32>) {
  let tid=lid.y*16u+lid.x;
  let m0=wid.y*64u;let n0=wid.x*64u;let bat=wid.z;
  var acc:array<array<f32,4>,4>;
  for(var k0=0u;k0<p.K;k0+=16u){
    for(var q=0u;q<4u;q++){
      let idx=tid+q*256u;
      { ${loadA}
        let m=m0+mm;let k=k0+kk;var value=0.0;
        if(m<p.M&&k<p.K){value=a[p.a_off+bat*p.a_sb+m*p.a_sm+k*p.a_sk];}
        tile_a[kk*64u+mm]=value; }
      { ${loadBOrder}
        let n=n0+nn;let k=k0+kk;var value=0.0;
        if(n<p.N&&k<p.K){ ${loadB} }
        tile_b[kk*64u+nn]=value; }
    }
    workgroupBarrier();
    for(var kk=0u;kk<16u;kk++){
      var av:array<f32,4>;var bv:array<f32,4>;
      for(var i=0u;i<4u;i++){av[i]=tile_a[kk*64u+lid.y+16u*i];}
      for(var j=0u;j<4u;j++){bv[j]=tile_b[kk*64u+lid.x+16u*j];}
      for(var i=0u;i<4u;i++){for(var j=0u;j<4u;j++){acc[i][j]=fma(av[i],bv[j],acc[i][j]);}}
    }
    workgroupBarrier();
  }
  for(var i=0u;i<4u;i++){
    let m=m0+lid.y+16u*i;
    if(m>=p.M){continue;}
    for(var j=0u;j<4u;j++){
      let n=n0+lid.x+16u*j;
      if(n>=p.N){continue;}
      ${epilogue}
      c[${cIndex}]=v;
    }
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
