// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {bakeTangentNormalMap, addNormalMapToGLB} from '../lod-normal-bake.mjs';
import {readGLBWorldMesh} from '../mesh-lod-ladder.mjs';

const unit = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const degrees = (a, b) => Math.acos(Math.min(1, Math.abs(a[0]*b[0] + a[1]*b[1] + a[2]*b[2]))) * 180 / Math.PI;

// A unit square in the xy plane facing +z. With flipV the texture's v runs down the square (glTF
// images are stored top row first, so image "up" is +y); without it the UVs are mirrored.
const square = ({flipV = true} = {}) => ({
  positions: new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,1,0]),
  normals: new Float32Array([0,0,1, 0,0,1, 0,0,1, 0,0,1]),
  uvs: new Float32Array([0,0, 1,0, 1,1, 0,1].map((v, i) => i % 2 && flipV ? 1 - v : v)),
  indices: new Uint32Array([0,1,2, 0,2,3]),
});
// How three.js (and the glTF spec) rebuild a normal from the map: N, T, B = cross(N,T)*w, then T*x + B*y + N*z.
const decodeAt = (pixels, tangents, p, n, vertex) => {
  const m = [0, 1, 2].map(k => pixels[p * 4 + k] / 255 * 2 - 1), t = [...tangents.subarray(vertex * 4, vertex * 4 + 3)], w = tangents[vertex * 4 + 3];
  const b = cross(n, t).map(x => x * w);
  return unit([0, 1, 2].map(a => t[a] * m[0] + b[a] * m[1] + n[a] * m[2]));
};

test('a baked texel rebuilds the source normal the way glTF viewers decode it', () => {
  const tilt = unit([0.3, -0.2, 1]);
  for (const flipV of [true, false]) {
    const {pixels, tangents, coveredPixels} = bakeTangentNormalMap({...square({flipV}), textureSize: 16, sampleNormal: () => tilt});
    assert.ok(coveredPixels > 200);
    for (let p = 0; p < 256; p++) assert.ok(degrees(decodeAt(pixels, tangents, p, [0, 0, 1], 0), tilt) < 1, `texel ${p} flipV ${flipV}`);
    assert.deepEqual([...tangents.subarray(0, 3)].map(Math.round), [1, 0, 0], 'tangent follows +u');
    assert.equal(tangents[3], flipV ? 1 : -1, 'bitangent sign: texture up (+Y) is toward decreasing v');
  }
});

test('texture green means "toward decreasing v": a normal leaning up the image stores green above half', () => {
  const {pixels} = bakeTangentNormalMap({...square(), textureSize: 8, sampleNormal: () => unit([0, 0.5, 1])});
  assert.ok(pixels[1] > 170 && Math.abs(pixels[0] - 128) <= 1, `rgb ${pixels.slice(0, 3)}`);
});

test('a source normal facing away is turned to the level side, not baked inside out', () => {
  const {pixels} = bakeTangentNormalMap({...square(), textureSize: 4, sampleNormal: () => [0.5, 0, -1]});
  // Reversed, (0.5, 0, -1) is (-0.5, 0, 1): leaning toward -u, so red well below half.
  for (let p = 0; p < 16; p++) assert.ok(pixels[p * 4] < 80 && pixels[p * 4 + 2] > 200, `rgb ${pixels.slice(p * 4, p * 4 + 3)}`);
});

// Builds a GLB: the square under a node rotated -90 deg about X, with NORMAL and TEXCOORD_0.
function squareGLB({extraAttribute = false, withUV = true, matrix = [1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1]} = {}) {
  const s = square(), parts = [s.positions, s.normals, ...(withUV ? [s.uvs] : []), new Uint16Array([0,1,2, 0,2,3])];
  let offset = 0; const bufferViews = [], accessors = [];
  for (const [i, a] of parts.entries()) {
    bufferViews.push({buffer: 0, byteOffset: offset, byteLength: a.byteLength}); offset += Math.ceil(a.byteLength / 4) * 4;
    accessors.push(a instanceof Uint16Array ? {bufferView: i, componentType: 5123, count: 6, type: 'SCALAR'} : {bufferView: i, componentType: 5126, count: 4, type: a === s.uvs ? 'VEC2' : 'VEC3'});
  }
  const attributes = {POSITION: 0, NORMAL: 1, ...(withUV ? {TEXCOORD_0: 2} : {}), ...(extraAttribute ? {TANGENT: 1} : {})};
  const json = {asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}], nodes: [{mesh: 0, matrix}],
    meshes: [{primitives: [{attributes, indices: parts.length - 1, material: 0}]}], materials: [{pbrMetallicRoughness: {}}],
    buffers: [{byteLength: offset}], bufferViews, accessors};
  const bin = new Uint8Array(offset); let at = 0; for (const a of parts) { bin.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), at); at += Math.ceil(a.byteLength / 4) * 4; }
  const text = new TextEncoder().encode(JSON.stringify(json)), tl = Math.ceil(text.length / 4) * 4;
  const out = new Uint8Array(28 + tl + offset), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true); dv.setUint32(12, tl, true); dv.setUint32(16, 0x4e4f534a, true);
  out.fill(32, 20, 20 + tl); out.set(text, 20); dv.setUint32(20 + tl, offset, true); dv.setUint32(24 + tl, 0x004e4942, true); out.set(bin, 28 + tl);
  return out.buffer;
}
const parse = glb => { const dv = new DataView(glb), tl = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, tl))), bin = 28 + tl;
  const view = i => { const bv = json.bufferViews[i]; return new Uint8Array(glb.slice(bin + (bv.byteOffset || 0), bin + (bv.byteOffset || 0) + bv.byteLength)); };
  const floats = i => new Float32Array(view(json.accessors[i].bufferView).buffer);
  return {json, view, floats}; };
