export function solidFieldIndex(grid, x, y, z) {
  return x + grid * (y + 2 * grid * z);
}

export function assertEffectiveSceneCollision(receipt, expectedSourceId) {
  const requireCondition = (condition, message) => { if (!condition) throw new Error(message); };
  requireCondition(receipt?.requested === true, 'scene collision was not requested');
  requireCondition(receipt?.effective === 'mesh-voxel-solid', 'authored mesh collision is not effective');
  requireCondition(receipt?.sourceId === expectedSourceId, 'scene collision source identity mismatch');
  requireCondition(typeof receipt?.geometryRevision === 'string' && receipt.geometryRevision.length > 0,
    'scene collision geometry/transform revision missing');
  requireCondition(receipt?.triangleCount > 0 && receipt?.solidCellCount > 0 && receipt?.blockedFaceCount > 0,
    'authored scene collider has no occupied and blocking geometry');
  requireCondition(receipt?.sourceSupport?.fluidSupportCells > 0,
    'actual emitter signed-distance support is fully occluded');
  return receipt;
}

// Mirror the emitter shader's signed-distance chemistry gate at cell centers.
// The dispatch box alone is deliberately wider than the actual fuel source.
export function countEmitterChemicalSupport(descriptor, dispatch, solidCells, grid) {
  if (!dispatch?.active || !descriptor || !(solidCells instanceof Uint8Array)
    || solidCells.length !== 2 * grid * grid * grid) {
    return {boundsFluidCells: 0, sourceSupportCells: 0, fluidSupportCells: 0, solidSupportCells: 0};
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const mul = (a, scalar) => a.map(v => v * scalar);
  const length = a => Math.hypot(...a);
  const axis = descriptor.axis;
  const origin = descriptor.origin;
  const radius = descriptor.radius;
  const extent = descriptor.extent;
  const sourceDepth = descriptor.sourceDepth;
  const secondary = [
    axis[1] * descriptor.supportAxis[2] - axis[2] * descriptor.supportAxis[1],
    axis[2] * descriptor.supportAxis[0] - axis[0] * descriptor.supportAxis[2],
    axis[0] * descriptor.supportAxis[1] - axis[1] * descriptor.supportAxis[0],
  ];
  const boxDistance = dimensions => length(dimensions.map(v => Math.max(v, 0)))
    + Math.min(Math.max(...dimensions), 0);
  let boundsFluidCells = 0;
  let sourceSupportCells = 0;
  let fluidSupportCells = 0;
  let solidSupportCells = 0;
  for (let z = dispatch.cellMin[2]; z < dispatch.cellMin[2] + dispatch.cellExtent[2]; z++) {
    for (let y = dispatch.cellMin[1]; y < dispatch.cellMin[1] + dispatch.cellExtent[1]; y++) {
      for (let x = dispatch.cellMin[0]; x < dispatch.cellMin[0] + dispatch.cellExtent[0]; x++) {
        const solid = solidCells[solidFieldIndex(grid, x, y, z)] !== 0;
        if (!solid) boundsFluidCells++;
        const p = [(x + .5) * 2 / grid - 1, (y + .5) * 2 / grid - 1, (z + .5) * 2 / grid - 1];
        const relative = sub(p, origin);
        const axial = dot(relative, axis);
        const planar = sub(relative, mul(axis, axial));
        let geometryDistance;
        switch (descriptor.family) {
          case 'ring':
            geometryDistance = Math.hypot(length(planar) - extent, axial) - radius;
            break;
          case 'ribbon':
            geometryDistance = boxDistance([
              Math.abs(dot(relative, descriptor.supportAxis)) - extent * .5,
              Math.abs(axial) - radius * .42,
              Math.abs(dot(relative, secondary)) - radius,
            ]);
            break;
          case 'nozzle': {
            const centeredAxial = axial - extent * .5;
            geometryDistance = boxDistance([length(sub(relative, mul(axis, axial))) - radius,
              Math.abs(centeredAxial) - extent * .5]);
            break;
          }
          case 'wick': {
            const t = Math.max(0, Math.min(1, (axial + extent * .5) / extent));
            geometryDistance = length(sub(relative, mul(axis, -extent * .5 + t * extent))) - radius;
            break;
          }
          default:
            throw new Error(`unsupported emitter support family: ${descriptor.family}`);
        }
        const inletDistance = descriptor.family === 'nozzle'
          ? Math.max(-axial, axial - sourceDepth)
          : Math.abs(axial) - sourceDepth * .5;
        const sourceDistance = descriptor.sourceLaw === 'shallow-primary'
          ? Math.max(geometryDistance, inletDistance) : geometryDistance;
        // shader: 1 - smoothstep(-0.5 * cellWidth, 0.5 * cellWidth, sourceDistance)
        if (!(sourceDistance < 1 / grid) || !(descriptor.strength > 0)) continue;
        sourceSupportCells++;
        if (solid) solidSupportCells++;
        else fluidSupportCells++;
      }
    }
  }
  return {boundsFluidCells, sourceSupportCells, fluidSupportCells, solidSupportCells};
}

function visibleInScene(object) {
  for (let current = object; current; current = current.parent) {
    if (current.visible === false) return false;
  }
  return true;
}

export function sceneSolidRevision(object, productTransform = {translate: [0, 0, 0], scale: 1}) {
  if (!object?.traverse || !object?.updateWorldMatrix) throw new Error('scene solid requires a scene object');
  object.updateWorldMatrix(true, true);
  const parts = [];
  object.traverse(mesh => {
    if (!mesh.isMesh || !visibleInScene(mesh)) return;
    const position = mesh.geometry?.getAttribute?.('position');
    parts.push([mesh.geometry?.uuid, position?.count, position?.version ?? 0,
      mesh.geometry?.getIndex?.()?.version ?? 0, ...Array.from(mesh.matrixWorld?.elements || [])].join(','));
  });
  if (!parts.length) throw new Error('scene solid object has no visible mesh triangles');
  return `${parts.join('|')}@${productTransform.translate.join(',')}/${productTransform.scale}`;
}

export function packSolidTextureRows(cells, grid) {
  if (!(cells instanceof Uint8Array) || cells.length !== 2 * grid * grid * grid) {
    throw new Error('scene solid field dimensions mismatch');
  }
  const bytesPerRow = Math.ceil(grid / 256) * 256;
  const height = 2 * grid;
  const packed = new Uint8Array(bytesPerRow * height * grid);
  for (let z = 0; z < grid; z++) for (let y = 0; y < height; y++) {
    const source = solidFieldIndex(grid, 0, y, z);
    const target = bytesPerRow * (y + height * z);
    packed.set(cells.subarray(source, source + grid), target);
  }
  return {data: packed, bytesPerRow, rowsPerImage: height};
}

export function trianglesFromSceneObject(object, productTransform = { translate: [0, 0, 0], scale: 1 }) {
  if (!object?.traverse || !object?.updateWorldMatrix) throw new Error('scene solid requires a scene object');
  const scale = Number(productTransform.scale);
  const translate = productTransform.translate;
  if (!Number.isFinite(scale) || scale <= 0 || !Array.isArray(translate)
    || translate.length !== 3 || !translate.every(Number.isFinite)) {
    throw new Error('scene solid requires a finite invertible volume transform');
  }
  object.updateWorldMatrix(true, true);
  const triangles = [];
  object.traverse(mesh => {
    if (!mesh.isMesh || !visibleInScene(mesh)) return;
    const geometry = mesh.geometry;
    const position = geometry?.getAttribute?.('position');
    if (!position || position.count < 3) throw new Error('scene solid mesh lacks position triangles');
    const matrix = mesh.matrixWorld?.elements;
    if (!matrix || matrix.length !== 16 || !Array.from(matrix).every(Number.isFinite)) {
      throw new Error('scene solid mesh has an invalid world transform');
    }
    const index = geometry.getIndex?.();
    const count = index?.count ?? position.count;
    if (count % 3 !== 0) throw new Error('scene solid mesh triangle index count is incomplete');
    const vertex = i => {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
      if (!Number.isFinite(w) || Math.abs(w) < 1e-12) throw new Error('scene solid mesh has an invalid homogeneous transform');
      return [
        ((matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w - translate[0]) / scale,
        ((matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w - translate[1]) / scale,
        ((matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w - translate[2]) / scale,
      ];
    };
    for (let i = 0; i < count; i += 3) {
      triangles.push([vertex(index ? index.getX(i) : i), vertex(index ? index.getX(i + 1) : i + 1), vertex(index ? index.getX(i + 2) : i + 2)]);
    }
  });
  if (triangles.length === 0) throw new Error('scene solid object has no visible mesh triangles');
  return { triangles, revision: sceneSolidRevision(object, productTransform) };
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function triangleTouchesCell(a, b, c, x, y, z) {
  const center = [x + .5, y + .5, z + .5];
  const p = [a, b, c].map(v => [v[0] - center[0], v[1] - center[1], v[2] - center[2]]);
  const edges = [
    [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]],
    [p[2][0] - p[1][0], p[2][1] - p[1][1], p[2][2] - p[1][2]],
    [p[0][0] - p[2][0], p[0][1] - p[2][1], p[0][2] - p[2][2]],
  ];
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1], cross(edges[0], edges[1])];
  for (const edge of edges) {
    axes.push([0, -edge[2], edge[1]], [edge[2], 0, -edge[0]], [-edge[1], edge[0], 0]);
  }
  for (const axis of axes) {
    const radius = .5 * (Math.abs(axis[0]) + Math.abs(axis[1]) + Math.abs(axis[2]));
    const projections = p.map(point => dot(axis, point));
    if (Math.min(...projections) > radius + 1e-7 || Math.max(...projections) < -radius - 1e-7) return false;
  }
  return true;
}

function gridPoint(point, grid) {
  if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite)) {
    throw new Error('scene solid triangle has a nonfinite vertex');
  }
  return [(point[0] + 1) * grid / 2, (point[1] + 1) * grid / 2, (point[2] + 1) * grid / 2];
}

