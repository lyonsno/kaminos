// Caller owns buffers, command submission, cooperative duties and resource
// retirement. All math here is f32; affine weights retain their packed u32 bits.
export const affineShader = () => `
struct P { tokens:u32, rows:u32, columns:u32, group_size:u32,
 input_offset:u32, input_stride:u32, weight_row_offset:u32, output_offset:u32,
 output_stride:u32, pad0:u32, pad1:u32, pad2:u32 };
@group(0) @binding(0) var<storage,read> x:array<f32>;
@group(0) @binding(1) var<storage,read> weights:array<u32>;
@group(0) @binding(2) var<storage,read> scales:array<f32>;
@group(0) @binding(3) var<storage,read> biases:array<f32>;
@group(0) @binding(4) var<storage,read_write> output:array<f32>;
@group(0) @binding(5) var<uniform> p:P;
var<workgroup> sums:array<f32,64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) group:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>,
 @builtin(local_invocation_index) lane:u32) {
 let row=group.x+group.y*grid.x; let token=group.z;
 if(row>=p.rows || token>=p.tokens){return;}
 let weight_row=row+p.weight_row_offset; let words=p.columns/8u;
 var sum=0.0;
 for(var word=lane;word<words;word+=64u){
  let packed=weights[weight_row*words+word];
  let s=weight_row*(p.columns/p.group_size)+(word*8u)/p.group_size;
  for(var nibble=0u;nibble<8u;nibble++){
   let quant=f32((packed>>(nibble*4u))&15u);
   let value=quant*scales[s]+biases[s];
   sum+=x[p.input_offset+token*p.input_stride+word*8u+nibble]*value;
  }
 }
 sums[lane]=sum; workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){sums[lane]+=sums[lane+stride];}workgroupBarrier();}
 if(lane==0u){output[p.output_offset+token*p.output_stride+row]=sums[0];}
}`;

// Experimental GEMV: four independent rows reuse each activation load. Each
// row keeps the oracle's word/nibble order and 64-lane tree reduction in f32.
// Partial row groups stay in every barrier and mask their source/output access.
export function affineQuadShader() {
  const axes = ['x', 'y', 'z', 'w'];
  const loads = axes.map((axis, i) => `if(base+${i}u<p.rows){
    let source=base+${i}u+p.weight_row_offset;
    packed.${axis}=weights[source*words+word];
    let s=source*(p.columns/p.group_size)+(word*8u)/p.group_size;
    scale.${axis}=scales[s];bias.${axis}=biases[s];
  }`).join('\n');
  const quant = axes.map(axis => `f32((packed.${axis}>>(nibble*4u))&15u)`).join(',');
  const stores = axes.map((axis, i) => `if(base+${i}u<p.rows){output[p.output_offset+token*p.output_stride+base+${i}u]=sums[0].${axis};}`).join('\n');
  return `
struct P { tokens:u32, rows:u32, columns:u32, group_size:u32,
 input_offset:u32, input_stride:u32, weight_row_offset:u32, output_offset:u32,
 output_stride:u32, pad0:u32, pad1:u32, pad2:u32 };
@group(0) @binding(0) var<storage,read> x:array<f32>;
@group(0) @binding(1) var<storage,read> weights:array<u32>;
@group(0) @binding(2) var<storage,read> scales:array<f32>;
@group(0) @binding(3) var<storage,read> biases:array<f32>;
@group(0) @binding(4) var<storage,read_write> output:array<f32>;
@group(0) @binding(5) var<uniform> p:P;
var<workgroup> sums:array<vec4<f32>,64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) group:vec3<u32>,@builtin(num_workgroups) grid:vec3<u32>,
 @builtin(local_invocation_index) lane:u32){
 let base=(group.x+group.y*grid.x)*4u;let token=group.z;
 if(base>=p.rows || token>=p.tokens){return;}
 let words=p.columns/8u;var sum=vec4<f32>(0.0);
 for(var word=lane;word<words;word+=64u){
  var packed=vec4<u32>(0u);var scale=vec4<f32>(0.0);var bias=vec4<f32>(0.0);
  ${loads}
  for(var nibble=0u;nibble<8u;nibble++){
   let input=x[p.input_offset+token*p.input_stride+word*8u+nibble];
   let value=vec4<f32>(${quant})*scale+bias;sum+=input*value;
  }
 }
 sums[lane]=sum;workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){sums[lane]+=sums[lane+stride];}workgroupBarrier();}
 if(lane==0u){${stores}}
}`;
}

