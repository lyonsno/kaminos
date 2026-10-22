// Model-owned WGSL for the MobRecon (DenseStack + SpiralConv) port. Arithmetic
// and storage are F32. Activations are [C, H, W] or [N, C] tensors addressed by
// element offsets into their buffer (`*_off` uniforms), so dense-block concats
// are channel slices of one buffer rather than copies. Weights are bound as
// exact tensor ranges and indexed from zero. Matrix products and 1x1/3x3
// convolutions use the inference kit's tiled GEMM; these are the rest.

const index1d = 'let i=gid.x+gid.y*grid.x*256u;';
const params = fields => `struct P{${fields.map(f => `${f}:u32`).join(',')}};
@group(0) @binding(0) var<uniform> p:P;`;
const ro = (binding, name) => `@group(0) @binding(${binding}) var<storage,read> ${name}:array<f32>;`;
const roI = (binding, name) => `@group(0) @binding(${binding}) var<storage,read> ${name}:array<i32>;`;
const rw = (binding, name) => `@group(0) @binding(${binding}) var<storage,read_write> ${name}:array<f32>;`;
const entry = body => `@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>){${index1d}${body}}`;

// Uniform words per kernel (u32, padded to a multiple of 4).
export const KERNEL_PARAMS = Object.freeze({
  depthwise: ['c', 'h', 'w', 'x_off', 'y_off', 'z0', 'z1', 'z2'],
  reorg: ['c', 'h', 'w', 'x_off', 'y_off', 'z0', 'z1', 'z2'],
  avgpool: ['c', 'h', 'w', 'x_off', 'y_off', 'scaled', 'z0', 'z1'],
  seSqueeze: ['c', 'hw', 'r', 'x_off'],
  channelScale: ['c', 'hw', 'x_off', 'y_off'],
  upNearestAdd: ['c', 'h', 'w', 'x_off', 'skip_off', 'y_off', 'z0', 'z1'],
  upBilinear: ['c', 'h', 'w', 'x_off', 'y_off', 'z0', 'z1', 'z2'],
  copy: ['count', 'src_off', 'dst_off', 'z0'],
  gridSample: ['points', 'c', 'h', 'w', 'x_off', 'uv_off', 'y_off', 'z0'],
  meshPool: ['n', 'c', 'x_off', 'y_off'],
  spiralConv: ['n', 'cin', 'cout', 'seq', 'x_off', 'y_off', 'relu', 'z0'],
});

// 3x3 depthwise conv, stride 1, zero padding 1, folded-BN bias, ReLU.
export const DEPTHWISE = `${params(KERNEL_PARAMS.depthwise)}
${ro(1, 'x')}${ro(2, 'wt')}${ro(3, 'bias')}${rw(4, 'y')}
${entry(`let hw=p.h*p.w;if(i>=p.c*hw){return;}
  let c=i/hw;let r=i%hw;let oy=i32(r/p.w);let ox=i32(r%p.w);
  let base=p.x_off+c*hw;var acc=0.0;
  for(var ky=0;ky<3;ky++){let iy=oy+ky-1;if(iy<0||iy>=i32(p.h)){continue;}
    for(var kx=0;kx<3;kx++){let ix=ox+kx-1;if(ix<0||ix>=i32(p.w)){continue;}
      acc+=x[base+u32(iy)*p.w+u32(ix)]*wt[c*9u+u32(ky*3+kx)];}}
  y[p.y_off+i]=max(acc+bias[c],0.0);`)}`;

// Reorg (space-to-depth): out[c*4 + 2*di + dj, y, x] = in[c, 2y + di, 2x + dj].
export const REORG = `${params(KERNEL_PARAMS.reorg)}
${ro(1, 'x')}${rw(2, 'y')}
${entry(`let oh=p.h/2u;let ow=p.w/2u;let ohw=oh*ow;if(i>=p.c*4u*ohw){return;}
  let oc=i/ohw;let r=i%ohw;let oy=r/ow;let ox=r%ow;
  let c=oc/4u;let di=(oc%4u)/2u;let dj=oc%2u;
  y[p.y_off+i]=x[p.x_off+c*p.h*p.w+(2u*oy+di)*p.w+2u*ox+dj];`)}`;

