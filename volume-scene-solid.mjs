export function solidFieldIndex(grid, x, y, z, height = 2 * grid) {
  return x + grid * (y + height * z);
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
export function countEmitterChemicalSupport(descriptor, dispatch, solidCells, grid, height = 2 * grid, onSupport = null) {
  if (!dispatch?.active || !descriptor || !(solidCells instanceof Uint8Array)
    || solidCells.length !== grid * height * grid) {
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
        const solid = solidCells[solidFieldIndex(grid, x, y, z, height)] !== 0;
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
        onSupport?.(solidFieldIndex(grid,x,y,z,height));
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
    if (current.userData?.kaminosBeautyLodProxy || current.userData?.kaminosEditorOnly || current.userData?.kaminosEditorHelper) return false;
  }
  return true;
}

const solidAttributeIds = new WeakMap();
let nextSolidAttributeId = 1;
function solidAttributeRevision(attribute) {
  if (!attribute) return 'none';
  if (!solidAttributeIds.has(attribute)) solidAttributeIds.set(attribute, nextSolidAttributeId++);
  const buffer = attribute.isInterleavedBufferAttribute ? attribute.data : attribute;
  if (!solidAttributeIds.has(buffer)) solidAttributeIds.set(buffer, nextSolidAttributeId++);
  return [solidAttributeIds.get(attribute), solidAttributeIds.get(buffer),
    attribute.count, buffer.version ?? 0].join('/');
}

export function sceneSolidRevision(object, productTransform = {translate: [0, 0, 0], scale: 1}) {
  if (!object?.traverse || !object?.updateWorldMatrix) throw new Error('scene solid requires a scene object');
  object.updateWorldMatrix(true, true);
  const parts = [];
  object.traverse(mesh => {
    if (!mesh.isMesh || !visibleInScene(mesh)) return;
    const position = mesh.geometry?.getAttribute?.('position');
    parts.push([mesh.geometry?.uuid, solidAttributeRevision(position),
      solidAttributeRevision(mesh.geometry?.getIndex?.()), ...Array.from(mesh.matrixWorld?.elements || [])].join(','));
  });
  if (!parts.length) throw new Error('scene solid object has no visible mesh triangles');
  return `${parts.join('|')}@${productTransform.translate.join(',')}/${productTransform.scale}`;
}

export function packSolidTextureRows(cells, grid, height = 2 * grid) {
  if (!(cells instanceof Uint8Array) || cells.length !== grid * height * grid) {
    throw new Error('scene solid field dimensions mismatch');
  }
  const bytesPerRow = Math.ceil(grid / 256) * 256;
  const packed = new Uint8Array(bytesPerRow * height * grid);
  for (let z = 0; z < grid; z++) for (let y = 0; y < height; y++) {
    const source = solidFieldIndex(grid, 0, y, z, height);
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

function checkEdgeAxes(ex, ey, ez, px0, py0, pz0, px1, py1, pz1, px2, py2, pz2) {
  let r, d0, d1, d2;
  r = .5 * (Math.abs(ez) + Math.abs(ey)) + 1e-7;
  d0 = -ez * py0 + ey * pz0; d1 = -ez * py1 + ey * pz1; d2 = -ez * py2 + ey * pz2;
  if (Math.min(d0, d1, d2) > r || Math.max(d0, d1, d2) < -r) return false;
  r = .5 * (Math.abs(ez) + Math.abs(ex)) + 1e-7;
  d0 = ez * px0 - ex * pz0; d1 = ez * px1 - ex * pz1; d2 = ez * px2 - ex * pz2;
  if (Math.min(d0, d1, d2) > r || Math.max(d0, d1, d2) < -r) return false;
  r = .5 * (Math.abs(ey) + Math.abs(ex)) + 1e-7;
  d0 = -ey * px0 + ex * py0; d1 = -ey * px1 + ex * py1; d2 = -ey * px2 + ex * py2;
  if (Math.min(d0, d1, d2) > r || Math.max(d0, d1, d2) < -r) return false;
  return true;
}

function triangleTouchesCell(ax, ay, az, bx, by, bz, cx, cy, cz, e0x, e0y, e0z, e1x, e1y, e1z, e2x, e2y, e2z, nx, ny, nz, nr, x, y, z) {
  const px0 = ax - (x + .5), py0 = ay - (y + .5), pz0 = az - (z + .5);
  const px1 = bx - (x + .5), py1 = by - (y + .5), pz1 = bz - (z + .5);
  const px2 = cx - (x + .5), py2 = cy - (y + .5), pz2 = cz - (z + .5);
  const lim = .5 + 1e-7;
  if (Math.min(px0, px1, px2) > lim || Math.max(px0, px1, px2) < -lim) return false;
  if (Math.min(py0, py1, py2) > lim || Math.max(py0, py1, py2) < -lim) return false;
  if (Math.min(pz0, pz1, pz2) > lim || Math.max(pz0, pz1, pz2) < -lim) return false;
  const dn = nx * px0 + ny * py0 + nz * pz0;
  if (dn > nr + 1e-7 || dn < -nr - 1e-7) return false;
  return checkEdgeAxes(e0x, e0y, e0z, px0, py0, pz0, px1, py1, pz1, px2, py2, pz2)
    && checkEdgeAxes(e1x, e1y, e1z, px0, py0, pz0, px1, py1, pz1, px2, py2, pz2)
    && checkEdgeAxes(e2x, e2y, e2z, px0, py0, pz0, px1, py1, pz1, px2, py2, pz2);
}

function checkPoint(point) {
  if (!Array.isArray(point) || point.length !== 3 || !Number.isFinite(point[0] + point[1] + point[2])) {
    throw new Error('scene solid triangle has a nonfinite vertex');
  }
}

/** Conservative triangle-shell rasterization, followed by an exterior flood fill.
 * Coordinates are volume-local: x/z [-1,1], y [-1,3]. Open meshes retain only
 * their surface voxels; an aperture is not replaced by a bounding solid.
 */
export function voxelizeTriangleSolid(triangles, grid, height = 2 * grid) {
  if (!Number.isInteger(grid) || grid < 2) throw new Error('scene solid grid must be an integer >= 2');
  if (!Array.isArray(triangles) || triangles.length === 0) throw new Error('scene solid requires triangles');
  if (!Number.isInteger(height) || height < 2) throw new Error('scene solid height must be an integer >= 2');
  const cells = new Uint8Array(grid * height * grid), half = grid / 2;
  let surfaceCellCount = 0;
  for (let i = 0; i < triangles.length; i++) {
    const triangle = triangles[i];
    if (!Array.isArray(triangle) || triangle.length !== 3) throw new Error('scene solid requires triangular faces');
    const a = triangle[0], b = triangle[1], c = triangle[2];
    checkPoint(a); checkPoint(b); checkPoint(c);
    const ax = (a[0] + 1) * half, ay = (a[1] + 1) * half, az = (a[2] + 1) * half;
    const bx = (b[0] + 1) * half, by = (b[1] + 1) * half, bz = (b[2] + 1) * half;
    const cx = (c[0] + 1) * half, cy = (c[1] + 1) * half, cz = (c[2] + 1) * half;
    const lx = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 1e-7));
    const ly = Math.max(0, Math.floor(Math.min(ay, by, cy) - 1e-7));
    const lz = Math.max(0, Math.floor(Math.min(az, bz, cz) - 1e-7));
    const hx = Math.min(grid - 1, Math.floor(Math.max(ax, bx, cx) + 1e-7));
    const hy = Math.min(height - 1, Math.floor(Math.max(ay, by, cy) + 1e-7));
    const hz = Math.min(grid - 1, Math.floor(Math.max(az, bz, cz) + 1e-7));
    if (lx > hx || ly > hy || lz > hz) continue;
    const e0x = bx - ax, e0y = by - ay, e0z = bz - az;
    const e1x = cx - bx, e1y = cy - by, e1z = cz - bz;
    const e2x = ax - cx, e2y = ay - cy, e2z = az - cz;
    const nx = e0y * e1z - e0z * e1y, ny = e0z * e1x - e0x * e1z, nz = e0x * e1y - e0y * e1x;
    const nr = .5 * (Math.abs(nx) + Math.abs(ny) + Math.abs(nz));
    for (let z = lz; z <= hz; z++) {
      for (let y = ly; y <= hy; y++) {
        for (let x = lx; x <= hx; x++) {
          const index = x + grid * (y + height * z);
          if (cells[index]) continue;
          if (!triangleTouchesCell(ax, ay, az, bx, by, bz, cx, cy, cz, e0x, e0y, e0z, e1x, e1y, e1z, e2x, e2y, e2z, nx, ny, nz, nr, x, y, z)) continue;
          cells[index] = 1;
          surfaceCellCount++;
        }
      }
    }
  }
  const surfaceCells = cells.slice();
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
    enqueue(solidFieldIndex(grid, 0, y, z, height));
    enqueue(solidFieldIndex(grid, grid - 1, y, z, height));
  }
  for (let z = 0; z < grid; z++) for (let x = 0; x < grid; x++) {
    enqueue(solidFieldIndex(grid, x, 0, z, height));
    enqueue(solidFieldIndex(grid, x, height - 1, z, height));
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < grid; x++) {
    enqueue(solidFieldIndex(grid, x, y, 0, height));
    enqueue(solidFieldIndex(grid, x, y, grid - 1, height));
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
  for (let index = 0; index < cells.length; index++) {
    if (!cells[index] && !exterior[index]) {
      cells[index] = 1;
      interiorCellCount++;
    }
  }
  // Count interfaces only after the occupancy field is final: unvisited
  // enclosed neighbours must not be mistaken for fluid.
  let blockedFaceCount = 0;
  for (let z = 0; z < grid; z++) for (let y = 0; y < height; y++) for (let x = 0; x < grid; x++) {
    const index = solidFieldIndex(grid, x, y, z, height);
    if (!cells[index]) continue;
    if (x + 1 < grid && !cells[index + 1]) blockedFaceCount++;
    if (x > 0 && !cells[index - 1]) blockedFaceCount++;
    if (y + 1 < height && !cells[index + grid]) blockedFaceCount++;
    if (y > 0 && !cells[index - grid]) blockedFaceCount++;
    if (z + 1 < grid && !cells[index + plane]) blockedFaceCount++;
    if (z > 0 && !cells[index - plane]) blockedFaceCount++;
  }
  return { cells, surfaceCells, surfaceCellCount, interiorCellCount, blockedFaceCount };
}

// Fill each authored object independently, then union occupancy. This preserves
// object interiors without treating a space between separate meshes as solid.
// Mesh edits invalidate only their own field; domain/grid edits invalidate all.
export function createSceneSolidGeometryCache({voxelize=voxelizeTriangleSolid,gpuProducer=null}={}) {
  if(gpuProducer)return gpuProducer;
  const members=new Map();let combined=null;
  return {update(objects,transform,{grid,gridHeight=2*grid}) {
    const ids=new Set(),fields=[];let builds=0;
    for(const {id,object} of [...objects].sort((a,b)=>a.id.localeCompare(b.id))) {
      if(!id || ids.has(id))throw Error('Invalid scene collider object identity');ids.add(id);
      const revision=sceneSolidRevision(object,transform),key=JSON.stringify([grid,gridHeight,revision]);
      let cached=members.get(id);
      if(cached?.key!==key) {
        const extraction=trianglesFromSceneObject(object,transform);
        cached={id,key,revision,field:voxelize(extraction.triangles,grid,gridHeight),triangleCount:extraction.triangles.length};
        members.set(id,cached);builds++;
      }
      fields.push(cached);
    }
    for(const id of members.keys())if(!ids.has(id))members.delete(id);
    if(!fields.length)throw Error('scene solid requires authored objects');
    const key=JSON.stringify(fields.map(({id,key})=>[id,key]));
    if(combined?.key!==key) {
      let field=fields[0].field;
      if(fields.length>1) {
        const cells=new Uint8Array(grid*gridHeight*grid),surfaceCells=new Uint8Array(cells.length);
        for(const member of fields)for(let i=0;i<cells.length;i++) {
          cells[i]|=member.field.cells[i];surfaceCells[i]|=member.field.surfaceCells[i];
        }
        let surfaceCellCount=0,interiorCellCount=0,blockedFaceCount=0;const plane=grid*gridHeight;
        for(let z=0;z<grid;z++)for(let y=0;y<gridHeight;y++)for(let x=0;x<grid;x++) {
          const i=x+grid*(y+gridHeight*z);if(!cells[i])continue;
          if(surfaceCells[i])surfaceCellCount++;else interiorCellCount++;
          if(x>0&&!cells[i-1])blockedFaceCount++;if(x+1<grid&&!cells[i+1])blockedFaceCount++;
          if(y>0&&!cells[i-grid])blockedFaceCount++;if(y+1<gridHeight&&!cells[i+grid])blockedFaceCount++;
          if(z>0&&!cells[i-plane])blockedFaceCount++;if(z+1<grid&&!cells[i+plane])blockedFaceCount++;
        }
        field={cells,surfaceCells,surfaceCellCount,interiorCellCount,blockedFaceCount};
      }
      combined={key,field,triangleCount:fields.reduce((n,f)=>n+f.triangleCount,0),
        revision:fields.map(f=>`${f.id}:${f.revision}`).join('|'),
        members:fields.map(f=>({id:f.id,triangleCount:f.triangleCount,solidCellCount:f.field.surfaceCellCount+f.field.interiorCellCount}))};
    }
    return {...combined,builds};
  }};
}
