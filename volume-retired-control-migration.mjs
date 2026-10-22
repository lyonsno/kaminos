const RETIRED_AXES = Object.freeze({
  domControls: 'controlCount',
  rendererControls: 'rendererControlCount',
  presentationControls: 'presentationControlCount',
});

// The procedural-force switches were retired 2026-10-22: Microdetail and Shred
// are their own switches (0 is off) and Fine breakup became Swirl jostle. A
// switch that was off moves onto its slider as 0, so a saved basin keeps the
// forces it had. `switches` holds the retired switch values the record carried.
const FORCE_SWITCH_TRANSFERS = Object.freeze([
  Object.freeze({ switchKey: 'volume-force-micro-carrier', sliderKey: 'volume-microdetail' }),
  Object.freeze({ switchKey: 'volume-force-interface-shred', sliderKey: 'volume-interface-shred' }),
  Object.freeze({ switchKey: 'volume-force-fine-breakup', sliderKey: 'volume-swirl-jostle' }),
]);
const switchOff = value => value === false || value === 'false' || value === 0 || value === '0';
export function transferRetiredForceSwitches(switches, domControls, route = null, params = {}) {
  const masterOff = switchOff(switches['volume-procedural-detail-forces']);
  const zeroed = [];
  for (const { switchKey, sliderKey } of FORCE_SWITCH_TRANSFERS) {
    if (!(masterOff || switchOff(switches[switchKey]))) continue;
    const entry = domControls?.[sliderKey];
    if (!entry) continue;
    entry.value = 0;
    if (Object.hasOwn(entry, 'rawValue')) entry.rawValue = '0';
    if (route && params[sliderKey]) route.searchParams.set(params[sliderKey], '0');
    zeroed.push(sliderKey);
  }
  return zeroed;
}

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
  // Additive history is numbered by the inventory size at the time each control
  // was introduced. A retired control still counts toward that history: a
  // document saved with it keeps its place in the sequence after the control is
  // stripped, so a large retirement (2026-10-18: the legacy material laws'
  // controls) does not break the bridge to later additive controls.
  let retiredDomControlsPresent = 0;
  const retiredSwitchValues = {};
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
    if (retired.axis === 'domControls') retiredSwitchValues[retired.key] = Object.hasOwn(entry, 'rawValue') ? entry.rawValue : entry.value;
    delete axis[retired.key];
    route.searchParams.delete(retired.param);
    if (retired.axis === 'domControls') retiredDomControlsPresent += 1;
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
  const savedDomControlCount = Object.keys(preset.domControls || {}).length + retiredDomControlsPresent;
  // A record that still carries a control introduced later cannot be missing
  // one introduced earlier: that is a hole in a current record, not history.
  const latestPresentIntroducedAt = Math.max(0, ...(schema.controls || [])
    .filter(control => Number.isSafeInteger(Number(control.additiveSinceControlCount)) && Object.hasOwn(preset.domControls || {}, control.key))
    .map(control => Number(control.additiveSinceControlCount)));
  for (const control of schema.controls || []) {
    const introducedAt = Number(control.additiveSinceControlCount);
    if (!Number.isSafeInteger(introducedAt)) continue;
    if (!Object.hasOwn(control, 'additiveDefault')) {
      throw new Error(`additive control is missing its default: ${control.key}`);
    }
    // The inventory size the record was saved with, retired controls included:
    // every additive control introduced after it takes its declared default;
    // one introduced before it and still missing is a hole, not history.
    if (Object.hasOwn(preset.domControls, control.key)) continue;
    if (savedDomControlCount >= introducedAt || introducedAt < latestPresentIntroducedAt) {
      throw new Error(`settings preset cannot bridge additive control history at ${control.key}`);
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
  const sliderParams = Object.fromEntries((schema.controls || []).map(control => [control.key, control.param]));
  const zeroedByRetiredSwitches = transferRetiredForceSwitches(retiredSwitchValues, preset.domControls, route, sliderParams);
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
    zeroedByRetiredSwitches,
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
