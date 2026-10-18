import {Box3, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, Ray, Vector3} from './lib/three.core.js';

const indexes = new WeakMap();
const assets = new WeakMap();
let preparation = Promise.resolve();

function sourceFacts(mesh) {
  for (let node = mesh; node; node = node.parent) {
    if (Number.isInteger(node.userData?.surfels) && node.userData.surfels > 0) return node.userData;
  }
  return null;
}

// Bins are a broad phase only. Every retained candidate is intersected against
// its actual transformed triangles; empty space between patches stays empty.
function spatialIndex(mesh, divisions) {
  const position = mesh.geometry.attributes.position, index = mesh.geometry.index;
  const old = indexes.get(mesh);
  if (old && old.matrix === mesh.instanceMatrix && old.version === mesh.instanceMatrix.version
    && old.count === mesh.count && old.position === position && old.positionVersion === position.version
    && old.index === index && old.indexVersion === index?.version && old.divisions === divisions) return old;
  const result = {matrix: mesh.instanceMatrix, version: mesh.instanceMatrix.version,
    count: mesh.count, position, positionVersion: position.version, index,
    indexVersion: index?.version, divisions, bins: [], status: 'building', error: null, queries: 0,
    lastCandidates: null, lastIntersections: null};
  indexes.set(mesh, result);
  mesh.geometry.computeBoundingBox();
  result.promise = preparation.then(() => new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./surfel-spatial.worker.mjs', import.meta.url), {type: 'module'});
      worker.onmessage = ({data}) => {
        worker.terminate();
        if (data.error) { reject(Error(data.error)); return; }
        result.bins = data.bins.map(bin => ({bounds: new Box3(new Vector3(...bin.min), new Vector3(...bin.max)), ids: bin.ids}));
        result.status = 'indexed'; resolve(result);
      };
      worker.onerror = error => { worker.terminate(); reject(Error(error.message || 'Surfel spatial worker failed')); };
      const matrices = mesh.instanceMatrix.array.slice(0, mesh.count * 16);
      worker.postMessage({matrices, count: mesh.count, divisions,
        min: mesh.geometry.boundingBox.min.toArray(), max: mesh.geometry.boundingBox.max.toArray()}, [matrices.buffer]);
    } catch (error) { worker?.terminate(); reject(error); }
  })).catch(error => { result.status = 'failed'; result.error = error.message; return result; });
  preparation = result.promise;
  return result;
}

export function installSurfelPicking(mesh, {divisions = 8} = {}) {
  if (!mesh?.isInstancedMesh || !sourceFacts(mesh)) return false;
  if (!Number.isInteger(divisions) || divisions <= 0) throw Error('Spatial divisions must be a positive integer');
  spatialIndex(mesh, divisions);
  // Keep instance transforms in the ray path. The ordinary mesh BVH override
  // sees only the base triangle and must never replace this method.
  mesh.raycast = function (raycaster, intersects) {
    // Raycaster recursively visits invisible descendants. Cached comparison
    // batches must not pick, or spend broad-phase work, while not drawn.
    for (let node = this; node; node = node.parent) if (!node.visible) return;
    if (!this.count || !this.material) return;
    const data = spatialIndex(this, divisions);
    if (data.status !== 'indexed') {
      InstancedMesh.prototype.raycast.call(this, raycaster, intersects);
      return;
    }
    const inverse = new Matrix4().copy(this.matrixWorld).invert();
    const ray = new Ray().copy(raycaster.ray).applyMatrix4(inverse);
    const matrix = new Matrix4(), proxy = new Mesh(this.geometry, this.material), box = new Box3();
    let candidates = 0, triangles = 0, closest = null;
    for (const bin of data.bins) {
      if (!ray.intersectsBox(bin.bounds)) continue;
      for (const id of bin.ids) {
        candidates++;
        this.getMatrixAt(id, matrix);
        box.copy(this.geometry.boundingBox).applyMatrix4(matrix);
        if (!ray.intersectsBox(box)) continue;
        triangles++;
        proxy.matrixWorld.multiplyMatrices(this.matrixWorld, matrix);
        const hits = [];
        Mesh.prototype.raycast.call(proxy, raycaster, hits);
        for (const hit of hits) {
          hit.object = this; hit.instanceId = id;
          if (this.userData.surfelSourceIds) hit.surfelSourceInstance = this.userData.surfelSourceIds[id];
          else hit.surfelSourceInstance = id;
          if (raycaster.firstHitOnly) {
            if (!closest || hit.distance < closest.distance) closest = hit;
          } else intersects.push(hit);
        }
      }
    }
    if (closest) intersects.push(closest);
    data.queries++; data.lastCandidates = candidates; data.lastIntersections = triangles;
  };
  return true;
}

