import { createGpuStructuralCombustionAssembly } from './structural-combustion-gpu.mjs';
import { createLayeredStructuralMaterial } from './structural-material-3d-core.js';
import { createLayeredStructuralHotWebGpuSidecar } from './structural-material-3d-webgpu-hot-sidecar.js';

function objectIdNumber(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 1;
}

export function validateSavedMeshCombustionAssetIdentity(binding, effectiveAssetIdentity) {
  if (typeof effectiveAssetIdentity !== 'string' || binding?.assetIdentity !== effectiveAssetIdentity) {
    throw new Error(`saved mesh asset identity mismatch: expected ${String(binding?.assetIdentity || 'missing')}, received ${String(effectiveAssetIdentity || 'missing')}`);
  }
  return effectiveAssetIdentity;
}

export function buildSavedMeshStructuralSurface({ THREE, object, assetIdentity } = {}) {
  if (!THREE?.Vector3 || !THREE?.Box3 || !object?.traverse || typeof assetIdentity !== 'string' || !assetIdentity) {
    throw new Error('saved mesh structural surface requires Three.js, a scene object, and its asset identity');
  }
  object.updateWorldMatrix(true, true);
  const positions = [];
  const normals = [];
  const indices = [];
  const vertexIslands = [];
  const islands = [];
  const bounds = new THREE.Box3().makeEmpty();
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  let vertexOffset = 0;
  object.traverse(child => {
    if (!child.isMesh || !child.geometry?.attributes?.position) return;
    const geometry = child.geometry;
    const position = geometry.attributes.position;
    const normalAttribute = geometry.attributes.normal;
    if (!normalAttribute) throw new Error(`saved mesh ${child.name || child.uuid} has no vertex normals`);
    const islandIndex = islands.length;
    const islandBounds = new THREE.Box3().makeEmpty();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(child.matrixWorld);
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      point.fromBufferAttribute(position, vertex).applyMatrix4(child.matrixWorld);
      normal.fromBufferAttribute(normalAttribute, vertex).applyMatrix3(normalMatrix).normalize();
      positions.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
      vertexIslands.push(islandIndex);
      bounds.expandByPoint(point);
      islandBounds.expandByPoint(point);
    }
    const index = geometry.index;
    if (index) {
      for (let offset = 0; offset < index.count; offset += 1) indices.push(vertexOffset + index.getX(offset));
    } else {
      for (let offset = 0; offset < position.count; offset += 1) indices.push(vertexOffset + offset);
    }
    vertexOffset += position.count;
    const authoredBounds = child.userData?.nodeBounds;
    const authoredMinimum = authoredBounds?.min;
    const authoredMaximum = authoredBounds?.max;
    if (Array.isArray(authoredMinimum) && Array.isArray(authoredMaximum) && authoredMinimum.length === 3 && authoredMaximum.length === 3) {
      islandBounds.makeEmpty();
      for (const x of [authoredMinimum[0], authoredMaximum[0]]) {
        for (const y of [authoredMinimum[1], authoredMaximum[1]]) {
          for (const z of [authoredMinimum[2], authoredMaximum[2]]) {
            islandBounds.expandByPoint(point.set(x, y, z).applyMatrix4(child.matrixWorld));
          }
        }
      }
    }
    const authoredAnchor = child.userData?.motionAnchor;
    const motionAnchor = Array.isArray(authoredAnchor) && authoredAnchor.length === 3
      ? point.set(...authoredAnchor).applyMatrix4(child.matrixWorld).clone()
      : islandBounds.getCenter(new THREE.Vector3());
    islands.push({ bounds: islandBounds, motionAnchor, sourceLabel: child.userData?.structuralIsland || child.name || String(islandIndex) });
  });
  if (positions.length < 9 || indices.length < 3 || indices.length % 3 !== 0) {
    throw new Error('saved combustion object has no complete mesh triangles');
  }
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const displayScale = [size.x || 1, size.y || 1, size.z || 1];
  const normalizedPositions = new Float32Array(positions.length);
  for (let vertex = 0; vertex < vertexOffset; vertex += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const extent = displayScale[axis];
      normalizedPositions[vertex * 3 + axis] = extent === 1 && size.getComponent(axis) === 0
        ? 0.5
        : (positions[vertex * 3 + axis] - center.getComponent(axis)) / extent + 0.5;
    }
  }
  const normalizedIslands = islands.map(({ bounds: islandBounds, motionAnchor, sourceLabel }) => {
    const minimum = islandBounds.min.toArray().map((value, axis) => (value - center.getComponent(axis)) / displayScale[axis] + 0.5);
    const maximum = islandBounds.max.toArray().map((value, axis) => (value - center.getComponent(axis)) / displayScale[axis] + 0.5);
    return {
      nodeBounds: { min: minimum, max: maximum },
      motionAnchor: motionAnchor.toArray().map((value, axis) => (value - center.getComponent(axis)) / displayScale[axis] + 0.5),
      sourceLabel,
    };
  });
  if (normalizedIslands.length !== 2) throw new Error(`timber-two-island binding requires two mesh islands; found ${normalizedIslands.length}`);
  return {
    meshSurface: {
      schema: 'kaminos.structural-mesh-surface.v0',
      assetIdentity,
      positions: normalizedPositions,
      normals: new Float32Array(normals),
      indices: new Uint32Array(indices),
      vertexIslands: new Uint32Array(vertexIslands),
      islands: normalizedIslands,
    },
    worldOffset: [center.x, center.y, center.z],
    displayScale,
  };
}

