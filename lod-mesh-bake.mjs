// Mesh-to-mesh PBR material baker for arbitrary GLBs (no TRELLIS raw decode or sparse voxel
// material field required). Reads a source GLB's triangle primitives, UV0, vertex colors, PBR
// factors and embedded PNG textures in the TRELLIS local frame (lx = wx, ly = -wz, lz = wy so
// encodeTrellisGeometryGLB's -90 deg X node matrix lands the finished tier in the exact world
// frame of the source GLB), and samples baseColor + metallicRoughness onto each covered texel
// of a simplified/remeshed level via BVH closest-point + barycentric interpolation.
// Runs in a browser worker or Node: zero Node-only imports or native dependencies.
import {glbNodeWorldMatrices} from './mesh-lod-ladder.mjs';
import {rasterizeTrellisMaterialUV, nearestCovered} from './models/trellis2/trellis-material.js';

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

export async function decodePNGBytes(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 33 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71)
    throw Error('invalid PNG signature');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0, plte = null, trns = null, sawIend = false;
  const idatParts = [];
  let offset = 8;
  while (offset + 8 <= bytes.byteLength) {
    const len = view.getUint32(offset, false);
    if (offset + 12 + len > bytes.byteLength) throw Error('truncated PNG chunk');
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const data = bytes.subarray(offset + 8, offset + 8 + len);
    offset += 12 + len;
    if (type === 'IHDR') {
      width = view.getUint32(data.byteOffset - bytes.byteOffset, false);
      height = view.getUint32(data.byteOffset - bytes.byteOffset + 4, false);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idatParts.push(data);
    else if (type === 'IEND') { sawIend = true; break; }
  }
  if (!sawIend) throw Error('truncated PNG chunk');
  if (width < 1 || height < 1 || bitDepth !== 8 || interlace !== 0 || ![0, 2, 3, 4, 6].includes(colorType))
    throw Error(`unsupported PNG format (${width}x${height}, bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace})`);
  const totalIdat = idatParts.reduce((s, p) => s + p.byteLength, 0);
  const idat = new Uint8Array(totalIdat);
  let at = 0;
  for (const p of idatParts) { idat.set(p, at); at += p.byteLength; }
  const raw = new Uint8Array(await new Response(new Blob([idat]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colorType], stride = width * channels;
  if (raw.byteLength < height * (stride + 1)) throw Error('truncated PNG image data');
  const prev = new Uint8Array(stride), cur = new Uint8Array(stride), rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1), filter = raw[rowStart];
    if (filter > 4) throw Error(`invalid PNG filter ${filter}`);
    for (let x = 0; x < stride; x++) {
      const v = raw[rowStart + 1 + x];
      const a = x >= channels ? cur[x - channels] : 0, b = prev[x], c = x >= channels ? prev[x - channels] : 0;
      cur[x] = filter === 0 ? v : filter === 1 ? (v + a) & 255 : filter === 2 ? (v + b) & 255
        : filter === 3 ? (v + ((a + b) >>> 1)) & 255 : (v + paeth(a, b, c)) & 255;
    }
    prev.set(cur);
    const dstRow = y * width * 4;
    for (let px = 0; px < width; px++) {
      const dst = dstRow + px * 4;
      if (colorType === 6) {
        rgba[dst] = cur[px * 4]; rgba[dst + 1] = cur[px * 4 + 1]; rgba[dst + 2] = cur[px * 4 + 2]; rgba[dst + 3] = cur[px * 4 + 3];
      } else if (colorType === 2) {
        rgba[dst] = cur[px * 3]; rgba[dst + 1] = cur[px * 3 + 1]; rgba[dst + 2] = cur[px * 3 + 2]; rgba[dst + 3] = 255;
      } else if (colorType === 0) {
        const g = cur[px]; rgba[dst] = g; rgba[dst + 1] = g; rgba[dst + 2] = g; rgba[dst + 3] = 255;
      } else if (colorType === 4) {
        const g = cur[px * 2]; rgba[dst] = g; rgba[dst + 1] = g; rgba[dst + 2] = g; rgba[dst + 3] = cur[px * 2 + 1];
      } else if (colorType === 3) {
        const idx = cur[px];
        rgba[dst] = plte ? plte[idx * 3] : 0; rgba[dst + 1] = plte ? plte[idx * 3 + 1] : 0; rgba[dst + 2] = plte ? plte[idx * 3 + 2] : 0;
        rgba[dst + 3] = trns && idx < trns.length ? trns[idx] : 255;
      }
    }
  }
  return {width, height, rgba};
}