/** Conservative triangle-shell rasterization, followed by an exterior flood fill.
 * Coordinates are volume-local: x/z [-1,1], y [-1,3]. Open meshes retain only
 * their surface voxels; an aperture is not replaced by a bounding solid.
 */
export function voxelizeTriangleSolid(triangles, grid) {
  if (!Number.isInteger(grid) || grid < 2) throw new Error('scene solid grid must be an integer >= 2');
  if (!Array.isArray(triangles) || triangles.length === 0) throw new Error('scene solid requires triangles');
  const height = grid * 2;
  const cells = new Uint8Array(grid * height * grid);
  let surfaceCellCount = 0;
  for (const triangle of triangles) {
    if (!Array.isArray(triangle) || triangle.length !== 3) throw new Error('scene solid requires triangular faces');
    const [a, b, c] = triangle.map(point => gridPoint(point, grid));
    const lo = [0, 1, 2].map(i => Math.max(0, Math.floor(Math.min(a[i], b[i], c[i]) - 1e-7)));
    const hi = [0, 1, 2].map(i => Math.min(i === 1 ? height - 1 : grid - 1, Math.floor(Math.max(a[i], b[i], c[i]) + 1e-7)));
    for (let z = lo[2]; z <= hi[2]; z++) {
      for (let y = lo[1]; y <= hi[1]; y++) {
        for (let x = lo[0]; x <= hi[0]; x++) {
          if (!triangleTouchesCell(a, b, c, x, y, z)) continue;
          const index = solidFieldIndex(grid, x, y, z);
          if (cells[index]) continue;
          cells[index] = 1;
          surfaceCellCount++;
        }
      }
    }
  }
  // Flood only cells connected to the simulation-domain exterior. This fills
  // truly enclosed mesh interiors while preserving an open kiln chamber/flue.
  const exterior = new Uint8Array(cells.length);
  const queue = new Uint32Array(cells.length);
  let head = 0;
  let tail = 0;
  const enqueue = index => {
    if (cells[index] || exterior[index]) return;
    exterior[index] = 1;
    queue[tail++] = index;
  };
  for (let z = 0; z < grid; z++) for (let y = 0; y < height; y++) {
    enqueue(solidFieldIndex(grid, 0, y, z));
    enqueue(solidFieldIndex(grid, grid - 1, y, z));
  }
  for (let z = 0; z < grid; z++) for (let x = 0; x < grid; x++) {
    enqueue(solidFieldIndex(grid, x, 0, z));
    enqueue(solidFieldIndex(grid, x, height - 1, z));
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < grid; x++) {
    enqueue(solidFieldIndex(grid, x, y, 0));
    enqueue(solidFieldIndex(grid, x, y, grid - 1));
  }
  const plane = grid * height;
  while (head < tail) {
    const index = queue[head++];
    const z = Math.floor(index / plane);
    const y = Math.floor((index - z * plane) / grid);
    const x = index % grid;
    if (x > 0) enqueue(index - 1);
    if (x + 1 < grid) enqueue(index + 1);
    if (y > 0) enqueue(index - grid);
    if (y + 1 < height) enqueue(index + grid);
    if (z > 0) enqueue(index - plane);
    if (z + 1 < grid) enqueue(index + plane);
  }
  let interiorCellCount = 0;
  let blockedFaceCount = 0;
  for (let z = 0; z < grid; z++) for (let y = 0; y < height; y++) for (let x = 0; x < grid; x++) {
    const index = solidFieldIndex(grid, x, y, z);
    if (!cells[index] && !exterior[index]) {
      cells[index] = 1;
      interiorCellCount++;
    }
    if (!cells[index]) continue;
    if (x + 1 < grid && !cells[index + 1]) blockedFaceCount++;
    if (x > 0 && !cells[index - 1]) blockedFaceCount++;
    if (y + 1 < height && !cells[index + grid]) blockedFaceCount++;
    if (y > 0 && !cells[index - grid]) blockedFaceCount++;
    if (z + 1 < grid && !cells[index + plane]) blockedFaceCount++;
    if (z > 0 && !cells[index - plane]) blockedFaceCount++;
  }
  return { cells, surfaceCellCount, interiorCellCount, blockedFaceCount };
}
