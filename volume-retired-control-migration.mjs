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
    return { document: migrated, removedControlIds: [], removedRouteParams: [], applied: false };
  }
  const route = new URL(preset.route || '/', 'http://kaminos.invalid/');
  const removedControlIds = [];
  const removedRouteParams = [];
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
  }
  for (const [axis, countField] of Object.entries(RETIRED_AXES)) {
    if (preset[axis] !== undefined) preset[countField] = Object.keys(preset[axis] || {}).length;
  }
  if (migrated.controlCount !== undefined) migrated.controlCount = preset.controlCount;
  preset.route = route.href;
  return {
    document: migrated,
    removedControlIds,
    removedRouteParams,
    applied: removedControlIds.length > 0,
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