const det3 = m => m[0]*(m[5]*m[10]-m[9]*m[6]) - m[4]*(m[1]*m[10]-m[9]*m[2]) + m[8]*(m[1]*m[6]-m[5]*m[2]);

export async function readGLBLocalSurfaceAndMaterials(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const glb = bytes.buffer, glbOffset = bytes.byteOffset;
  const view = new DataView(glb, glbOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) throw Error('not a glTF 2.0 binary');
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, glbOffset + 20, jsonLength))), bin = glbOffset + 28 + jsonLength;
  const worlds = glbNodeWorldMatrices(json);

  const decodedImages = new Map();
  const loadTextureImage = async texInfo => {
    if (!texInfo || typeof texInfo.index !== 'number') return null;
    if ((texInfo.texCoord ?? 0) !== 0) throw Error('only TEXCOORD_0 is supported by the mesh baker');
    const tex = json.textures?.[texInfo.index];
    if (!tex || typeof tex.source !== 'number') return null;
    if (decodedImages.has(tex.source)) return decodedImages.get(tex.source);
    const img = json.images?.[tex.source];
    if (!img || typeof img.bufferView !== 'number') throw Error(`GLB image ${tex.source} requires an embedded bufferView`);
    if (img.mimeType && img.mimeType !== 'image/png') throw Error(`unsupported GLB image mimeType ${img.mimeType}; image/png required`);
    const bv = json.bufferViews[img.bufferView];
    const imgBytes = new Uint8Array(glb, bin + (bv.byteOffset || 0), bv.byteLength);
    const decoded = await decodePNGBytes(imgBytes);
    decodedImages.set(tex.source, decoded);
    return decoded;
  };

  const materials = [];
  for (const mat of json.materials ?? []) {
    const pbr = mat.pbrMetallicRoughness ?? {};
    materials.push({
      baseColorFactor: pbr.baseColorFactor ?? [1, 1, 1, 1],
      metallicFactor: pbr.metallicFactor ?? 1,
      roughnessFactor: pbr.roughnessFactor ?? 1,
      baseColorImage: await loadTextureImage(pbr.baseColorTexture),
      metallicRoughnessImage: await loadTextureImage(pbr.metallicRoughnessTexture),
    });
  }

  const readAttr = (index, expectedTypes) => {
    const a = json.accessors[index];
    if (a.sparse) throw Error('sparse glTF accessors are not supported by the mesh baker');
    const bv = json.bufferViews[a.bufferView];
    const width = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4}[a.type];
    if (!expectedTypes.includes(a.type)) throw Error(`unexpected accessor type ${a.type}`);
    const T = {5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array}[a.componentType];
    if (!T) throw Error(`unsupported accessor componentType ${a.componentType}`);
    const scale = a.componentType === 5121 ? 1 / 255 : a.componentType === 5123 && a.type !== 'SCALAR' ? 1 / 65535 : 1;
    const elemBytes = width * T.BYTES_PER_ELEMENT;
    const stride = bv.byteStride || elemBytes;
    const start = bin + (bv.byteOffset || 0) + (a.byteOffset || 0);
    const total = a.count * width;
    if (stride === elemBytes && scale === 1) {
      if ((a.type === 'SCALAR' && T === Uint32Array) || (a.type !== 'SCALAR' && T === Float32Array)) {
        if (start % T.BYTES_PER_ELEMENT === 0) return {array: new T(glb, start, total), width, count: a.count};
        const out = new T(total);
        new Uint8Array(out.buffer).set(new Uint8Array(glb, start, total * T.BYTES_PER_ELEMENT));
        return {array: out, width, count: a.count};
      }
      if (start % T.BYTES_PER_ELEMENT === 0) {
        const src = new T(glb, start, total);
        const out = a.type === 'SCALAR' ? new Uint32Array(total) : new Float32Array(total);
        out.set(src);
        return {array: out, width, count: a.count};
      }
    }
    const out = a.type === 'SCALAR' ? new Uint32Array(a.count) : new Float32Array(total);
    if (start % T.BYTES_PER_ELEMENT === 0 && stride % T.BYTES_PER_ELEMENT === 0) {
      const step = stride / T.BYTES_PER_ELEMENT;
      const src = new T(glb, start, (a.count - 1) * step + width);
      for (let i = 0; i < a.count; i++) {
        const base = i * step;
        for (let k = 0; k < width; k++) out[i * width + k] = src[base + k] * scale;
      }
    } else {
      for (let i = 0; i < a.count; i++) {
        const row = new T(glb.slice(start + i * stride, start + i * stride + elemBytes));
        for (let k = 0; k < width; k++) out[i * width + k] = row[k] * scale;
      }
    }
    return {array: out, width, count: a.count};
  };

  const posChunks = [], uvChunks = [], colChunks = [], triChunks = [], matChunks = [], hasUVChunks = [], fieldChunks = [], hasFieldChunks = [];
  let vertexBase = 0;
  for (const [nodeIndex, world] of worlds) {
    const mesh = json.meshes?.[json.nodes[nodeIndex].mesh];
    if (!mesh) continue;
    const flip = det3(world) < 0;
    for (const primitive of mesh.primitives) {
      if (primitive.extensions?.KHR_draco_mesh_compression || primitive.extensions?.EXT_meshopt_compression)
        throw Error('compressed glTF primitives are not supported by the mesh baker');
      if (primitive.mode !== undefined && primitive.mode !== 4) continue;
      if (primitive.attributes.POSITION === undefined) continue;
      const posAcc = json.accessors[primitive.attributes.POSITION];
      if (posAcc.componentType !== 5126 || posAcc.type !== 'VEC3') throw Error('float32 VEC3 POSITION required');
      const rawPos = readAttr(primitive.attributes.POSITION, ['VEC3']).array;
      const count = rawPos.length / 3;
      const hasField = primitive.attributes._KAMINOS_MATERIAL !== undefined;
      const field = hasField ? readAttr(primitive.attributes._KAMINOS_MATERIAL, ['VEC2']) : null;
      if (field && (field.count !== count || !field.array.every(v => Number.isFinite(v) && v >= 0 && v <= 1)))
        throw Error('Invalid surface material field');
      fieldChunks.push(field?.array ?? new Float32Array(count * 2));
      const localPos = new Float32Array(rawPos.length);
      // Map world (wx, wy, wz) -> TRELLIS local (wx, -wz, wy) so encodeTrellisGeometryGLB's
      // node[0].matrix [1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1] maps local (lx, ly, lz) -> world (wx, wy, wz).
      for (let i = 0; i < rawPos.length; i += 3) {
        const x = rawPos[i], y = rawPos[i + 1], z = rawPos[i + 2];
        const wx = world[0]*x + world[4]*y + world[8]*z + world[12];
        const wy = world[1]*x + world[5]*y + world[9]*z + world[13];
        const wz = world[2]*x + world[6]*y + world[10]*z + world[14];
        localPos[i] = wx;
        localPos[i + 1] = -wz;
        localPos[i + 2] = wy;
      }
      posChunks.push(localPos);

      const hasUV = primitive.attributes.TEXCOORD_0 !== undefined;
      const uvs = hasUV ? readAttr(primitive.attributes.TEXCOORD_0, ['VEC2']).array : new Float32Array(count * 2);
      uvChunks.push(uvs);

      const cols = new Float32Array(count * 4).fill(1);
      if (primitive.attributes.COLOR_0 !== undefined) {
        const {array, width} = readAttr(primitive.attributes.COLOR_0, ['VEC3', 'VEC4']);
        for (let i = 0; i < count; i++) {
          cols[i * 4] = array[i * width];
          cols[i * 4 + 1] = array[i * width + 1];
          cols[i * 4 + 2] = array[i * width + 2];
          cols[i * 4 + 3] = width === 4 ? array[i * 4 + 3] : 1;
        }
      }
      colChunks.push(cols);

      const rawIdx = primitive.indices !== undefined ? readAttr(primitive.indices, ['SCALAR']).array : Uint32Array.from({length: count}, (_, i) => i);
      const tris = new Uint32Array(rawIdx.length);
      for (let i = 0; i < rawIdx.length; i += 3) {
        tris[i] = vertexBase + rawIdx[i];
        tris[i + 1] = vertexBase + rawIdx[flip ? i + 2 : i + 1];
        tris[i + 2] = vertexBase + rawIdx[flip ? i + 1 : i + 2];
      }
      triChunks.push(tris);
      const faceCount = tris.length / 3;
      matChunks.push(new Int32Array(faceCount).fill(primitive.material ?? -1));
      hasUVChunks.push(new Uint8Array(faceCount).fill(hasUV ? 1 : 0));
      hasFieldChunks.push(new Uint8Array(faceCount).fill(hasField ? 1 : 0));
      vertexBase += count;
    }
  }
  const concat = (chunks, T) => {
    const out = new T(chunks.reduce((s, c) => s + c.length, 0));
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  };
  const vertices = concat(posChunks, Float32Array), triangles = concat(triChunks, Uint32Array);
  if (!vertices.length || !triangles.length) throw Error('source GLB has no triangle surface');
  return {
    vertices,
    triangles,
    uvs: concat(uvChunks, Float32Array),
    colors: concat(colChunks, Float32Array),
    faceMaterials: concat(matChunks, Int32Array),
    faceHasUV: concat(hasUVChunks, Uint8Array),
    materialFields: concat(fieldChunks, Float32Array),
    faceHasMaterialFields: concat(hasFieldChunks, Uint8Array),
    materials,
  };
}

