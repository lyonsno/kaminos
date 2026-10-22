// Model-owned WGSL and CPU tables for the WiLoR hand detector port (YOLOv8m-pose
// as WiLoR-MLX runs it). Convolutions use the kit's tiled GEMM; these are the
// letterbox, SPPF max pool, nearest upsample, and head decode.

export const DETECTOR_SIZE = 512;
export const LETTERBOX_PAD = 114;
const f32 = Math.fround;

// WiLoR-MLX `_crop_and_resize_mlx(image, W/2, H/2, max(H, W), 512, pad 114)`,
// one axis at a time with MLX's float32 op order: t = (i + 0.5)/512,
// s = f32(c - half) + t * f32(2 half); out-of-range samples use the pad value;
// clip to [0, n - 1 - 1e-6] (as float32), truncate, neighbour min(i0 + 1, n - 1),
// fraction s - i0, and the complementary weight 1 - fraction.
// Returns per-sample [i0, i1, frac, oneMinusFrac, outside] as float32.
export function letterboxAxis(length, center, half) {
  const out = new Float32Array(DETECTOR_SIZE * 5);
  const start = f32(center - half), span = f32(2 * half), upper = f32(length - 1 - 1e-6);
  for (let i = 0; i < DETECTOR_SIZE; i++) {
    const t = f32(f32(i + 0.5) / DETECTOR_SIZE);
    const s = f32(start + f32(t * span));
    const outside = s < 0 || s > length - 1;
    const clipped = Math.min(Math.max(s, 0), upper);
    const i0 = Math.trunc(clipped), i1 = Math.min(i0 + 1, length - 1);
    const frac = f32(clipped - i0);
    out.set([i0, i1, frac, f32(1 - frac), outside ? 1 : 0], 5 * i);
  }
  return out;
}

export function letterboxTables(width, height) {
  const side = Math.max(width, height);
  return { columns: letterboxAxis(width, width / 2, side / 2), rows: letterboxAxis(height, height / 2, side / 2), side };
}

// mx.array(uint8).astype(float32) / 255.0 is correctly rounded.
export function unitTable() {
  const table = new Float32Array(256);
  for (let v = 0; v < 256; v++) table[v] = f32(v / 255);
  return table;
}

export const LETTERBOX = `
@group(0) @binding(1) var source:texture_2d<f32>;
@group(0) @binding(2) var<storage,read> columns:array<f32>;
@group(0) @binding(3) var<storage,read> rows:array<f32>;
@group(0) @binding(4) var<storage,read> unit:array<f32,256>;
@group(0) @binding(5) var<storage,read_write> input:array<f32>;
@group(0) @binding(6) var<storage,read_write> bytes:array<u32>;
fn px(x:f32, y:f32)->vec3<f32>{ return round(textureLoad(source, vec2<i32>(i32(x), i32(y)), 0).rgb*255.0); }
@compute @workgroup_size(16,16)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  if(gid.x>=${DETECTOR_SIZE}u||gid.y>=${DETECTOR_SIZE}u){return;}
  let cx=5u*gid.x;let cy=5u*gid.y;
  var q=vec3<u32>(${LETTERBOX_PAD}u);
  if(columns[cx+4u]==0.0&&rows[cy+4u]==0.0){
    let x0=columns[cx];let x1=columns[cx+1u];let fx=columns[cx+2u];let gx=columns[cx+3u];
    let y0=rows[cy];let y1=rows[cy+1u];let fy=rows[cy+2u];let gy=rows[cy+3u];
    // MLX: c00*(1-fx)*(1-fy) + c01*fx*(1-fy) + c10*(1-fx)*fy + c11*fx*fy, left to right.
    let t00=(px(x0,y0)*gx)*gy;let t01=(px(x1,y0)*fx)*gy;let t10=(px(x0,y1)*gx)*fy;let t11=(px(x1,y1)*fx)*fy;
    let v=((t00+t01)+t10)+t11;
    q=min(vec3<u32>(max(v,vec3<f32>(0.0))),vec3<u32>(255u));
  }
  let i=gid.y*${DETECTOR_SIZE}u+gid.x;let plane=${DETECTOR_SIZE * DETECTOR_SIZE}u;
  input[i]=unit[q.r];input[plane+i]=unit[q.g];input[2u*plane+i]=unit[q.b];
  bytes[i]=q.r|(q.g<<8u)|(q.b<<16u)|(255u<<24u);
}`;

const index1d = 'let i=gid.x+gid.y*grid.x*256u;';
const entry = body => `@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>){${index1d}${body}}`;