// 2x2 average pool, stride 2; optional per-channel scale (a preceding SE gate).
export const AVGPOOL = `${params(KERNEL_PARAMS.avgpool)}
${ro(1, 'x')}${ro(2, 'scale')}${rw(3, 'y')}
${entry(`let oh=p.h/2u;let ow=p.w/2u;let ohw=oh*ow;if(i>=p.c*ohw){return;}
  let c=i/ohw;let r=i%ohw;let oy=r/ow;let ox=r%ow;
  let b=p.x_off+c*p.h*p.w+2u*oy*p.w+2u*ox;
  var v=(x[b]+x[b+1u]+x[b+p.w]+x[b+p.w+1u])/4.0;
  if(p.scaled==1u){v=v*scale[c];}
  y[p.y_off+i]=v;`)}`;

// Squeeze-and-excitation gate in one workgroup: channel means, fc1 (folded BN,
// Hardtanh(0, 4)), fc2 (folded BN), sigmoid. C <= 1024, R <= 256.
export const SE_SQUEEZE = `${params(KERNEL_PARAMS.seSqueeze)}
${ro(1, 'x')}${ro(2, 'w1')}${ro(3, 'b1')}${ro(4, 'w2')}${ro(5, 'b2')}${rw(6, 'gate')}
var<workgroup> mean:array<f32,1024>;
var<workgroup> hidden:array<f32,256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) lane:u32){
  for(var c=lane;c<p.c;c+=256u){var s=0.0;let b=p.x_off+c*p.hw;for(var k=0u;k<p.hw;k++){s+=x[b+k];}mean[c]=s/f32(p.hw);}
  workgroupBarrier();
  for(var r=lane;r<p.r;r+=256u){var a=0.0;for(var c=0u;c<p.c;c++){a+=w1[r*p.c+c]*mean[c];}hidden[r]=clamp(a+b1[r],0.0,4.0);}
  workgroupBarrier();
  for(var c=lane;c<p.c;c+=256u){var a=0.0;for(var r=0u;r<p.r;r++){a+=w2[c*p.r+r]*hidden[r];}gate[c]=1.0/(1.0+exp(-(a+b2[c])));}
}`;

// y[c, :] = x[c, :] * gate[c].
export const CHANNEL_SCALE = `${params(KERNEL_PARAMS.channelScale)}
${ro(1, 'x')}${ro(2, 'gate')}${rw(3, 'y')}
${entry(`if(i>=p.c*p.hw){return;}y[p.y_off+i]=x[p.x_off+i]*gate[i/p.hw];`)}`;

// y = skip + nearest2x(x): x is [C, H, W], skip and y are [C, 2H, 2W].
export const UP_NEAREST_ADD = `${params(KERNEL_PARAMS.upNearestAdd)}
${ro(1, 'x')}${ro(2, 'skip')}${rw(3, 'y')}
${entry(`let oh=2u*p.h;let ow=2u*p.w;let ohw=oh*ow;if(i>=p.c*ohw){return;}
  let c=i/ohw;let r=i%ohw;let oy=r/ow;let ox=r%ow;
  y[p.y_off+i]=skip[p.skip_off+i]+x[p.x_off+c*p.h*p.w+(oy/2u)*p.w+ox/2u];`)}`;

// Bilinear 2x upsample with align_corners=True (PyTorch upsample_bilinear2d).
export const UP_BILINEAR = `${params(KERNEL_PARAMS.upBilinear)}
${ro(1, 'x')}${rw(2, 'y')}
${entry(`let oh=2u*p.h;let ow=2u*p.w;let ohw=oh*ow;if(i>=p.c*ohw){return;}
  let c=i/ohw;let r=i%ohw;let oy=r/ow;let ox=r%ow;
  let sh=f32(p.h-1u)/f32(oh-1u);let sw=f32(p.w-1u)/f32(ow-1u);
  let fy=sh*f32(oy);let fx=sw*f32(ox);
  let y0=u32(fy);let x0=u32(fx);let y1=min(y0+1u,p.h-1u);let x1=min(x0+1u,p.w-1u);
  let ly=fy-f32(y0);let lx=fx-f32(x0);
  let b=p.x_off+c*p.h*p.w;
  y[p.y_off+i]=(1.0-ly)*((1.0-lx)*x[b+y0*p.w+x0]+lx*x[b+y0*p.w+x1])+ly*((1.0-lx)*x[b+y1*p.w+x0]+lx*x[b+y1*p.w+x1]);`)}`;