const decodePNG = bytes => { const dv = new DataView(bytes.buffer, bytes.byteOffset); let p = 8, width, idat = [];
  while (p < bytes.length) { const len = dv.getUint32(p), type = new TextDecoder().decode(bytes.subarray(p + 4, p + 8));
    if (type === 'IHDR') width = dv.getUint32(p + 8); if (type === 'IDAT') idat.push(bytes.subarray(p + 8, p + 8 + len)); p += len + 12; }
  const raw = zlib.inflateSync(Buffer.concat(idat)), rows = raw.length / (width * 4 + 1), px = new Uint8Array(width * rows * 4);
  for (let y = 0; y < rows; y++) { assert.equal(raw[y * (width * 4 + 1)], 0); px.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4); }
  return {width, pixels: px}; };

test('a GLB gains a normal map and tangents that rebuild the world-space source normal through its node transform', async () => {
  const world = unit([0.2, 1, 0.3]); // the square faces +y in world after the node's -90 deg about X
  const seen = [];
  const out = await addNormalMapToGLB(squareGLB(), {textureSize: 8, source: {kind: 'hero', sha256: 'f'.repeat(64)},
    sampleWorldNormal: (p, n) => { seen.push([p, n]); return world; }});
  const {json, view, floats} = parse(out), prim = json.meshes[0].primitives[0];
  assert.equal(json.materials[0].normalTexture.index, json.textures.length - 1);
  assert.equal(json.extras.lodNormalMap.source.kind, 'hero');
  assert.equal(json.extras.lodNormalMap.textureSize, 8);
  // Sample points arrive in world space: the square's y becomes -z, its normal +y.
  assert.ok(seen.every(([p, n]) => Math.abs(p[1]) < 1e-6 && p[2] <= 1e-6 && Math.abs(n[1] - 1) < 1e-6));
  const tangents = floats(prim.attributes.TANGENT), {pixels} = decodePNG(view(json.images[json.textures.at(-1).source].bufferView));
  const local = decodeAt(pixels, tangents, 9, [0, 0, 1], 0), toWorld = ([x, y, z]) => [x, z, -y];
  assert.ok(degrees(toWorld(local), world) < 1, `${toWorld(local)} vs ${world}`);
  // Everything that was there is still there.
  assert.deepEqual(Object.keys(prim.attributes).sort(), ['NORMAL', 'POSITION', 'TANGENT', 'TEXCOORD_0']);
  assert.deepEqual([...readGLBWorldMesh(out).faces], [0, 1, 2, 0, 2, 3]);
});

test('identical inputs give identical bytes', async () => {
  const opts = {textureSize: 8, source: {kind: 'hero'}, sampleWorldNormal: () => [0, 1, 0]};
  assert.deepEqual(new Uint8Array(await addNormalMapToGLB(squareGLB(), opts)), new Uint8Array(await addNormalMapToGLB(squareGLB(), opts)));
});

test('a mesh without UVs, or that already has tangents, is refused', async () => {
  const opts = {textureSize: 8, source: {}, sampleWorldNormal: () => [0, 1, 0]};
  await assert.rejects(addNormalMapToGLB(squareGLB({withUV: false}), opts), /TEXCOORD_0/);
  await assert.rejects(addNormalMapToGLB(squareGLB({extraAttribute: true}), opts), /TANGENT/);
});