const sampleBilinear = (img, u, v) => {
  const {width, height, rgba} = img;
  const uw = ((u % 1) + 1) % 1, vw = ((v % 1) + 1) % 1;
  const fx = uw * width - 0.5, fy = vw * height - 0.5;
  const x0 = ((Math.floor(fx) % width) + width) % width, x1 = (x0 + 1) % width;
  const y0 = ((Math.floor(fy) % height) + height) % height, y1 = (y0 + 1) % height;
  const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
  const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
  const i00 = (y0 * width + x0) * 4, i10 = (y0 * width + x1) * 4, i01 = (y1 * width + x0) * 4, i11 = (y1 * width + x1) * 4;
  return [
    w00 * rgba[i00] + w10 * rgba[i10] + w01 * rgba[i01] + w11 * rgba[i11],
    w00 * rgba[i00 + 1] + w10 * rgba[i10 + 1] + w01 * rgba[i01 + 1] + w11 * rgba[i11 + 1],
    w00 * rgba[i00 + 2] + w10 * rgba[i10 + 2] + w01 * rgba[i01 + 2] + w11 * rgba[i11 + 2],
    w00 * rgba[i00 + 3] + w10 * rgba[i10 + 3] + w01 * rgba[i01 + 3] + w11 * rgba[i11 + 3],
  ];
};

