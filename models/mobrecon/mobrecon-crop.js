// MobRecon crop on WebGPU: a square box of an RGBA8 source texture to the
// network's 128x128 input, reproducing the native route byte for byte. The
// native route calls cv2.warpAffine (INTER_LINEAR, BORDER_CONSTANT 0) with the
// float32 matrix [[127/w, 0, -127 x0/w], [0, 127/h, -127 y0/h]], flips left
// hands horizontally and normalizes with (v/255 - 0.5)/0.5.
//
// OpenCV 5 inverts that matrix in double, casts it to float, maps each
// destination pixel with fused multiply-adds (row term fma(y, M4, M5), column
// term fma(M0, x, row term)), splits floor and fraction, interpolates with
// three fmas in float and rounds half to even. For an axis-aligned box the
// mapping separates into per-column and per-row tables, computed here in JS
// with exact float32 rounding; the GPU only gathers taps and interpolates.

export const CROP_SIZE = 128;
const f32 = Math.fround;
// Exact for float32 operands: the product is exact in double, one rounding to float.
const fma32 = (a, b, c) => f32(a * b + c);

// cv2.warpAffine's inverse map for the native crop matrix, as float32 values.
export function cropInverseMatrix(box) {
  const [x0, y0, x1, y1] = box.map(Number);
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) throw new RangeError('invalid crop box');
  const m = [f32(127 / (x1 - x0)), 0, f32(-127 * x0 / (x1 - x0)), 0, f32(127 / (y1 - y0)), f32(-127 * y0 / (y1 - y0))];
  let d = m[0] * m[4] - m[1] * m[3];
  d = d !== 0 ? 1 / d : 0;
  const a11 = m[4] * d, a22 = m[0] * d, m1 = m[1] * -d, m3 = m[3] * -d;
  const b1 = -a11 * m[2] - m1 * m[5], b2 = -m3 * m[2] - a22 * m[5];
  return [a11, m1, b1, m3, a22, b2].map(f32);
}

// Per-column [ix, alpha] and per-row [iy, beta] for the 128x128 destination.
export function cropSampleTables(box) {
  const M = cropInverseMatrix(box);
  if (M[1] !== 0 || M[3] !== 0) throw new Error('crop matrix must be axis-aligned');
  const columns = new Float32Array(CROP_SIZE * 2), rows = new Float32Array(CROP_SIZE * 2);
  const split = (value, out, i) => { const whole = Math.floor(value); out[2 * i] = whole; out[2 * i + 1] = f32(value - whole); };
  const rowX = fma32(0, M[1], M[2]);
  for (let x = 0; x < CROP_SIZE; x++) split(fma32(M[0], x, rowX), columns, x);
  for (let y = 0; y < CROP_SIZE; y++) split(fma32(M[3], 0, fma32(y, M[4], M[5])), rows, y);
  return { columns, rows, matrix: M };
}

// base_transform on bytes, with numpy's float32 rounding at each step.
export function normalizeTable() {
  const table = new Float32Array(256);
  for (let v = 0; v < 256; v++) table[v] = f32(f32(f32(v / 255) - 0.5) / 0.5);
  return table;
}