async function makeChunks(source, divisions) {
  if (source.morphTexture || source.children.length) throw Error('Chunked surfels require static leaf instances');
  if (Object.values(source.geometry.attributes).some(attribute => attribute.isInstancedBufferAttribute)) {
    throw Error('Chunked surfels with custom instance geometry attributes are not supported');
  }
  const data = await spatialIndex(source, divisions).promise, root = new Group();
  if (data.status !== 'indexed') throw Error(data.error || 'Surfel spatial index unavailable');
  if (spatialIndex(source, divisions) !== data) throw Error('Surfel source changed while preparing batches; retry');
  root.name = `${source.name || 'Surfels'} spatial batches`;
  root.position.copy(source.position); root.quaternion.copy(source.quaternion); root.scale.copy(source.scale);
  root.matrix.copy(source.matrix); root.matrixAutoUpdate = source.matrixAutoUpdate;
  root.visible = false;
  const matrix = new Matrix4();
  for (const bin of data.bins) {
    const chunk = new InstancedMesh(source.geometry, source.material, bin.ids.length);
    chunk.name = source.name;
    chunk.castShadow = source.castShadow; chunk.receiveShadow = source.receiveShadow;
    chunk.layers.mask = source.layers.mask; chunk.renderOrder = source.renderOrder;
    chunk.frustumCulled = source.frustumCulled;
    chunk.userData = {...source.userData, surfels: bin.ids.length,
      surfelSourceIds: Uint32Array.from(bin.ids)};
    for (let local = 0; local < bin.ids.length; local++) {
      const id = bin.ids[local];
      source.getMatrixAt(id, matrix); chunk.setMatrixAt(local, matrix);
    }
    if (source.instanceColor) {
      // Copy original linear values without allocating a full source-sized
      // colour buffer for every spatial batch.
      chunk.instanceColor = new InstancedBufferAttribute(
        new source.instanceColor.array.constructor(bin.ids.length * source.instanceColor.itemSize),
        source.instanceColor.itemSize, source.instanceColor.normalized);
      bin.ids.forEach((id, local) => {
        for (let k = 0; k < source.instanceColor.itemSize; k++) {
          chunk.instanceColor.array[local * source.instanceColor.itemSize + k] = source.instanceColor.array[id * source.instanceColor.itemSize + k];
        }
      });
    }
    chunk.instanceMatrix.needsUpdate = true;
    if (chunk.instanceColor) chunk.instanceColor.needsUpdate = true;
    chunk.computeBoundingBox(); chunk.computeBoundingSphere();
    // The parent worker already partitioned these local instances. Reuse it;
    // creating one worker per draw batch would make preparation more costly.
    const p = chunk.geometry.attributes.position, i = chunk.geometry.index;
    const localIndex = {matrix: chunk.instanceMatrix, version: chunk.instanceMatrix.version,
      count: chunk.count, position: p, positionVersion: p.version, index: i, indexVersion: i?.version,
      divisions, status: 'indexed', bins: [{bounds: bin.bounds, ids: Uint32Array.from(bin.ids, (_, id) => id)}],
      queries: 0, lastCandidates: null, lastIntersections: null};
    indexes.set(chunk, localIndex);
    installSurfelPicking(chunk, {divisions}); root.add(chunk);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return root;
}

// Existing imports get exact picking. Drawing remains in its original batch
// until an explicit comparison selects spatial batches; neither route drops a
// patch or chooses a lower-detail source asset.
export function prepareSurfelAsset(root, {divisions = 8} = {}) {
  if (assets.has(root)) return assets.get(root);
  const entries = [];
  root.traverse(mesh => {
    if (installSurfelPicking(mesh, {divisions})) entries.push({source: mesh, chunks: null, visible: mesh.visible});
  });
  let chunked = false;
  const read = () => ({patches: entries.reduce((sum, entry) => sum + entry.source.count, 0),
    objects: entries.length, chunked, divisions,
    batches: entries.reduce((sum, entry) => sum + (chunked ? entry.chunks.children.length : 1), 0),
    picking: entries.map(({source, chunks}) => (chunked ? chunks.children : [source]).map(mesh => {
      const data = indexes.get(mesh);
      return {status: data?.status ?? 'unprepared', error: data?.error ?? null, queries: data?.queries ?? 0, candidates: data?.lastCandidates ?? null,
        triangleCandidates: data?.lastIntersections ?? null, instances: mesh.count};
    })).flat()});
  let switches = Promise.resolve();
  async function switchRepresentation(value) {
    value = Boolean(value);
    if (value === chunked) return read();
    if (value) {
      // Prepare all replacements before changing visible state.
      for (const entry of entries) {
        if (!entry.chunks) {
          entry.chunks = await makeChunks(entry.source, divisions);
          entry.source.parent.add(entry.chunks);
        }
      }
    }
    for (const entry of entries) {
      if (value) entry.visible = entry.source.visible;
      if (entry.chunks) {
        entry.chunks.position.copy(entry.source.position);
        entry.chunks.quaternion.copy(entry.source.quaternion);
        entry.chunks.scale.copy(entry.source.scale);
        entry.chunks.visible = value && entry.visible;
      }
      entry.source.visible = !value && entry.visible;
    }
    chunked = value;
    return read();
  }
  const controller = {read, ready: () => Promise.all(entries.map(({source}) => spatialIndex(source, divisions).promise)),
    setChunked(value) {
      // Restoration queues behind an in-flight enable even before that enable
      // has published its visible state. Closing cannot race a late switch.
      const operation = switches.then(() => switchRepresentation(value));
      switches = operation.catch(() => {});
      return operation;
    }};
  assets.set(root, controller);
  return controller;
}
