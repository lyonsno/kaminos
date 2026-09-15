import { createHash } from 'node:crypto';

export const TRACK_M_BLENDER_EXTRACTION_SCHEMA = 'kaminos.track-m-blender-extraction.v0';
export const TRACK_M_AUTHORED_SOURCE_GRAPH_SCHEMA = 'kaminos.track-m-authored-source-graph.v0';
export const TRACK_M_SOURCE_PROJECTION_FAILURE_SCHEMA = 'kaminos.track-m-source-projection-failure.v0';
export const TRACK_M_SOURCE_PROJECTION_COMPILER_ID = 'track-m-source-projection-compiler-v0';

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const IDENTITY_FIELDS = [
  'cmk_schema_version',
  'cmk_lineage_id',
  'cmk_construction_id',
  'cmk_instance_id',
  'cmk_variant',
];
const COMPONENTS = Object.freeze([
  ['origin', 'attachment_origin'],
  ['belly', 'belly_profile'],
  ['insertion', 'attachment_insertion'],
  ['path', 'muscle_path'],
  ['surface', 'muscle_surface_provisional'],
]);
const SEMANTIC_ROLES = Object.freeze([
  'attachment_patch',
  'clearance_volume',
  'joint_frame',
  'segment_axis',
  'support_target',
]);
const ENDPOINT_AUTHORITIES = Object.freeze([
  'source_mesh',
  'provisional_muscle_surface',
  'self_reference',
  'unclassified_object',
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonical(value[key])]),
    );
  }
  if (typeof value === 'number' && Object.is(value, -0)) return 0;
  return value;
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is required`);
}

function requireHash(value, label) {
  if (!HASH_PATTERN.test(value ?? '')) throw new Error(`${label} must be a SHA-256 identity`);
}

function requireFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function requireInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
}

function objectIdentity(object, label) {
  const properties = object.customProperties;
  requireObject(properties, `${label} custom properties`);
  const identity = {};
  for (const field of IDENTITY_FIELDS) {
    requireString(properties[field], `${label} ${field}`);
    identity[field.slice(4)] = properties[field];
  }
  return identity;
}

function normalizedMatrix(value, label) {
  if (!Array.isArray(value) || value.length !== 16) throw new Error(`${label} matrixWorld must contain 16 values`);
  value.forEach((entry, index) => requireFiniteNumber(entry, `${label} matrixWorld[${index}]`));
  return value.map(entry => Object.is(entry, -0) ? 0 : entry);
}

function normalizedGeometry(geometry, label) {
  requireObject(geometry, `${label} geometry`);
  requireString(geometry.kind, `${label} geometry kind`);
  requireHash(geometry.contentSha256, `${label} geometry content hash`);
  const output = canonical(structuredClone(geometry));
  for (const [key, value] of Object.entries(output)) {
    if (key.endsWith('Count')) requireInteger(value, `${label} geometry ${key}`);
  }
  return output;
}

function normalizedModifiers(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} modifiers must be an array`);
  return value.map((modifier, index) => {
    requireObject(modifier, `${label} modifier[${index}]`);
    requireString(modifier.name, `${label} modifier[${index}] name`);
    requireString(modifier.type, `${label} modifier[${index}] type`);
    if (typeof modifier.showViewport !== 'boolean' || typeof modifier.showRender !== 'boolean') {
      throw new Error(`${label} modifier[${index}] visibility must be explicit`);
    }
    if (modifier.type === 'MIRROR') {
      for (const field of ['useAxis', 'useBisectAxis', 'useBisectFlipAxis']) {
        if (!Array.isArray(modifier[field]) || modifier[field].length !== 3
          || modifier[field].some(entry => typeof entry !== 'boolean')) {
          throw new Error(`${label} MIRROR modifier ${field} must contain three booleans`);
        }
      }
      for (const field of ['useClip', 'useMirrorMerge']) {
        if (typeof modifier[field] !== 'boolean') throw new Error(`${label} MIRROR modifier ${field} must be boolean`);
      }
      requireFiniteNumber(modifier.mergeThreshold, `${label} MIRROR modifier mergeThreshold`);
      if (modifier.mirrorObject !== null) requireString(modifier.mirrorObject, `${label} MIRROR modifier mirrorObject`);
    }
    return canonical(structuredClone(modifier));
  });
}

function baseObjectRecord(object, label) {
  requireString(object.name, `${label} name`);
  requireString(object.type, `${label} type`);
  if (object.parent !== null && object.parent !== undefined) requireString(object.parent, `${label} parent`);
  if (!Array.isArray(object.collections)) throw new Error(`${label} collections must be an array`);
  object.collections.forEach((path, index) => requireString(path, `${label} collection[${index}]`));
  return {
    name: object.name,
    type: object.type,
    parent: object.parent ?? null,
    collections: [...object.collections].sort(),
    matrixWorld: normalizedMatrix(object.matrixWorld, label),
    modifiers: normalizedModifiers(object.modifiers, label),
  };
}

