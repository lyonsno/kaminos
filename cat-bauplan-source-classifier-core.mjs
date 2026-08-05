export const CAT_BAUPLAN_SOURCE_CLASSIFICATION_SCHEMA =
  'kaminos.cat-bauplan-source-classification.v0';

const CAT_BAUPLAN_SOURCE_SHA256 =
  '9453608cdf721ee98ad2924ac16a459b7b810d96159566133e7a573327b9744c';
const RECOVERED_ANATOMICAL_MESHES = new Set([
  'Cube.001', 'Cube.002', 'Cube.003', 'Cube.004', 'Cube.005',
  'Cube.014', 'Cube.016', 'Cube.017', 'Cube.018', 'Cube.019',
  'Cube.022', 'Cube.023', 'Cube.044', 'Cube.045', 'Cube.046',
  'Cube.047', 'Cube.048', 'Cube.049',
]);

function requireObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function sourceRole(object, sourceSha256) {
  if (object.type !== 'MESH') return { admitted: false, reason: 'non_mesh_object' };

  const collections = Array.isArray(object.collections) ? object.collections : [];
  if (/ \| (Origin|Insertion) Paint$/.test(object.name)) {
    return { admitted: false, reason: 'construction_paint_surface' };
  }

  const visibility = requireObject(object.visibility, `${object.name} visibility evidence`);
  for (const field of ['hideViewport', 'hideRender', 'hiddenInViewLayer', 'visibleInViewLayer']) {
    if (typeof visibility[field] !== 'boolean') {
      throw new Error(`${object.name} visibility evidence is missing ${field}`);
    }
  }
  if (
    visibility.hideViewport
    || visibility.hideRender
    || visibility.hiddenInViewLayer
    || !visibility.visibleInViewLayer
  ) {
    return { admitted: false, reason: 'hidden_source_surface' };
  }

  if (collections.some(collection => collection.startsWith('Constructional Model/90 Semantics'))) {
    if (
      sourceSha256 === CAT_BAUPLAN_SOURCE_SHA256
      && collections.includes('Constructional Model/90 Semantics/Attachment Patches')
      && RECOVERED_ANATOMICAL_MESHES.has(object.name)
    ) {
      return {
        admitted: true,
        role: 'authored_mesh',
        admissionBasis: 'source_bound_anatomical_recovery',
      };
    }
    return { admitted: false, reason: 'semantic_control_surface' };
  }

  if (collections.includes('Collection')) {
    return { admitted: true, role: 'authored_mesh', admissionBasis: 'authoring_collection' };
  }
  if (
    collections.includes('Constructional Model/20 Muscle')
    && (
      object.customProperties?.cmk_role === 'muscle_surface_provisional'
      || object.name.endsWith(' | Surface')
    )
  ) {
    return { admitted: true, role: 'muscle_surface', admissionBasis: 'provisional_muscle_surface' };
  }
  return { admitted: false, reason: 'unclassified_mesh_surface' };
}

function unionBounds(bounds) {
  if (bounds.length === 0) return null;
  const result = {
    min: [...bounds[0].min],
    max: [...bounds[0].max],
  };
  for (const current of bounds.slice(1)) {
    for (let axis = 0; axis < 3; axis += 1) {
      result.min[axis] = Math.min(result.min[axis], current.min[axis]);
      result.max[axis] = Math.max(result.max[axis], current.max[axis]);
    }
  }
  return result;
}

export function classifyCatBauplanSource(rawExtraction, { expectedSourceSha256 }) {
  const extraction = requireObject(rawExtraction, 'extraction');
  if (extraction.status !== 'completed') throw new Error('source extraction is not completed');
  if (extraction.source?.sha256 !== expectedSourceSha256) {
    throw new Error('source SHA-256 mismatch');
  }
  if (!Array.isArray(extraction.objects)) throw new Error('source extraction objects must be an array');

  const admittedObjects = [];
  const rejectedObjects = [];
  const admittedRoleCounts = {};
  for (const object of extraction.objects) {
    const disposition = sourceRole(requireObject(object, 'source object'), expectedSourceSha256);
    if (!disposition.admitted) {
      rejectedObjects.push({ name: object.name, reason: disposition.reason });
      continue;
    }
    const bounds = requireObject(object.worldBounds, `${object.name} world bounds`);
    if (!Array.isArray(bounds.min) || bounds.min.length !== 3 || !Array.isArray(bounds.max) || bounds.max.length !== 3) {
      throw new Error(`${object.name} world bounds must contain three-dimensional min and max vectors`);
    }
    admittedObjects.push({
      name: object.name,
      role: disposition.role,
      admissionBasis: disposition.admissionBasis,
      collections: [...object.collections],
      worldBounds: bounds,
    });
    admittedRoleCounts[disposition.role] = (admittedRoleCounts[disposition.role] ?? 0) + 1;
  }
  admittedObjects.sort((left, right) => left.name.localeCompare(right.name));

  return {
    schema: CAT_BAUPLAN_SOURCE_CLASSIFICATION_SCHEMA,
    classifierId: 'cat-bauplan-source-classifier-v0',
    status: 'completed',
    source: { ...extraction.source },
    admittedObjectNames: admittedObjects.map(object => object.name),
    admittedObjects,
    admittedRoleCounts,
    worldBounds: unionBounds(admittedObjects.map(object => object.worldBounds)),
    rejectedObjects,
  };
}