export const COPY = `${params(KERNEL_PARAMS.copy)}
${ro(1, 'x')}${rw(2, 'y')}
${entry(`if(i>=p.count){return;}y[p.dst_off+i]=x[p.src_off+i];`)}`;

// MobRecon pose pooling: landmarks uv in [0, 1] become grid = clamp((uv-0.5)*2,
// -1, 1); bilinear grid_sample (align_corners=True, zero padding) of [C, H, W]
// features at each point gives point-major [points, C].
export const GRID_SAMPLE = `${params(KERNEL_PARAMS.gridSample)}
${ro(1, 'x')}${ro(2, 'uv')}${rw(3, 'y')}
fn tap(base:u32,ix:i32,iy:i32)->f32{
  if(ix<0||iy<0||ix>=i32(p.w)||iy>=i32(p.h)){return 0.0;}
  return x[base+u32(iy)*p.w+u32(ix)];
}
${entry(`if(i>=p.points*p.c){return;}
  let n=i/p.c;let c=i%p.c;
  let gx=clamp((uv[p.uv_off+2u*n]-0.5)*2.0,-1.0,1.0);let gy=clamp((uv[p.uv_off+2u*n+1u]-0.5)*2.0,-1.0,1.0);
  let fx=((gx+1.0)/2.0)*f32(p.w-1u);let fy=((gy+1.0)/2.0)*f32(p.h-1u);
  let x0=i32(floor(fx));let y0=i32(floor(fy));let x1=x0+1;let y1=y0+1;
  let nw=(f32(x1)-fx)*(f32(y1)-fy);let ne=(fx-f32(x0))*(f32(y1)-fy);
  let sw=(f32(x1)-fx)*(fy-f32(y0));let se=(fx-f32(x0))*(fy-f32(y0));
  let b=p.x_off+c*p.h*p.w;
  y[p.y_off+i]=tap(b,x0,y0)*nw+tap(b,x1,y0)*ne+tap(b,x0,y1)*sw+tap(b,x1,y1)*se;`)}`;

// Fixed-topology mesh upsampling: each output vertex is a barycentric
// combination of three coarse vertices. x is [N_coarse, C], y is [n, C].
export const MESH_POOL = `${params(KERNEL_PARAMS.meshPool)}
${ro(1, 'x')}${roI(2, 'src')}${ro(3, 'wt')}${rw(4, 'y')}
${entry(`if(i>=p.n*p.c){return;}
  let v=i/p.c;let c=i%p.c;var acc=0.0;
  for(var j=0u;j<3u;j++){acc+=x[p.x_off+u32(src[3u*v+j])*p.c+c]*wt[3u*v+j];}
  y[p.y_off+i]=acc;`)}`;

// SpiralConv: y[n, o] = bias[o] + sum_s sum_c x[spiral[n, s], c] * W[o, s*C + c],
// optionally ReLU. x is [N, C] vertex-major, W is [cout, seq*cin].
export const SPIRAL_CONV = `${params(KERNEL_PARAMS.spiralConv)}
${ro(1, 'x')}${roI(2, 'spiral')}${ro(3, 'wt')}${ro(4, 'bias')}${rw(5, 'y')}
${entry(`if(i>=p.n*p.cout){return;}
  let n=i/p.cout;let o=i%p.cout;let k=p.seq*p.cin;var acc=0.0;
  for(var s=0u;s<p.seq;s++){
    let xb=p.x_off+u32(spiral[n*p.seq+s])*p.cin;let wb=o*k+s*p.cin;
    for(var c=0u;c<p.cin;c++){acc+=x[xb+c]*wt[wb+c];}
  }
  var v=acc+bias[o];if(p.relu==1u){v=max(v,0.0);}
  y[p.y_off+i]=v;`)}`;

export const SHADERS = Object.freeze({
  depthwise: DEPTHWISE, reorg: REORG, avgpool: AVGPOOL, seSqueeze: SE_SQUEEZE, channelScale: CHANNEL_SCALE,
  upNearestAdd: UP_NEAREST_ADD, upBilinear: UP_BILINEAR, copy: COPY, gridSample: GRID_SAMPLE,
  meshPool: MESH_POOL, spiralConv: SPIRAL_CONV,
});