function classifyEndpointSource(sourceObject, muscleLineageId) {
  const role = sourceObject.customProperties?.cmk_role ?? null;
  if (role === 'muscle_surface_provisional') {
    return sourceObject.customProperties?.cmk_lineage_id === muscleLineageId
      ? 'self_reference'
      : 'provisional_muscle_surface';
  }
  if (sourceObject.type === 'MESH' && role === null) return 'source_mesh';
  return 'unclassified_object';
}

function resolveComponent({ root, rootIdentity, key, expectedRole, objectsByName }) {
  const declaredName = root.customProperties[`cmk_${key}_name`];
  let component = typeof declaredName === 'string' ? objectsByName.get(declaredName) : null;
  let referenceResolution = 'declared';
  if (!component) {
    const roleMatchedChildren = [...objectsByName.values()].filter(candidate => (
      candidate.parent === root.name
      && candidate.customProperties?.cmk_role === expectedRole
    ));
    for (const candidate of roleMatchedChildren) {
      const candidateIdentity = objectIdentity(candidate, `${root.name} ${key}`);
      if (candidateIdentity.lineage_id !== rootIdentity.lineage_id) {
        throw new Error(`${root.name} ${key} lineage contradicts its muscle rig lineage`);
      }
    }
    const candidates = roleMatchedChildren;
    if (candidates.length > 1) {
      throw new Error(`${root.name} has ambiguous ${key} components for lineage ${rootIdentity.lineage_id}`);
    }
    component = candidates[0] ?? null;
    referenceResolution = component ? 'lineage-child-recovery' : 'missing';
  }
  if (!component) return { component: null, referenceResolution };

  const identity = objectIdentity(component, `${root.name} ${key}`);
  if (component.customProperties.cmk_role !== expectedRole) {
    throw new Error(`${root.name} ${key} role contradicts ${expectedRole}`);
  }
  if (identity.lineage_id !== rootIdentity.lineage_id) {
    throw new Error(`${root.name} ${key} lineage contradicts its muscle rig lineage`);
  }
  if (component.parent !== root.name) {
    throw new Error(`${root.name} ${key} component is not parented to its muscle rig`);
  }
  const record = {
    ...baseObjectRecord(component, `${root.name} ${key}`),
    role: expectedRole,
    identity,
    referenceResolution,
    geometry: component.geometry === null ? null : normalizedGeometry(component.geometry, `${root.name} ${key}`),
  };
  return { component: record, referenceResolution };
}

function endpointRecord({ root, rootIdentity, endpoint, component, objectsByName }) {
  const property = `cmk_${endpoint}_source`;
  const sourceName = root.customProperties[property];
  requireString(sourceName, `${root.name} ${endpoint} source`);
  const sourceObject = objectsByName.get(sourceName);
  if (!sourceObject) throw new Error(`${root.name} ${endpoint} source ${sourceName} is missing`);
  return {
    handleObject: component?.name ?? null,
    handleInstanceId: component?.identity?.instance_id ?? null,
    sourceName,
    sourceAuthority: classifyEndpointSource(sourceObject, rootIdentity.lineage_id),
    sourceObjectType: sourceObject.type,
    sourceRole: sourceObject.customProperties?.cmk_role ?? null,
    sourceInstanceId: sourceObject.customProperties?.cmk_instance_id ?? null,
  };
}

function muscleRecord(root, objectsByName) {
  const properties = root.customProperties;
  const identity = objectIdentity(root, `${root.name} muscle rig`);
  if (properties.cmk_role !== 'muscle_rig') throw new Error(`${root.name} is not a muscle rig`);
  requireString(properties.cmk_completeness, `${root.name} completeness`);
  requireString(properties.cmk_endpoint_route, `${root.name} endpoint route`);
  requireString(properties.cmk_endpoint_strategy, `${root.name} endpoint strategy`);

  const components = {};
  const missingComponentRoles = [];
  for (const [key, expectedRole] of COMPONENTS) {
    const resolved = resolveComponent({ root, rootIdentity: identity, key, expectedRole, objectsByName });
    components[key] = resolved.component;
    if (!resolved.component) missingComponentRoles.push(expectedRole);
  }
  const origin = endpointRecord({
    root,
    rootIdentity: identity,
    endpoint: 'origin',
    component: components.origin,
    objectsByName,
  });
  const insertion = endpointRecord({
    root,
    rootIdentity: identity,
    endpoint: 'insertion',
    component: components.insertion,
    objectsByName,
  });
  const numericSettings = {};
  for (const key of [
    'cmk_origin_tendon_fraction',
    'cmk_insertion_tendon_fraction',
    'cmk_longitudinal_sections',
    'cmk_profile_sides',
  ]) {
    const value = properties[key] ?? null;
    if (value !== null) requireFiniteNumber(value, `${root.name} ${key}`);
    numericSettings[key.slice(4)] = value;
  }
  return {
    ...baseObjectRecord(root, `${root.name} muscle rig`),
    identity,
    authoredCompleteness: properties.cmk_completeness,
    completenessAuthority: missingComponentRoles.length === 0 ? 'declared_components_present' : 'incomplete_wip',
    endpointRoute: properties.cmk_endpoint_route,
    endpointStrategy: properties.cmk_endpoint_strategy,
    settings: numericSettings,
    origin,
    insertion,
    components,
    missingComponentRoles: missingComponentRoles.sort(),
  };
}