test('review M2: a node transform that is not rotation and uniform scale is refused, not baked wrong', async () => {
  const opts = {textureSize: 8, source: {}, sampleWorldNormal: () => [0, 1, 0]};
  await assert.rejects(addNormalMapToGLB(squareGLB({matrix: [2,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]}), opts), /uniform scale/);
  await assert.rejects(addNormalMapToGLB(squareGLB({matrix: [1,0,0,0, 0.5,1,0,0, 0,0,1,0, 0,0,0,1]}), opts), /uniform scale/);
  // Confirmation review: a mirror keeps lengths and right angles but reverses the frame.
  await assert.rejects(addNormalMapToGLB(squareGLB({matrix: [-1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]}), opts), /mirror/);
  // Rotation with uniform scale and translation is fine.
  const out = await addNormalMapToGLB(squareGLB({matrix: [2,0,0,0, 0,0,-2,0, 0,2,0,0, 5,6,7,1]}), opts);
  assert.ok(parse(out).json.materials[0].normalTexture);
});

test('world normals come back with the world mesh, through the node transform', () => {
  const {normals} = readGLBWorldMesh(squareGLB());
  for (let i = 0; i < 4; i++) assert.deepEqual([...normals.subarray(i * 3, i * 3 + 3)].map(v => Math.round(v) + 0), [0, 1, 0]);
});

test('hero sampler looks along the level normal: a nearby strand does not stand in for the body behind it', async () => {
  const THREE = await import('three'), {MeshBVH} = await import('three-mesh-bvh'), {createHeroNormalSampler} = await import('../lod-normal-bake.mjs');
  // Body: a large plane at z = 0 facing +z. Strand: a thin vertical sheet at x = 0.003 facing +x.
  const vertices = new Float32Array([-1,-1,0, 1,-1,0, 1,1,0, -1,1,0,  0.003,-0.01,-0.01, 0.003,0.01,-0.01, 0.003,0,0.05]);
  const faces = new Uint32Array([0,1,2, 0,2,3, 4,5,6]);
  const normals = new Float32Array([0,0,1, 0,0,1, 0,0,1, 0,0,1, 1,0,0, 1,0,0, 1,0,0]);
  const sample = createHeroNormalSampler({hero: {vertices, faces, normals}, THREE, MeshBVH, reach: 0.02});
  const n = sample([0, 0, 0.004], [0, 0, 1]); // the strand is 3 mm away, the body 4 mm below
  assert.ok(n[2] > 0.99, `body normal expected, got ${n}`);
  assert.equal(sample.method, 'ray along the level normal within reach (both ways, nearest hit), else closest point; interpolated shading normal');
  // Out of reach along the normal: falls back to the closest point (here the strand).
  const far = createHeroNormalSampler({hero: {vertices, faces, normals}, THREE, MeshBVH, reach: 0.001})([0, 0, 0.004], [0, 0, 1]);
  assert.ok(far[0] > 0.99, `closest-point fallback expected, got ${far}`);
});

test('the bake tells the sampler how large a texel is on the surface', () => {
  const sizes = [];
  const {texelSize} = bakeTangentNormalMap({...square(), textureSize: 16, sampleNormal: (p, n, size) => { sizes.push(size); return n; }});
  // The unit square fills the whole 16x16 atlas: one texel is 1/16 across.
  assert.ok(Math.abs(texelSize - 1 / 16) < 1e-3, `${texelSize}`);
  assert.ok(sizes.length > 200 && sizes.every(s => s === texelSize));
});

test('with a footprint the hero sampler averages detail finer than a texel instead of picking one strand', async () => {
  const THREE = await import('three'), {MeshBVH} = await import('three-mesh-bvh'), {createHeroNormalSampler} = await import('../lod-normal-bake.mjs');
  // Two half-planes at z = 0 meeting at x = 0, shaded leaning -x on the left and +x on the right.
  const l = [-0.6, 0, 0.8], r = [0.6, 0, 0.8];
  const vertices = new Float32Array([-1,-1,0, 0,-1,0, 0,1,0, -1,1,0,  0,-1,0, 1,-1,0, 1,1,0, 0,1,0]);
  const faces = new Uint32Array([0,1,2, 0,2,3, 4,5,6, 4,6,7]);
  const normals = new Float32Array([...l, ...l, ...l, ...l, ...r, ...r, ...r, ...r]);
  const hero = {vertices, faces, normals}, at = [0.0001, 0, 0.001], up = [0, 0, 1];
  const single = createHeroNormalSampler({hero, THREE, MeshBVH, reach: 0.01})(at, up, 0.1);
  const footprint = createHeroNormalSampler({hero, THREE, MeshBVH, reach: 0.01, footprint: true});
  const averaged = footprint(at, up, 0.1), unitOf = v => { const s = Math.hypot(...v); return v.map(x => x / s); };
  assert.ok(single[0] > 0.5, `one sample takes one side: ${single}`);
  // The point sits just right of the seam: 6 of 9 grid samples land right, 3 left, so the average
  // leans (6-3)/9 of the way: far less than one sample's full lean.
  assert.ok(Math.abs(unitOf(averaged)[0] - 0.243) < 0.01, `the average sees both sides in proportion: ${unitOf(averaged)}`);
  assert.match(footprint.method, /averaged over the texel footprint/);
});