async function createSavedMeshCombustionStructure({ THREE, entry, gpuContext }) {
  const binding = entry?.combustionBinding;
  if (!binding || binding.schema !== 'kaminos.object-combustion-binding.v0' || binding.objectId !== entry.id) {
    throw new Error('saved mesh combustion binding identity does not match the scene object');
  }
  if (binding.structuralProfile !== 'timber-two-island.v0') {
    throw new Error(`unsupported saved mesh structural profile: ${binding.structuralProfile}`);
  }
  if (binding.emissionEnabled !== undefined && typeof binding.emissionEnabled !== 'boolean') {
    throw new Error('saved mesh combustion emissionEnabled must be a boolean');
  }
  if (!gpuContext?.device || !gpuContext?.format || !Number.isInteger(gpuContext.gridSize)) {
    throw new Error('saved mesh combustion requires the active Pyro GPU context');
  }
  const sourceResponse = await fetch(entry.source, { cache: 'no-store' });
  if (!sourceResponse.ok) throw new Error(`saved mesh combustion source fetch failed (${sourceResponse.status})`);
  const sourceBytes = await sourceResponse.arrayBuffer();
  const sourceHash = await crypto.subtle.digest('SHA-256', sourceBytes);
  const effectiveAssetIdentity = `sha256:${Array.from(new Uint8Array(sourceHash), value => value.toString(16).padStart(2, '0')).join('')}`;
  validateSavedMeshCombustionAssetIdentity(binding, effectiveAssetIdentity);
  const surface = buildSavedMeshStructuralSurface({ THREE, object: entry.object, assetIdentity: binding.assetIdentity });
  const initialWorldInverse = entry.object.matrixWorld.clone().invert();
  const normalizedToRestWorld = new THREE.Matrix4().makeScale(...surface.displayScale);
  normalizedToRestWorld.setPosition(...surface.worldOffset.map((value, axis) => value - surface.displayScale[axis] * 0.5));
  const spatialTransformProvider = () => {
    entry.object.updateWorldMatrix(true, true);
    if (Math.abs(entry.object.matrixWorld.determinant()) < 1e-12) throw new Error('combustion object transform is singular');
    const delta = entry.object.matrixWorld.clone().multiply(initialWorldInverse);
    const domainTranslation = gpuContext.domainTranslation();
    const worldToPyro = new THREE.Matrix4().makeScale(0.5, 0.5, 0.5);
    worldToPyro.setPosition(...domainTranslation.map(value => 0.5 - value * 0.5));
    return {
      authority: 'saved-object-world-to-current-pyro-domain-v0',
      domainTranslation,
      nodeToPyro: worldToPyro.multiply(delta).multiply(normalizedToRestWorld).toArray(),
      displayTransform: delta.toArray(),
      normalTransform: delta.clone().invert().transpose().toArray(),
    };
  };
  const state = createLayeredStructuralMaterial({ columns: 11, rows: 11, layers: 11, notch: false });
  const spatialState = spatialTransformProvider();
  const sidecar = await createLayeredStructuralHotWebGpuSidecar({ state, device: gpuContext.device });
  return {
    id: entry.id,
    objectId: objectIdNumber(entry.id),
    state,
    sidecar,
    role: 'emitter',
    emissionEnabled: binding.emissionEnabled ?? true,
    motionEnabled: true,
    presentationMode: 'mesh-skin',
    meshSurface: surface.meshSurface,
    worldOffset: surface.worldOffset,
    displayScale: surface.displayScale,
    spatialTransformProvider,
    spatialState,
    burnRate: binding.burnRate,
  };
}

export async function createSavedMeshCombustionAssembly({ THREE, entry, entries = entry ? [entry] : [], gpuContext, presentationDebugMode = 'off' } = {}) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('saved mesh combustion requires bound objects');
  if (new Set(entries.map(value => value.id)).size !== entries.length) throw new Error('saved mesh combustion object identities must be unique');
  const structures = [];
  try {
    for (const boundEntry of entries) {
      structures.push(await createSavedMeshCombustionStructure({THREE, entry: boundEntry, gpuContext}));
    }
    const assembly = await createGpuStructuralCombustionAssembly({
      device: gpuContext.device,
      gridSize: gpuContext.gridSize,
      gridDimensions: gpuContext.gridDimensions,
      format: gpuContext.format,
      presentationDebugMode,
      structures,
    });
    return {
      assembly,
      dispose() {
        assembly.destroy();
        structures.forEach(structure => { void structure.sidecar.dispose(); });
      },
    };
  } catch (error) {
    await Promise.all(structures.map(structure => structure.sidecar.dispose()));
    throw error;
  }
}