// Register-tiled GEMM follows the existing Klein tile/load/accumulator pattern.
// Retain separate f32 scale/bias bindings and the affine oracle's exact layout.
// Each 32x32 output tile reuses source weights across 32 prompt positions.
export function affineTiledShader() {
  const indices = [0, 1, 2, 3];
  const declarations = indices.flatMap(i => indices.map(j => `var c${i}_${j}=0.0;`)).join('\n');
  const loads = indices.map(i => `let a${i}=at[(lid.y*4u+${i}u)*32u+k]; let b${i}=bt[k*32u+lid.x*4u+${i}u];`).join('\n');
  const products = indices.flatMap(i => indices.map(j => `c${i}_${j}+=a${i}*b${j};`)).join('\n');
  const stores = indices.flatMap(i => indices.map(j => `{let m=m0+lid.y*4u+${i}u;let n=n0+lid.x*4u+${j}u;
    if(m<p.tokens && n<p.rows){output[p.output_offset+m*p.output_stride+n]=c${i}_${j};}}`)).join('\n');
  return `
struct P { tokens:u32, rows:u32, columns:u32, group_size:u32,
 input_offset:u32, input_stride:u32, weight_row_offset:u32, output_offset:u32,
 output_stride:u32, pad0:u32, pad1:u32, pad2:u32 };
@group(0) @binding(0) var<storage,read> x:array<f32>;
@group(0) @binding(1) var<storage,read> weights:array<u32>;
@group(0) @binding(2) var<storage,read> scales:array<f32>;
@group(0) @binding(3) var<storage,read> biases:array<f32>;
@group(0) @binding(4) var<storage,read_write> output:array<f32>;
@group(0) @binding(5) var<uniform> p:P;
var<workgroup> at:array<f32,1024>;
var<workgroup> bt:array<f32,1024>;
@compute @workgroup_size(8,8)
fn main(@builtin(workgroup_id) wg:vec3<u32>,@builtin(num_workgroups) grid:vec3<u32>,
 @builtin(local_invocation_id) lid:vec3<u32>,@builtin(local_invocation_index) lane:u32){
 let n0=(wg.x+wg.y*grid.x)*32u;let m0=wg.z*32u;
 ${declarations}
 for(var k0=0u;k0<p.columns;k0+=32u){
  for(var i=lane;i<1024u;i+=64u){
   let m=m0+i/32u;let k=k0+i%32u;var value=0.0;
   if(m<p.tokens && k<p.columns){value=x[p.input_offset+m*p.input_stride+k];}at[i]=value;
  }
  for(var i=lane;i<128u;i+=64u){
   let row=i/4u;let col=(i%4u)*8u;let n=n0+row;let k=k0+col;
   var packed=0u;var scale=0.0;var bias=0.0;
   if(n<p.rows && k<p.columns){
    let source=n+p.weight_row_offset;packed=weights[source*(p.columns/8u)+k/8u];
    let s=source*(p.columns/p.group_size)+k/p.group_size;scale=scales[s];bias=biases[s];
   }
   for(var q=0u;q<8u;q++){bt[(col+q)*32u+row]=f32((packed>>(q*4u))&15u)*scale+bias;}
  }
  workgroupBarrier();
  for(var k=0u;k<32u;k++){${loads}\n${products}}
  workgroupBarrier();
 }
 ${stores}
}`;
}

const DELTA = `
struct P { tokens:u32, kh:u32, vh:u32, kd:u32, vd:u32, kernel:u32, channels:u32, prepared:u32,
 epsilon:f32, pad0:u32, pad1:u32, pad2:u32 };
`;
export const deltaConvShader = () => DELTA + `
@group(0) @binding(0) var<storage,read> input:array<f32>;
@group(0) @binding(1) var<storage,read> weight:array<f32>;
@group(0) @binding(2) var<storage,read> history:array<f32>;
@group(0) @binding(3) var<storage,read_write> output:array<f32>;
@group(0) @binding(4) var<storage,read_write> next_history:array<f32>;
@group(0) @binding(5) var<uniform> p:P;
fn sample(row:i32, channel:u32)->f32 {
 if(row<0){return history[(u32(row+i32(p.kernel)-1))*p.channels+channel];}
 return input[u32(row)*p.channels+channel];
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x; let channel=i%p.channels; let token=i/p.channels;
 if(token<p.tokens){
  var value=0.0;
  for(var j=0u;j<p.kernel;j++){value+=sample(i32(token)+i32(j)-i32(p.kernel)+1,channel)*weight[channel*p.kernel+j];}
  output[i]=value/(1.0+exp(-value));
 }
 // Out-of-place history permits chunks shorter than the convolution window.
 if(token<p.kernel-1u){next_history[i]=sample(i32(p.tokens)+i32(token)-i32(p.kernel)+1,channel);}
}`;

