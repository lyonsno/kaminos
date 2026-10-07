import fs from 'node:fs';
import { createHash } from 'node:crypto';
import Module from 'manifold-3d';
import path from 'node:path';
import { readArchGlbTriangles } from './structural-material-arch-profile.mjs';

const wasm = await Module();
wasm.setup();
const { Manifold, Mesh } = wasm;
export const STONE_PREPARATION_ROUTE = 'kaminos.imported-solid.grid-intersection.manifold-3.5.4.v0';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function prepareStoneFromGlb(bytes, { size, cellSize } = {}) {
  const extracted = readArchGlbTriangles(bytes);
  if (!Array.isArray(size) || size.length !== 3 || !size.every(n => Number.isFinite(n) && n > 0) || !(cellSize > 0) || !Number.isFinite(cellSize)) throw new Error('Positive specimen dimensions and physical cell size required');
  const jsonLength = bytes.readUInt32LE(12), gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const binaryStart = 28 + jsonLength, primitive = gltf.meshes[0].primitives[0];
  const read = (name, count) => {
    const accessor = gltf.accessors[primitive.attributes[name]], view = gltf.bufferViews[accessor?.bufferView];
    if (!accessor || accessor.componentType !== 5126 || accessor.sparse || accessor.count !== gltf.accessors[primitive.attributes.POSITION].count || !view || view.buffer !== 0 || view.byteStride && view.byteStride !== count * 4) throw new Error(`Unsupported ${name} attribute`);
    const start = binaryStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    if (start + accessor.count * count * 4 > binaryStart + (view.byteOffset ?? 0) + view.byteLength) throw new Error(`${name} exceeds buffer view`);
    return Array.from({ length: accessor.count }, (_, i) => Array.from({ length: count }, (_, j) => bytes.readFloatLE(start + (i * count + j) * 4)));
  };
  const positions = read('POSITION', 3), normals = read('NORMAL', 3), uvs = read('TEXCOORD_0', 2), tangents = read('TANGENT', 4);
  const bounds = extracted.bounds3d, scale = size.map((v, a) => v / (bounds.max[a] - bounds.min[a]));
  const center = bounds.min.map((v, a) => (v + bounds.max[a]) / 2);
  const normalize = vector => { const n = Math.hypot(...vector); if (!(n > 0)) throw new Error('Degenerate normal/tangent'); return vector.map(v => v / n); };
  const properties = new Float32Array(positions.length * 12);
  positions.forEach((p, i) => properties.set([
    ...p.map((v, a) => (v - center[a]) * scale[a]),
    ...normalize(normals[i].map((v, a) => v / scale[a])), ...uvs[i],
    ...normalize(tangents[i].slice(0, 3).map((v, a) => v * scale[a])), tangents[i][3],
  ], i * 12));
  const accessor = gltf.accessors[primitive.indices], view = gltf.bufferViews[accessor.bufferView];
  const indexStart = binaryStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), indexBytes = accessor.componentType === 5123 ? 2 : 4;
  const indices = Uint32Array.from({ length: accessor.count }, (_, i) => indexBytes === 2 ? bytes.readUInt16LE(indexStart + i * 2) : bytes.readUInt32LE(indexStart + i * 4));
  const sourceId = Manifold.reserveIDs(1);
  const input = new Mesh({ numProp: 12, vertProperties: properties, triVerts: indices, runIndex: new Uint32Array([0, indices.length]), runOriginalID: new Uint32Array([sourceId]) });
  input.merge();
  const owned = new Set();
  const own = value => { owned.add(value); return value; };
  const discard = value => { value.delete(); owned.delete(value); };
  try {
    const solid = own(new Manifold(input));
    if (!(solid.volume() > 0)) throw new Error('Imported source must admit a positive oriented solid');
    const grid = size.map(s => Math.ceil(s / cellSize)), spacing = size.map((s, a) => s / grid[a]);
    const cells = [], byGrid = new Map();
    for (let z = 0; z < grid[2]; z++) for (let y = 0; y < grid[1]; y++) for (let x = 0; x < grid[0]; x++) {
      const coordinates = [x, y, z], min = coordinates.map((v, a) => -size[a] / 2 + v * spacing[a]);
      const max = min.map((v, a) => v + spacing[a]), position = min.map((v, a) => (v + max[a]) / 2);
      // Keep outer cutting planes outside the source so coplanar source faces retain their material lineage.
      const padding = cellSize * 1e-4, clipMin = min.map((v, a) => v - (coordinates[a] === 0 ? padding : 0));
      const clipSize = spacing.map((v, a) => v + (coordinates[a] === 0 ? padding : 0) + (coordinates[a] === grid[a]-1 ? padding : 0));
      const base = own(Manifold.cube(clipSize)), box = own(base.translate(clipMin)); discard(base);
      const piece = own(solid.intersect(box));
      const volume = piece.volume();
      if (!piece.isEmpty()) {
        if (!(volume > 0)) throw new Error('Nonempty cut region has nonpositive volume');
        const mesh = piece.getMesh(), original = [];
        for (let run = 0; run < mesh.runOriginalID.length; run++) for (let j = mesh.runIndex[run] / 3; j < mesh.runIndex[run + 1] / 3; j++) original[j] = mesh.runOriginalID[run] === sourceId;
        const cell = { index: cells.length, id: `volume:${x}:${y}:${z}`, column: x, row: y, layer: z, position, min, max, volume,
          geometry: { numProp: mesh.numProp, properties: Array.from(mesh.vertProperties), indices: Array.from(mesh.triVerts), exterior: original } };
        cells.push(cell); byGrid.set(coordinates.join(':'), cell.index);
      }
      discard(piece); discard(box);
    }
    const section = (cell, axis, plane) => {
      const { geometry: m } = cell; let area = 0, moment = [0, 0, 0];
      for (let j = 0; j < m.indices.length; j += 3) {
        const points = m.indices.slice(j, j + 3).map(i => m.properties.slice(i * m.numProp, i * m.numProp + 3));
        if (!points.every(p => Math.abs(p[axis] - plane) < cellSize * 1e-5)) continue;
        const u = points[1].map((v, a) => v - points[0][a]), v = points[2].map((v, a) => v - points[0][a]);
        const a = Math.hypot(u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]) / 2;
        area += a; moment = moment.map((value, axis) => value + a * points.reduce((s, p) => s + p[axis], 0) / 3);
      }
      return { area, center: moment.map(v => v / area) };
    };
    const bonds = [];
    for (const cell of cells) for (let axis = 0; axis < 3; axis++) {
      const neighbor = [cell.column, cell.row, cell.layer]; neighbor[axis]++;
      const b = byGrid.get(neighbor.join(':')); if (b === undefined) continue;
      const aSection = section(cell, axis, cell.max[axis]), bSection = section(cells[b], axis, cell.max[axis]);
      const area = (aSection.area + bSection.area) / 2;
      if (Math.abs(aSection.area - bSection.area) > spacing[(axis+1)%3] * spacing[(axis+2)%3] * 1e-4) throw new Error('Cut interface areas disagree');
      if (!(area > 0)) continue;
      const midpoint = aSection.center.map((v, a) => (v + bSection.center[a]) / 2), normal = [0, 0, 0]; normal[axis] = 1;
      bonds.push({ id: `interface:${bonds.length}`, a: cell.index, b, area, normal, anchorA: midpoint.map((v, a) => v-cell.position[a]), anchorB: midpoint.map((v, a) => v-cells[b].position[a]) });
    }
    const totalVolume = cells.reduce((s, c) => s + c.volume, 0), volume = solid.volume();
    if (Math.abs(totalVolume - volume) > volume * 1e-5) throw new Error('Partition does not conserve imported solid volume');
    for (const cell of cells) {
      const m = cell.geometry; m.interfaces = m.exterior.map((exterior, tri) => {
        if (exterior) return null;
        const points = m.indices.slice(tri*3, tri*3+3).map(i => m.properties.slice(i*m.numProp, i*m.numProp+3));
        const bond = bonds.find(b => (b.a === cell.index || b.b === cell.index) && points.every(p => {
          const axis = b.normal.findIndex(n => n !== 0), anchor = b.a === cell.index ? b.anchorA : b.anchorB;
          return Math.abs(p[axis] - cell.position[axis] - anchor[axis]) < cellSize * 1e-5;
        }));
        if (!bond) throw new Error('Prepared cap lacks a material interface');
        return bond.id;
      });
    }
    return { schema: STONE_PREPARATION_ROUTE, sourceSha256: hash(bytes), sourceTriangles: indices.length / 3, size, requestedCellSize: cellSize, spacing, grid,
      volume, totalVolume, seamMerges: input.mergeFromVert.length, cells, bonds,
      claim: 'homogeneous coarse cohesive cut volumes; box inertia/collision approximation; no hidden construction inference' };
  } finally { for (const value of owned) value.delete(); }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('usage: node structural-material-stone-prepare.mjs SOURCE.glb OUTPUT.json');
  const report = { status: 'running', route: STONE_PREPARATION_ROUTE, input, output, lastTrustworthyEvidence: 'invocation' };
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  try {
    const bytes = fs.readFileSync(input); report.sourceSha256 = hash(bytes); report.lastTrustworthyEvidence = 'source bytes';
    report.specimens = [.3, .6].map(thickness => prepareStoneFromGlb(bytes, { size: [2.4, thickness, .6], cellSize: .3 }));
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
  fs.writeFileSync(output, JSON.stringify(report));
  console.log(JSON.stringify({ status: report.status, output, specimens: report.specimens?.map(s => ({ size: s.size, volume: s.volume, cells: s.cells.length, bonds: s.bonds.length })), error: report.error?.message }));
}
