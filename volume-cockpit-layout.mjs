export const VOLUME_COCKPIT_CONTROL_ROOT_IDS = Object.freeze([
  'volume-primary-control-root',
  'volume-authored-mix-control-root',
]);

export const VOLUME_AUTHORED_MIX_CONTROL_IDS = Object.freeze([
  'volume-reaction-boundary-support-thermal',
]);

const VOLUME_CONTROL_SELECTOR = [
  'input[id^="volume-"]',
  'select[id^="volume-"]',
  'textarea[id^="volume-"]',
].join(', ');

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function normalizedControlRecord(record) {
  return {
    id: String(record?.id || ''),
    tagName: String(record?.tagName || '').toUpperCase(),
    type: String(record?.type || '').toLowerCase(),
    rootId: String(record?.rootId || ''),
  };
}

export function validateVolumeCockpitControlInventory({ schema, controlRecords }) {
  if (schema?.identity !== 'kaminos-volume-settings-preset-schema-v2'
    || !Array.isArray(schema.controls)
    || Number(schema.controlCount) !== schema.controls.length) {
    throw new Error('volume-cockpit-schema-invalid');
  }
  if (!Array.isArray(controlRecords)) throw new Error('volume-cockpit-control-records-missing');

  const expectedById = new Map(schema.controls.map(control => [control.key, normalizedControlRecord({
    id: control.key,
    tagName: control.tagName,
    type: control.type,
  })]));
  const records = controlRecords.map(normalizedControlRecord);
  const actualById = new Map();
  const rootControlCounts = Object.fromEntries(VOLUME_COCKPIT_CONTROL_ROOT_IDS.map(rootId => [rootId, 0]));
  const invalidRootIds = [];

  for (const record of records) {
    const entries = actualById.get(record.id) || [];
    entries.push(record);
    actualById.set(record.id, entries);
    if (Object.hasOwn(rootControlCounts, record.rootId)) rootControlCounts[record.rootId] += 1;
    else invalidRootIds.push(`${record.id}:${record.rootId || 'missing'}`);
  }

  const missingControlIds = sortedUnique([...expectedById.keys()].filter(id => !actualById.has(id)));
  const unexpectedControlIds = sortedUnique([...actualById.keys()].filter(id => !expectedById.has(id)));
  const duplicateControlIds = sortedUnique([...actualById.entries()]
    .filter(([, entries]) => entries.length !== 1)
    .map(([id]) => id));
  const typeSubstitutions = [];
  for (const [id, expected] of expectedById) {
    const actual = actualById.get(id)?.[0];
    if (!actual || actualById.get(id).length !== 1) continue;
    if (actual.tagName !== expected.tagName || actual.type !== expected.type) {
      typeSubstitutions.push(`${id}:${expected.tagName}/${expected.type}->${actual.tagName}/${actual.type}`);
    }
  }
  const misplacedAuthoredMixControls = VOLUME_AUTHORED_MIX_CONTROL_IDS.filter(id => {
    const actual = actualById.get(id)?.[0];
    return actual && actual.rootId !== 'volume-authored-mix-control-root';
  });

  const failures = [];
  if (missingControlIds.length) failures.push(`missing=${missingControlIds.join(',')}`);
  if (unexpectedControlIds.length) failures.push(`unexpected=${unexpectedControlIds.join(',')}`);
  if (duplicateControlIds.length) failures.push(`duplicate=${duplicateControlIds.join(',')}`);
  if (typeSubstitutions.length) failures.push(`type=${typeSubstitutions.join(',')}`);
  if (invalidRootIds.length) failures.push(`root=${invalidRootIds.join(',')}`);
  if (misplacedAuthoredMixControls.length) failures.push(`authored-mix-root=${misplacedAuthoredMixControls.join(',')}`);
  if (records.length !== Number(schema.controlCount)) failures.push(`count=${records.length}/${schema.controlCount}`);
  if (failures.length) throw new Error(`volume-cockpit-control-inventory-invalid:${failures.join(';')}`);

  return {
    identity: 'kaminos-volume-cockpit-layout-receipt-v0',
    schemaIdentity: schema.identity,
    controlCount: records.length,
    expectedControlCount: Number(schema.controlCount),
    controlRootIds: [...VOLUME_COCKPIT_CONTROL_ROOT_IDS],
    rootControlCounts,
    authoredMixControlIds: [...VOLUME_AUTHORED_MIX_CONTROL_IDS],
    missingControlIds,
    unexpectedControlIds,
    duplicateControlIds,
    typeSubstitutions,
    fallbackApplied: false,
  };
}

export function collectVolumeCockpitControlElements(documentRef) {
  const elements = [];
  for (const rootId of VOLUME_COCKPIT_CONTROL_ROOT_IDS) {
    const root = documentRef.getElementById(rootId);
    if (!root) throw new Error(`volume-cockpit-control-root-missing:${rootId}`);
    elements.push(...root.querySelectorAll(VOLUME_CONTROL_SELECTOR));
  }
  return elements;
}

function moveAuthoredMixControl(documentRef, controlId) {
  const control = documentRef.getElementById(controlId);
  const target = documentRef.getElementById('volume-authored-mix-control-root');
  if (!control) throw new Error(`volume-cockpit-authored-mix-control-missing:${controlId}`);
  if (!target) throw new Error('volume-cockpit-control-root-missing:volume-authored-mix-control-root');
  const row = control.closest('.slider-row');
  if (!row) throw new Error(`volume-cockpit-authored-mix-row-missing:${controlId}`);
  row.dataset.volumeCockpitControlId = controlId;
  target.append(row);
}

function installPanelToggle(documentRef) {
  const panel = documentRef.getElementById('volume-authored-mix-panel');
  const toggle = documentRef.getElementById('volume-authored-mix-toggle');
  if (!panel || !toggle) throw new Error('volume-cockpit-panel-controls-missing');
  const setCollapsed = collapsed => {
    panel.dataset.collapsed = collapsed ? 'true' : 'false';
    toggle.textContent = collapsed ? '<' : '>';
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.title = collapsed ? 'Expand authored mix controls' : 'Collapse authored mix controls';
  };
  toggle.addEventListener('click', () => setCollapsed(panel.dataset.collapsed !== 'true'));
  setCollapsed(panel.dataset.collapsed === 'true');
}

export async function initializeVolumeCockpitLayout({
  documentRef = document,
  fetchImpl = fetch,
  schemaUrl = '/volume-settings-preset-schema-v2.json',
} = {}) {
  const response = await fetchImpl(schemaUrl, { cache: 'no-store' });
  if (!response?.ok) throw new Error(`volume-cockpit-schema-fetch-failed:${response?.status || 'unknown'}`);
  const schema = await response.json();
  for (const controlId of VOLUME_AUTHORED_MIX_CONTROL_IDS) moveAuthoredMixControl(documentRef, controlId);
  installPanelToggle(documentRef);
  const controlRecords = collectVolumeCockpitControlElements(documentRef).map(control => ({
    id: control.id,
    tagName: control.tagName,
    type: control.type || control.tagName.toLowerCase(),
    rootId: control.closest('[data-volume-control-root]')?.id || '',
  }));
  const receipt = validateVolumeCockpitControlInventory({ schema, controlRecords });
  const panel = documentRef.getElementById('volume-authored-mix-panel');
  panel.dataset.cockpitStatus = 'validated';
  panel.dataset.controlCount = String(receipt.controlCount);
  return receipt;
}