export const deltaPrepareShader = () => DELTA + `
@group(0) @binding(0) var<storage,read> convolved:array<f32>;
@group(0) @binding(1) var<storage,read> gates:array<f32>;
@group(0) @binding(2) var<storage,read> parameters:array<f32>;
@group(0) @binding(3) var<storage,read_write> output:array<f32>;
@group(0) @binding(4) var<uniform> p:P;
var<workgroup> qs:array<f32,64>; var<workgroup> ks:array<f32,64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_index) lane:u32){
 let head=group.x;let token=group.y;let base=token*p.channels;let outbase=token*p.prepared;
 let key_width=p.kh*p.kd; var qsum=0.0;var ksum=0.0;
 for(var d=lane;d<p.kd;d+=64u){let q=convolved[base+head*p.kd+d];let k=convolved[base+key_width+head*p.kd+d];qsum+=q*q;ksum+=k*k;}
 qs[lane]=qsum;ks[lane]=ksum;workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){qs[lane]+=qs[lane+stride];ks[lane]+=ks[lane+stride];}workgroupBarrier();}
 let qr=inverseSqrt(qs[0]/f32(p.kd)+p.epsilon)/f32(p.kd);
 let kr=inverseSqrt(ks[0]/f32(p.kd)+p.epsilon)/sqrt(f32(p.kd));
 for(var d=lane;d<p.kd;d+=64u){
  output[outbase+head*p.kd+d]=convolved[base+head*p.kd+d]*qr;
  output[outbase+key_width+head*p.kd+d]=convolved[base+key_width+head*p.kd+d]*kr;
 }
 let repeat=p.vh/p.kh;
 for(var h=head*repeat;h<(head+1u)*repeat;h++){
  for(var d=lane;d<p.vd;d+=64u){output[outbase+2u*key_width+h*p.vd+d]=convolved[base+2u*key_width+h*p.vd+d];}
  if(lane==0u){
   let a=gates[token*2u*p.vh+h]+parameters[p.vh+h];
   let softplus=max(a,0.0)+log(1.0+exp(-abs(a)));
   output[outbase+p.channels+h]=exp(-exp(parameters[h])*softplus);
   output[outbase+p.channels+p.vh+h]=1.0/(1.0+exp(-gates[token*2u*p.vh+p.vh+h]));
  }
 }
}`;

export const deltaRecurrentShader = () => DELTA + `
@group(0) @binding(0) var<storage,read> prepared:array<f32>;
@group(0) @binding(1) var<storage,read_write> state:array<f32>;
@group(0) @binding(2) var<storage,read_write> output:array<f32>;
@group(0) @binding(3) var<uniform> p:P;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_index) lane:u32){
 let h=group.x;let kh=h/(p.vh/p.kh);let key_width=p.kh*p.kd;
 // State is [value head, key dimension, value dimension]. Each lane owns
 // whole value columns, so sequential updates need no inter-workgroup fence.
 for(var d=lane;d<p.vd;d+=64u){
  for(var token=0u;token<p.tokens;token++){
   let base=token*p.prepared;let decay=prepared[base+p.channels+h];let beta=prepared[base+p.channels+p.vh+h];
   var prediction=0.0;
   for(var k=0u;k<p.kd;k++){prediction+=state[(h*p.kd+k)*p.vd+d]*decay*prepared[base+key_width+kh*p.kd+k];}
   let delta=(prepared[base+2u*key_width+h*p.vd+d]-prediction)*beta;var value=0.0;
   for(var k=0u;k<p.kd;k++){
    let index=(h*p.kd+k)*p.vd+d;
    let next=state[index]*decay+prepared[base+key_width+kh*p.kd+k]*delta;
    state[index]=next;value+=next*prepared[base+kh*p.kd+k];
   }
   output[(token*p.vh+h)*p.vd+d]=value;
  }
 }
}`;

