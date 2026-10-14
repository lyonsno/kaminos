const RETIRED_AXES = Object.freeze({
  domControls: 'controlCount',
  rendererControls: 'rendererControlCount',
  presentationControls: 'presentationControlCount',
});

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function sameDescriptor(entry, retired) {
  return entry?.id === retired.key
    && entry?.param === retired.param
    && String(entry?.tagName || '').toUpperCase() === String(retired.tagName || '').toUpperCase()
    && String(entry?.type || '').toLowerCase() === String(retired.type || '').toLowerCase();
}

function validateSourceCounts(documentValue, preset) {
  for (const [axis, countField] of Object.entries(RETIRED_AXES)) {
    const inventory = preset[axis];
    if (inventory === undefined) continue;
    if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
      throw new Error(`source ${axis} inventory is invalid`);
    }
    const declaredCount = Number(preset[countField]);
    if (!Number.isSafeInteger(declaredCount) || declaredCount !== Object.keys(inventory).length) {
      throw new Error(`source ${axis} count does not match its inventory`);
    }
  }
  if (documentValue?.controlCount !== undefined
    && preset.controlCount !== undefined
    && Number(documentValue.controlCount) !== Number(preset.controlCount)) {
    throw new Error('source artifact control count does not match its preset');
  }
}

export function validateRetiredVolumeControlInventory(schema) {
  const retiredControls = schema?.retiredControls || [];
  if (!Array.isArray(retiredControls)) throw new Error('retired control inventory is invalid');
  const activeControls = [
    ...(schema?.controls || []),
    ...(schema?.rendererControls || []),
    ...(schema?.presentationControls || []),
  ];
  const activeKeys = new Set(activeControls.map(control => control.key));
  const activeParams = new Set(activeControls.map(control => control.param));
  const keys = new Set();
  const params = new Set();
  for (const retired of retiredControls) {
    if (!retired || !Object.hasOwn(RETIRED_AXES, retired.axis)
      || typeof retired.key !== 'string' || !retired.key
      || typeof retired.param !== 'string' || !retired.param.startsWith('volume_')
      || typeof retired.tagName !== 'string' || !retired.tagName
      || typeof retired.type !== 'string' || !retired.type) {
      throw new Error('retired control descriptor is invalid');
    }
    if (keys.has(retired.key) || params.has(retired.param)
      || activeKeys.has(retired.key) || activeParams.has(retired.param)) {
      throw new Error(`retired control inventory conflicts with active or retired control: ${retired.key}`);
    }
    keys.add(retired.key);
    params.add(retired.param);
  }
  return retiredControls;
}