function assertRawExtraction(raw, expectedSourceSha256) {
  requireObject(raw, 'raw extraction');
  if (raw.schema !== TRACK_M_BLENDER_EXTRACTION_SCHEMA) throw new Error('raw extraction schema mismatch');
  if (raw.status !== 'completed') throw new Error('raw extraction is not completed');
  requireString(raw.extractorId, 'extractor id');
  requireObject(raw.source, 'source');
  requireString(raw.source.requestedPath, 'requested source path');
  requireString(raw.source.effectivePath, 'effective source path');
  requireHash(raw.source.sha256, 'source hash');
  requireHash(expectedSourceSha256, 'expected source hash');
  if (raw.source.sha256 !== expectedSourceSha256) throw new Error('source SHA-256 mismatch');
  requireInteger(raw.source.byteLength, 'source byte length');
  if (raw.source.byteLength === 0) throw new Error('source byte length must be positive');
  requireObject(raw.blender, 'Blender identity');
  requireString(raw.blender.version, 'Blender version');
  requireObject(raw.scene, 'scene');
  requireString(raw.scene.name, 'scene name');
  requireInteger(raw.scene.frame, 'scene frame');
  requireObject(raw.scene.unitSettings, 'scene unit settings');
  requireString(raw.scene.unitSettings.system, 'unit system');
  requireString(raw.scene.unitSettings.lengthUnit, 'length unit');
  requireFiniteNumber(raw.scene.unitSettings.scaleLength, 'unit scale length');
  if (raw.scene.unitSettings.scaleLength <= 0) throw new Error('unit scale length must be positive');
  if (!Array.isArray(raw.objects) || raw.objects.length === 0) throw new Error('raw extraction objects are required');
}

export function compileTrackMSourceProjection(raw, { expectedSourceSha256 } = {}) {
  assertRawExtraction(raw, expectedSourceSha256);
  const objectsByName = new Map();
  for (const object of raw.objects) {
    requireObject(object, 'extracted object');
    requireString(object.name, 'extracted object name');
    if (objectsByName.has(object.name)) throw new Error(`duplicate object name ${object.name}`);
    requireObject(object.customProperties, `${object.name} custom properties`);
    objectsByName.set(object.name, object);
  }

  const sourceMeshes = [...objectsByName.values()]
    .filter(object => object.type === 'MESH' && !object.customProperties.cmk_role)
    .map(object => ({
      ...baseObjectRecord(object, `${object.name} source mesh`),
      geometry: normalizedGeometry(object.geometry, `${object.name} source mesh`),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (sourceMeshes.length === 0) throw new Error('no source meshes were extracted');

  const muscles = [...objectsByName.values()]
    .filter(object => object.customProperties.cmk_role === 'muscle_rig')
    .map(object => muscleRecord(object, objectsByName))
    .sort((left, right) => left.identity.instance_id.localeCompare(right.identity.instance_id));
  if (muscles.length === 0) throw new Error('no CMK muscle rigs were extracted');

  const semanticMarkers = [...objectsByName.values()]
    .filter(object => SEMANTIC_ROLES.includes(object.customProperties.cmk_role))
    .map(object => ({
      ...baseObjectRecord(object, `${object.name} semantic marker`),
      role: object.customProperties.cmk_role,
      identity: objectIdentity(object, `${object.name} semantic marker`),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const presentSemanticRoles = new Set(semanticMarkers.map(marker => marker.role));
  const missingSemanticRoles = SEMANTIC_ROLES.filter(role => !presentSemanticRoles.has(role));

  const endpointAuthorityCounts = Object.fromEntries(ENDPOINT_AUTHORITIES.map(authority => [authority, 0]));
  for (const muscle of muscles) {
    endpointAuthorityCounts[muscle.origin.sourceAuthority] += 1;
    endpointAuthorityCounts[muscle.insertion.sourceAuthority] += 1;
  }

  const graphCore = {
    schema: TRACK_M_AUTHORED_SOURCE_GRAPH_SCHEMA,
    compilerId: TRACK_M_SOURCE_PROJECTION_COMPILER_ID,
    extractorId: raw.extractorId,
    status: 'compiled',
    trackId: 'shape-bearing-musculature',
    source: canonical(structuredClone(raw.source)),
    blender: canonical(structuredClone(raw.blender)),
    scene: canonical(structuredClone(raw.scene)),
    sourceMeshes,
    muscles,
    semanticMarkers,
    missingSemanticRoles,
    endpointAuthorityCounts,
    authority: {
      anatomicalSource: 'operator-authored-cmk-scene',
      geometry: 'source-byte-bound-blender-extraction',
      endpointClassification: 'compiler-classified-from-authored-object-relations',
      missingSemantics: 'explicitly-unasserted',
    },
  };
  return canonical({ ...graphCore, graphSha256: hashJson(graphCore) });
}