export const deltaNormShader = () => DELTA + `
@group(0) @binding(0) var<storage,read> input:array<f32>;
@group(0) @binding(1) var<storage,read> gate:array<f32>;
@group(0) @binding(2) var<storage,read> weight:array<f32>;
@group(0) @binding(3) var<storage,read_write> output:array<f32>;
@group(0) @binding(4) var<uniform> p:P;
var<workgroup> sums:array<f32,64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_index) lane:u32){
 let base=(group.y*p.vh+group.x)*p.vd;var sum=0.0;
 for(var d=lane;d<p.vd;d+=64u){let x=input[base+d];sum+=x*x;}
 sums[lane]=sum;workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){sums[lane]+=sums[lane+stride];}workgroupBarrier();}
 let inv=inverseSqrt(sums[0]/f32(p.vd)+p.epsilon);
 for(var d=lane;d<p.vd;d+=64u){let z=gate[base+d];output[base+d]=input[base+d]*inv*weight[d]*(z/(1.0+exp(-z)));}
}`;

const ATTENTION = `
struct P { tokens:u32,qh:u32,kvh:u32,dim:u32,rotary:u32,past:u32,capacity:u32,pad:u32,
 theta:f32,epsilon:f32,pad1:u32,pad2:u32 };
`;
export function attentionPrepareShader({ headDim = 256 } = {}) {
  if (!Number.isInteger(headDim) || headDim < 1) throw new RangeError('headDim must be positive');
  return ATTENTION + `
@group(0) @binding(0) var<storage,read> q_proj:array<f32>;
@group(0) @binding(1) var<storage,read> k_proj:array<f32>;
@group(0) @binding(2) var<storage,read> v_proj:array<f32>;
@group(0) @binding(3) var<storage,read> norms:array<f32>;
@group(0) @binding(4) var<storage,read_write> q:array<f32>;
@group(0) @binding(5) var<storage,read_write> keys:array<f32>;
@group(0) @binding(6) var<storage,read_write> values:array<f32>;
@group(0) @binding(7) var<uniform> p:P;
var<workgroup> qvalues:array<f32,${headDim}>;var<workgroup> kvalues:array<f32,${headDim}>;
var<workgroup> qs:array<f32,64>;var<workgroup> ks:array<f32,64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_index) lane:u32){
 let h=group.x;let token=group.y;let qb=(token*p.qh+h)*2u*p.dim;let kb=(token*p.kvh+h)*p.dim;
 var qsum=0.0;var ksum=0.0;
 for(var d=lane;d<p.dim;d+=64u){
  let x=q_proj[qb+d];qvalues[d]=x;qsum+=x*x;
  if(h<p.kvh){let y=k_proj[kb+d];kvalues[d]=y;ksum+=y*y;}
 }
 qs[lane]=qsum;ks[lane]=ksum;workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){qs[lane]+=qs[lane+stride];ks[lane]+=ks[lane+stride];}workgroupBarrier();}
 let qi=inverseSqrt(qs[0]/f32(p.dim)+p.epsilon);let ki=inverseSqrt(ks[0]/f32(p.dim)+p.epsilon);
 for(var d=lane;d<p.dim;d+=64u){qvalues[d]*=qi*norms[d];if(h<p.kvh){kvalues[d]*=ki*norms[p.dim+d];}}
 workgroupBarrier();
 for(var d=lane;d<p.dim;d+=64u){
  var qv=qvalues[d];var kv=0.0;if(h<p.kvh){kv=kvalues[d];}
  if(d<p.rotary){
   let half=p.rotary/2u;let partner=(d+half)%p.rotary;
   let frequency=pow(p.theta,-f32(d%half)/f32(half));let angle=f32(p.past+token)*frequency;
   let sign=select(-1.0,1.0,d>=half);
   qv=qv*cos(angle)+sign*qvalues[partner]*sin(angle);
   if(h<p.kvh){kv=kv*cos(angle)+sign*kvalues[partner]*sin(angle);}
  }
  q[(token*p.qh+h)*p.dim+d]=qv;
  if(h<p.kvh){let dest=((p.past+token)*p.kvh+h)*p.dim+d;keys[dest]=kv;values[dest]=v_proj[kb+d];}
 }
}`;
}
export const attentionGateShader = () => ATTENTION + `
@group(0) @binding(0) var<storage,read> input:array<f32>;
@group(0) @binding(1) var<storage,read> q_proj:array<f32>;
@group(0) @binding(2) var<storage,read_write> output:array<f32>;
@group(0) @binding(3) var<uniform> p:P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=p.tokens*p.qh*p.dim){return;}let row=i/p.dim;let d=i%p.dim;
 output[i]=input[i]/(1.0+exp(-q_proj[row*2u*p.dim+p.dim+d]));
}`;