export function migrateRetiredVolumeSettingsPresetDocument(documentValue, schema) {
  const retiredControls = validateRetiredVolumeControlInventory(schema);
  const migrated = clone(documentValue);
  const preset = migrated?.preset;
  if (!preset || typeof preset !== 'object') {
    return {
      document: migrated,
      removedControlIds: [],
      removedRouteParams: [],
      addedControlIds: [],
      addedRouteParams: [],
      applied: false,
    };
  }
  validateSourceCounts(documentValue, documentValue.preset);
  const route = new URL(preset.route || '/', 'http://kaminos.invalid/');
  const removedControlIds = [];
  const removedRouteParams = [];
  const addedControlIds = [];
  const addedRouteParams = [];
  const changedAxes = new Set();
  for (const retired of retiredControls) {
    const axis = preset[retired.axis];
    const entry = axis && typeof axis === 'object' && !Array.isArray(axis) ? axis[retired.key] : undefined;
    if (entry === undefined) continue;
    if (!sameDescriptor(entry, retired)) {
      throw new Error(`retired control descriptor mismatch for ${retired.key}`);
    }
    const routeValues = route.searchParams.getAll(retired.param);
    const expectedValue = String(Object.hasOwn(entry, 'rawValue') ? entry.rawValue : (entry.value ?? ''));
    if (routeValues.length !== 1 || routeValues[0] !== expectedValue) {
      throw new Error(`retired control route mismatch for ${retired.param}`);
    }
    delete axis[retired.key];
    route.searchParams.delete(retired.param);
    removedControlIds.push(retired.key);
    removedRouteParams.push(retired.param);
    changedAxes.add(retired.axis);
  }
  for (const axis of changedAxes) {
    const countField = RETIRED_AXES[axis];
    preset[countField] = Object.keys(preset[axis]).length;
  }
  if (changedAxes.has('domControls') && migrated.controlCount !== undefined) {
    migrated.controlCount = preset.controlCount;
  }
  // A named pre-composition branch added these controls before main's later
  // additions. Recognize its exact inventory, not its count alone; retain its
  // authored values while walking the canonical main additions in order.
  const branchControls = new Set();
  const sourceKeys = Object.keys(preset.domControls || {});
  for (const branch of schema.additiveBranches || []) {
    const base = (schema.controls || []).filter(c => !Number.isSafeInteger(Number(c.additiveSinceControlCount))
      || Number(c.additiveSinceControlCount) <= branch.baseControlCount).map(c => c.key);
    const n = sourceKeys.length - branch.baseControlCount;
    const additions = branch.controlIds?.slice(0, n) || [];
    if (n < 1 || n > branch.controlIds?.length || base.length !== branch.baseControlCount) continue;
    const expected = new Set([...base, ...additions]);
    if (sourceKeys.length !== expected.size || sourceKeys.some(key => !expected.has(key))) continue;
    for (const key of additions) {
      const control = schema.controls.find(c => c.key === key), entry = preset.domControls[key];
      if (!control || !sameDescriptor(entry, control)) throw new Error(`additive branch descriptor mismatch for ${key}`);
      const values = route.searchParams.getAll(control.param);
      const value = String(Object.hasOwn(entry, 'rawValue') ? entry.rawValue : (entry.value ?? ''));
      if (values.length !== 1 || values[0] !== value) throw new Error(`additive branch route mismatch for ${key}`);
      branchControls.add(key);
    }
  }
  for (const control of schema.controls || []) {
    const introducedAt = Number(control.additiveSinceControlCount);
    if (!Number.isSafeInteger(introducedAt)) continue;
    if (!Object.hasOwn(control, 'additiveDefault')) {
      throw new Error(`additive control is missing its default: ${control.key}`);
    }
    if (branchControls.has(control.key)) continue;
    const activeCount = Object.keys(preset.domControls || {}).length - branchControls.size;
    if (activeCount >= introducedAt) continue;
    if (activeCount !== introducedAt - 1) {
      throw new Error(`settings preset cannot bridge additive control history at ${control.key}`);
    }
    if (Object.hasOwn(preset.domControls, control.key)) {
      throw new Error(`settings preset carries additive control before its declared schema count: ${control.key}`);
    }
    if (route.searchParams.has(control.param)) {
      throw new Error(`settings preset routes additive control without its descriptor: ${control.param}`);
    }
    preset.domControls[control.key] = {
      id: control.key,
      param: control.param,
      tagName: control.tagName,
      type: control.type,
      value: control.additiveDefault,
    };
    route.searchParams.set(control.param, String(control.additiveDefault));
    addedControlIds.push(control.key);
    addedRouteParams.push(control.param);
  }
  if (addedControlIds.length) {
    preset.controlCount = Object.keys(preset.domControls).length;
    if (migrated.controlCount !== undefined) migrated.controlCount = preset.controlCount;
  }
  preset.route = route.href;
  return {
    document: migrated,
    removedControlIds,
    removedRouteParams,
    addedControlIds,
    addedRouteParams,
    applied: removedControlIds.length > 0 || addedControlIds.length > 0,
  };
}

export function migrateRetiredVolumeCockpitLayoutDocument(documentValue, retiredControls = []) {
  const validated = validateRetiredVolumeControlInventory({ retiredControls });
  const retiredIds = new Set(validated.map(control => control.key));
  const migrated = clone(documentValue);
  const removedControlIds = [];
  for (const group of migrated?.groups || []) {
    if (!Array.isArray(group?.controlIds)) continue;
    group.controlIds = group.controlIds.filter(controlId => {
      if (!retiredIds.has(controlId)) return true;
      removedControlIds.push(controlId);
      return false;
    });
  }
  return {
    document: migrated,
    removedControlIds: [...new Set(removedControlIds)].sort(),
    applied: removedControlIds.length > 0,
  };
}