const SHADER = `
struct P { width:u32, height:u32, flip:u32, z0:u32 };
@group(0) @binding(0) var<uniform> p:P;
@group(0) @binding(1) var source:texture_2d<f32>;
@group(0) @binding(2) var<storage,read> columns:array<f32>;
@group(0) @binding(3) var<storage,read> rows:array<f32>;
@group(0) @binding(4) var<storage,read> normal:array<f32,256>;
@group(0) @binding(5) var<storage,read_write> input:array<f32>;
@group(0) @binding(6) var<storage,read_write> crop:array<u32>;
fn tap(x:i32, y:i32)->vec3<f32>{
  if(x<0||y<0||x>=i32(p.width)||y>=i32(p.height)){return vec3<f32>(0.0);}
  return round(textureLoad(source, vec2<i32>(x, y), 0).rgb*255.0);
}
@compute @workgroup_size(16,16)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  if(gid.x>=${CROP_SIZE}u||gid.y>=${CROP_SIZE}u){return;}
  // Left hands: crop[:, ::-1], so output column x takes warped column 127-x.
  let wx=select(gid.x, ${CROP_SIZE - 1}u-gid.x, p.flip==1u);
  let ix=i32(columns[2u*wx]);let a=columns[2u*wx+1u];
  let iy=i32(rows[2u*gid.y]);let b=rows[2u*gid.y+1u];
  let p00=tap(ix,iy);let p01=tap(ix+1,iy);let p10=tap(ix,iy+1);let p11=tap(ix+1,iy+1);
  let v0=fma(vec3<f32>(a),p01-p00,p00);let v1=fma(vec3<f32>(a),p11-p10,p10);
  let v=clamp(round(fma(vec3<f32>(b),v1-v0,v0)),vec3<f32>(0.0),vec3<f32>(255.0));
  let q=vec3<u32>(v);
  let i=gid.y*${CROP_SIZE}u+gid.x;let plane=${CROP_SIZE * CROP_SIZE}u;
  input[i]=normal[q.r];input[plane+i]=normal[q.g];input[2u*plane+i]=normal[q.b];
  crop[i]=q.r|(q.g<<8u)|(q.b<<16u)|(255u<<24u);
}`;

// Writes the network input buffer (and RGBA crop bytes) from a source texture.
export function createMobReconCrop({ device, input, label = 'mobrecon-crop' }) {
  const usage = GPUBufferUsage;
  const owned = [];
  const make = (size, flags, tag) => { const b = device.createBuffer({ label: `${label}:${tag}`, size, usage: flags }); owned.push(b); return b; };
  const params = make(16, usage.UNIFORM | usage.COPY_DST, 'params');
  const columns = make(CROP_SIZE * 8, usage.STORAGE | usage.COPY_DST, 'columns');
  const rows = make(CROP_SIZE * 8, usage.STORAGE | usage.COPY_DST, 'rows');
  const normal = make(256 * 4, usage.STORAGE | usage.COPY_DST, 'normalize');
  const crop = make(CROP_SIZE * CROP_SIZE * 4, usage.STORAGE | usage.COPY_SRC, 'bytes');
  device.queue.writeBuffer(normal, 0, normalizeTable());
  const pipeline = device.createComputePipeline({ label, layout: 'auto',
    compute: { module: device.createShaderModule({ label, code: SHADER }), entryPoint: 'main' } });
  let bound = null, bindGroup = null;
  return Object.freeze({
    crop,
    // texture: RGBA8 source (unorm, unmirrored camera pixels). box: [x0, y0, x1, y1] in source pixels.
    encode(encoder, { texture, box, handedness }) {
      if (!['left', 'right'].includes(handedness)) throw new Error('handedness must be left or right');
      const tables = cropSampleTables(box);
      device.queue.writeBuffer(params, 0, new Uint32Array([texture.width, texture.height, handedness === 'left' ? 1 : 0, 0]));
      device.queue.writeBuffer(columns, 0, tables.columns);
      device.queue.writeBuffer(rows, 0, tables.rows);
      if (bound !== texture) {
        bound = texture;
        bindGroup = device.createBindGroup({ label, layout: pipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: params } }, { binding: 1, resource: texture.createView() },
          { binding: 2, resource: { buffer: columns } }, { binding: 3, resource: { buffer: rows } },
          { binding: 4, resource: { buffer: normal } }, { binding: 5, resource: { buffer: input.buffer } },
          { binding: 6, resource: { buffer: crop } }] });
      }
      const pass = encoder.beginComputePass({ label });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(CROP_SIZE / 16, CROP_SIZE / 16);
      pass.end();
      return tables.matrix;
    },
    dispose() { for (const b of owned) b.destroy(); },
  });
}