const clampByte = v => Math.max(0, Math.min(255, Math.round(v)));
const srgbToLinear = u => u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
const linearToSrgb = l => l <= 0.0031308 ? 12.92 * l : 1.055 * (l ** (1 / 2.4)) - 0.055;
const bakeSrgbChannel = (srgbByte, linearScale) => linearScale === 1 ? clampByte(srgbByte) : clampByte(linearToSrgb(Math.max(0, Math.min(1, srgbToLinear(srgbByte / 255) * linearScale))) * 255);

export function createGLBMeshMaterialBaker(surface, {THREE, MeshBVH, bvh = null} = {}) {
  if (!bvh) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(surface.vertices, 3));
    geom.setIndex(new THREE.BufferAttribute(surface.triangles, 1));
    bvh = new MeshBVH(geom);
  }
  const V = surface.vertices, F = surface.triangles, U = surface.uvs, C = surface.colors;
  const defaultMat = {baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.8, baseColorImage: null, metallicRoughnessImage: null};
  const point = new THREE.Vector3(), hit = {};

  return ({vertices, triangles, uvs, textureSize = 1024}) => {
    const {faces, bary} = rasterizeTrellisMaterialUV({vertices, triangles, uvs, textureSize});
    const mask = new Uint8Array(faces.length), baseColor = new Uint8Array(faces.length * 4), metallicRoughness = new Uint8Array(faces.length * 4);
    let coveredPixels = 0;
    for (let p = 0; p < faces.length; p++) {
      const face = faces[p];
      if (face < 0) continue;
      mask[p] = 1; coveredPixels++;
      const l0 = triangles[face * 3] * 3, l1 = triangles[face * 3 + 1] * 3, l2 = triangles[face * 3 + 2] * 3;
      const b0 = bary[p * 3], b1 = bary[p * 3 + 1], b2 = bary[p * 3 + 2];
      point.set(
        b0 * vertices[l0] + b1 * vertices[l1] + b2 * vertices[l2],
        b0 * vertices[l0 + 1] + b1 * vertices[l1 + 1] + b2 * vertices[l2 + 1],
        b0 * vertices[l0 + 2] + b1 * vertices[l1 + 2] + b2 * vertices[l2 + 2],
      );
      bvh.closestPointToPoint(point, hit);
      const t = hit.faceIndex, i0 = F[t * 3], i1 = F[t * 3 + 1], i2 = F[t * 3 + 2];
      const a0 = i0 * 3, a1 = i1 * 3, a2 = i2 * 3;
      const v0x = V[a1] - V[a0], v0y = V[a1 + 1] - V[a0 + 1], v0z = V[a1 + 2] - V[a0 + 2];
      const v1x = V[a2] - V[a0], v1y = V[a2 + 1] - V[a0 + 1], v1z = V[a2 + 2] - V[a0 + 2];
      const v2x = hit.point.x - V[a0], v2y = hit.point.y - V[a0 + 1], v2z = hit.point.z - V[a0 + 2];
      const d00 = v0x * v0x + v0y * v0y + v0z * v0z, d01 = v0x * v1x + v0y * v1y + v0z * v1z, d11 = v1x * v1x + v1y * v1y + v1z * v1z;
      const d20 = v2x * v0x + v2y * v0y + v2z * v0z, d21 = v2x * v1x + v2y * v1y + v2z * v1z;
      const denom = d00 * d11 - d01 * d01;
      let w0 = 1, w1 = 0, w2 = 0;
      if (denom > 1e-20) {
        w1 = Math.max(0, (d11 * d20 - d01 * d21) / denom);
        w2 = Math.max(0, (d00 * d21 - d01 * d20) / denom);
        if (w1 + w2 > 1) { const s = 1 / (w1 + w2); w1 *= s; w2 *= s; }
        w0 = 1 - w1 - w2;
      }
      const mat = surface.materials[surface.faceMaterials[t]] ?? defaultMat;
      const hasUV = surface.faceHasUV[t] === 1;
      const u = hasUV ? w0 * U[i0 * 2] + w1 * U[i1 * 2] + w2 * U[i2 * 2] : 0;
      const v = hasUV ? w0 * U[i0 * 2 + 1] + w1 * U[i1 * 2 + 1] + w2 * U[i2 * 2 + 1] : 0;
      const cr = w0 * C[i0 * 4] + w1 * C[i1 * 4] + w2 * C[i2 * 4];
      const cg = w0 * C[i0 * 4 + 1] + w1 * C[i1 * 4 + 1] + w2 * C[i2 * 4 + 1];
      const cb = w0 * C[i0 * 4 + 2] + w1 * C[i1 * 4 + 2] + w2 * C[i2 * 4 + 2];

      const texBase = mat.baseColorImage && hasUV ? sampleBilinear(mat.baseColorImage, u, v) : [255, 255, 255, 255];
      baseColor[p * 4] = bakeSrgbChannel(texBase[0], mat.baseColorFactor[0] * cr);
      baseColor[p * 4 + 1] = bakeSrgbChannel(texBase[1], mat.baseColorFactor[1] * cg);
      baseColor[p * 4 + 2] = bakeSrgbChannel(texBase[2], mat.baseColorFactor[2] * cb);
      baseColor[p * 4 + 3] = 255;

      const texMR = mat.metallicRoughnessImage && hasUV ? sampleBilinear(mat.metallicRoughnessImage, u, v) : [0, 255, 255, 255];
      // Raw-field attributes contain absolute PBR values, just as the loader's
      // material nodes do. Mean glTF factors are only the portable fallback.
      const fields = surface.materialFields, hasField = surface.faceHasMaterialFields?.[t] === 1;
      const metallic = hasField ? 255 * (w0 * fields[i0 * 2] + w1 * fields[i1 * 2] + w2 * fields[i2 * 2]) : texMR[2] * mat.metallicFactor;
      const roughness = hasField ? 255 * (w0 * fields[i0 * 2 + 1] + w1 * fields[i1 * 2 + 1] + w2 * fields[i2 * 2 + 1]) : texMR[1] * mat.roughnessFactor;
      metallicRoughness[p * 4] = 0;
      metallicRoughness[p * 4 + 1] = clampByte(roughness);
      metallicRoughness[p * 4 + 2] = clampByte(metallic);
      metallicRoughness[p * 4 + 3] = 255;
    }
    if (!coveredPixels) throw Error('no covered UV pixels; cannot bake GLB material');
    const seeds = nearestCovered(mask, textureSize);
    for (let p = 0; p < faces.length; p++) if (!mask[p]) {
      const src = seeds[p];
      if (src < 0) throw Error('incomplete texture extension');
      baseColor.set(baseColor.subarray(src * 4, src * 4 + 4), p * 4);
      metallicRoughness.set(metallicRoughness.subarray(src * 4, src * 4 + 4), p * 4);
    }
    return {
      width: textureSize, height: textureSize, baseColor, metallicRoughness, coveredPixels, alphaMode: 'OPAQUE',
      metadata: {
        channels: 'GLB PBR baseColor (RGBA8) and metallicRoughness (G=roughness, B=metallic)',
        sampling: 'BVH closest-point on source GLB + barycentric UV/color + bilinear texture sampling',
        extension: 'Euclidean nearest covered pixel; earlier row/column tie',
      },
    };
  };
}