// 5x5 max pool, stride 1, padding 2 (padding never wins), from one region of a
// buffer to another region of the same buffer (SPPF's in-place concat).
export const MAXPOOL5 = `
struct P { c:u32, h:u32, w:u32, src_off:u32, dst_off:u32, z0:u32, z1:u32, z2:u32 };
@group(0) @binding(0) var<uniform> p:P;
@group(0) @binding(1) var<storage,read_write> x:array<f32>;
${entry(`let hw=p.h*p.w;if(i>=p.c*hw){return;}
  let c=i/hw;let r=i%hw;let oy=i32(r/p.w);let ox=i32(r%p.w);let b=p.src_off+c*hw;
  var m=-3.402823e38;
  for(var ky=-2;ky<=2;ky++){let iy=oy+ky;if(iy<0||iy>=i32(p.h)){continue;}
    for(var kx=-2;kx<=2;kx++){let ix=ox+kx;if(ix<0||ix>=i32(p.w)){continue;}m=max(m,x[b+u32(iy)*p.w+u32(ix)]);}}
  x[p.dst_off+i]=m;`)}`;

// Nearest 2x upsample of [C, H, W] into a [C, 2H, 2W] region of another buffer.
export const UP_NEAREST = `
struct P { c:u32, h:u32, w:u32, x_off:u32, y_off:u32, z0:u32, z1:u32, z2:u32 };
@group(0) @binding(0) var<uniform> p:P;
@group(0) @binding(1) var<storage,read> x:array<f32>;
@group(0) @binding(2) var<storage,read_write> y:array<f32>;
${entry(`let ow=2u*p.w;let ohw=4u*p.h*p.w;if(i>=p.c*ohw){return;}
  let c=i/ohw;let r=i%ohw;let oy=r/ow;let ox=r%ow;
  y[p.y_off+i]=x[p.x_off+c*p.h*p.w+(oy/2u)*p.w+ox/2u];`)}`;

// Pose head decode for one FPN level. head is [129, H, W]: 64 DFL box logits
// (4 sides x 16 bins), 2 class logits, 63 keypoint values (21 x [x, y, v]).
// Writes columns [anchor_off, anchor_off + H*W) of out [69, anchors]:
// cx, cy, w, h (letterbox pixels), sigmoid class scores, keypoints (x, y in
// letterbox pixels, sigmoid visibility), as WiLoR-MLX's Pose.__call__ does.
export const DECODE = `
struct P { h:u32, w:u32, anchors:u32, anchor_off:u32, stride:f32, z0:u32, z1:u32, z2:u32 };
@group(0) @binding(0) var<uniform> p:P;
@group(0) @binding(1) var<storage,read> head:array<f32>;
@group(0) @binding(2) var<storage,read_write> out:array<f32>;
fn sigmoid(v:f32)->f32{return 1.0/(1.0+exp(-v));}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let hw=p.h*p.w;let j=gid.x;if(j>=hw){return;}
  let a=p.anchor_off+j;let s=p.stride;
  let ax=f32(j%p.w)+0.5;let ay=f32(j/p.w)+0.5;
  var dist:array<f32,4>;
  for(var side=0u;side<4u;side++){
    var m=-3.402823e38;
    for(var b=0u;b<16u;b++){m=max(m,head[(side*16u+b)*hw+j]);}
    var e:array<f32,16>;var total=0.0;
    for(var b=0u;b<16u;b++){e[b]=exp(head[(side*16u+b)*hw+j]-m);total+=e[b];}
    var d=0.0;
    for(var b=0u;b<16u;b++){d+=(e[b]/total)*f32(b);}
    dist[side]=d;
  }
  let acx=ax*s;let acy=ay*s;
  let x1=acx-dist[0]*s;let y1=acy-dist[1]*s;let x2=acx+dist[2]*s;let y2=acy+dist[3]*s;
  out[a]=(x1+x2)/2.0;out[p.anchors+a]=(y1+y2)/2.0;out[2u*p.anchors+a]=x2-x1;out[3u*p.anchors+a]=y2-y1;
  out[4u*p.anchors+a]=sigmoid(head[64u*hw+j]);out[5u*p.anchors+a]=sigmoid(head[65u*hw+j]);
  let kx0=(ax-0.5)*s;let ky0=(ay-0.5)*s;
  for(var k=0u;k<21u;k++){
    let base=(66u+3u*k)*hw+j;let row=6u+3u*k;
    out[row*p.anchors+a]=head[base]*2.0*s+kx0;
    out[(row+1u)*p.anchors+a]=head[base+hw]*2.0*s+ky0;
    out[(row+2u)*p.anchors+a]=sigmoid(head[base+2u*hw]);
  }
}`;
