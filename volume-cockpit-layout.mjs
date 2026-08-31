export const VOLUME_COCKPIT_CONTROL_ROOT_IDS = Object.freeze([
  'volume-primary-control-root',
  'volume-authored-mix-control-root',
]);

export const VOLUME_AUTHORED_MIX_CONTROL_IDS = Object.freeze([
  'volume-reaction-boundary-support-thermal',
]);

export const VOLUME_COCKPIT_LAYOUT_IDENTITY = 'kaminos.volume.cockpit-layout.v1';

const VOLUME_CONTROL_SELECTOR = [
  'input[id^="volume-"]',
  'select[id^="volume-"]',
  'textarea[id^="volume-"]',
  'select[data-volume-assay-control="emitter-family"]',
].join(', ');

const LAYOUT_API = '/api/volume-cockpit-layouts';
const LAYOUT_SURFACES = new Set(['primary', 'authored-mix']);
const SAFE_ID = /^[a-z0-9](?:[a-z0-9._-]{0,95})$/;

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function cloneDocument(documentValue) {
  return JSON.parse(JSON.stringify(documentValue));
}

function slug(value, fallback = 'layout') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 96);
  return normalized || fallback;
}

function normalizedControlRecord(record) {
  return {
    id: String(record?.id || ''),
    tagName: String(record?.tagName || '').toUpperCase(),
    type: String(record?.type || '').toLowerCase(),
    rootId: String(record?.rootId || ''),
  };
}

export function validateVolumeCockpitLayoutDocument({ document: documentValue, authorableControlIds }) {
  if (!documentValue || typeof documentValue !== 'object' || Array.isArray(documentValue)) {
    throw new Error('volume-cockpit-layout-document-missing');
  }
  if (documentValue.identity !== VOLUME_COCKPIT_LAYOUT_IDENTITY) {
    throw new Error('volume-cockpit-layout-identity-invalid');
  }
  if (!SAFE_ID.test(String(documentValue.layoutId || ''))) {
    throw new Error('volume-cockpit-layout-id-invalid');
  }
  if (!String(documentValue.label || '').trim()) {
    throw new Error('volume-cockpit-layout-label-missing');
  }
  if (!Array.isArray(documentValue.groups) || !documentValue.groups.length) {
    throw new Error('volume-cockpit-layout-groups-missing');
  }
  if (!Array.isArray(authorableControlIds) || !authorableControlIds.length) {
    throw new Error('volume-cockpit-layout-authorable-inventory-missing');
  }

  const expected = new Set(authorableControlIds.map(String));
  if (expected.size !== authorableControlIds.length) {
    throw new Error('volume-cockpit-layout-authorable-inventory-duplicate');
  }
  const groupIds = new Set();
  const placed = new Set();
  const duplicateControlIds = [];
  const unknownControlIds = [];
  for (const group of documentValue.groups) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) {
      throw new Error('volume-cockpit-layout-group-invalid');
    }
    if (!SAFE_ID.test(String(group.id || ''))) throw new Error('volume-cockpit-layout-group-id-invalid');
    if (groupIds.has(group.id)) throw new Error(`volume-cockpit-layout-duplicate-group:${group.id}`);
    groupIds.add(group.id);
    if (!String(group.label || '').trim()) throw new Error(`volume-cockpit-layout-group-label-missing:${group.id}`);
    if (!LAYOUT_SURFACES.has(group.surface)) throw new Error(`volume-cockpit-layout-group-surface-invalid:${group.id}`);
    if (typeof group.collapsed !== 'boolean') throw new Error(`volume-cockpit-layout-group-collapse-invalid:${group.id}`);
    if (!Array.isArray(group.controlIds)) throw new Error(`volume-cockpit-layout-group-controls-invalid:${group.id}`);
    for (const controlId of group.controlIds) {
      if (typeof controlId !== 'string' || !controlId) {
        throw new Error(`volume-cockpit-layout-control-id-invalid:${group.id}`);
      }
      if (!expected.has(controlId)) unknownControlIds.push(controlId);
      if (placed.has(controlId)) duplicateControlIds.push(controlId);
      placed.add(controlId);
    }
  }
  if (unknownControlIds.length) {
    throw new Error(`volume-cockpit-layout-unknown-control:${sortedUnique(unknownControlIds).join(',')}`);
  }
  if (duplicateControlIds.length) {
    throw new Error(`volume-cockpit-layout-duplicate-control:${sortedUnique(duplicateControlIds).join(',')}`);
  }
  const missingControlIds = authorableControlIds.filter(controlId => !placed.has(controlId));
  return {
    identity: VOLUME_COCKPIT_LAYOUT_IDENTITY,
    layoutId: documentValue.layoutId,
    label: documentValue.label,
    groupCount: documentValue.groups.length,
    controlCount: placed.size,
    expectedControlCount: authorableControlIds.length,
    missingControlIds,
    fallbackApplied: false,
  };
}

export function reconcileVolumeCockpitLayoutDocument({ document: documentValue, authorableControlIds }) {
  const receipt = validateVolumeCockpitLayoutDocument({ document: documentValue, authorableControlIds });
  const reconciled = cloneDocument(documentValue);
  if (receipt.missingControlIds.length) {
    let newControls = reconciled.groups.find(group => group.id === 'new-controls');
    if (!newControls) {
      newControls = {
        id: 'new-controls',
        label: 'New controls',
        surface: 'primary',
        collapsed: false,
        controlIds: [],
      };
      reconciled.groups.push(newControls);
    }
    newControls.controlIds.push(...receipt.missingControlIds);
  }
  const effectiveReceipt = validateVolumeCockpitLayoutDocument({
    document: reconciled,
    authorableControlIds,
  });
  return {
    identity: 'kaminos.volume.cockpit-layout-reconciliation.v1',
    document: reconciled,
    newControlIds: receipt.missingControlIds,
    effectiveReceipt,
  };
}

export function validateVolumeCockpitControlInventory({ schema, controlRecords }) {
  if (schema?.identity !== 'kaminos-volume-settings-preset-schema-v2'
    || !Array.isArray(schema.controls)
    || Number(schema.controlCount) !== schema.controls.length
    || !Array.isArray(schema.rendererControls)) {
    throw new Error('volume-cockpit-schema-invalid');
  }
  if (!Array.isArray(controlRecords)) throw new Error('volume-cockpit-control-records-missing');

  const expectedControls = [...schema.controls, ...schema.rendererControls];
  const expectedById = new Map(expectedControls.map(control => [control.key, normalizedControlRecord({
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

  const failures = [];
  if (missingControlIds.length) failures.push(`missing=${missingControlIds.join(',')}`);
  if (unexpectedControlIds.length) failures.push(`unexpected=${unexpectedControlIds.join(',')}`);
  if (duplicateControlIds.length) failures.push(`duplicate=${duplicateControlIds.join(',')}`);
  if (typeSubstitutions.length) failures.push(`type=${typeSubstitutions.join(',')}`);
  if (invalidRootIds.length) failures.push(`root=${invalidRootIds.join(',')}`);
  if (records.length !== expectedControls.length) failures.push(`count=${records.length}/${expectedControls.length}`);
  if (failures.length) throw new Error(`volume-cockpit-control-inventory-invalid:${failures.join(';')}`);

  return {
    identity: 'kaminos-volume-cockpit-layout-receipt-v0',
    schemaIdentity: schema.identity,
    controlCount: records.length,
    expectedControlCount: expectedControls.length,
    presetControlCount: Number(schema.controlCount),
    rendererControlCount: schema.rendererControls.length,
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
    elements.push(...[...root.querySelectorAll(VOLUME_CONTROL_SELECTOR)]
      .filter(control => !control.closest('[data-volume-cockpit-layout-ui]')));
  }
  return elements;
}

function isAuthorableControl(control) {
  return control.type !== 'hidden' && !control.closest('[data-volume-retired-control-state]');
}

function controlCluster(control) {
  const row = control.closest('.slider-row');
  if (!row) throw new Error(`volume-cockpit-control-row-missing:${control.id}`);
  const nodes = [row];
  const help = row.nextElementSibling;
  if (help?.classList?.contains('slider-help')) nodes.push(help);
  return nodes;
}

function moveAuthoredMixControl(documentRef, controlId) {
  const control = documentRef.getElementById(controlId);
  const target = documentRef.getElementById('volume-authored-mix-control-root');
  if (!control) throw new Error(`volume-cockpit-authored-mix-control-missing:${controlId}`);
  if (!target) throw new Error('volume-cockpit-control-root-missing:volume-authored-mix-control-root');
  for (const node of controlCluster(control)) target.append(node);
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

function sourceGroupForControl(control, looseIndex) {
  const root = control.closest('[data-volume-control-root]');
  const surface = root?.dataset.volumeControlRoot || 'primary';
  const collapsible = control.closest('[data-volume-collapsible-group]');
  if (collapsible) {
    return {
      token: `${surface}:collapsible:${collapsible.dataset.volumeCollapsibleGroup}`,
      id: slug(`${surface}-${collapsible.dataset.volumeCollapsibleGroup}`),
      label: collapsible.querySelector(':scope > summary')?.textContent?.trim() || 'Controls',
      surface,
      collapsed: !collapsible.open,
    };
  }
  const section = control.closest('[data-volume-control-section]');
  if (section) {
    return {
      token: `${surface}:section:${section.dataset.volumeControlSection}`,
      id: slug(`${surface}-${section.dataset.volumeControlSection}`),
      label: section.querySelector(':scope > .volume-control-section-title')?.textContent?.trim() || 'Controls',
      surface,
      collapsed: false,
    };
  }
  const id = surface === 'authored-mix' ? 'authored-mix-controls' : `primary-controls-${looseIndex}`;
  return {
    token: `${surface}:loose:${looseIndex}`,
    id,
    label: surface === 'authored-mix' ? 'Authored mix' : (looseIndex === 1 ? 'Controls' : `Controls ${looseIndex}`),
    surface,
    collapsed: false,
  };
}

function buildSourceDefaultLayout(authorableControls) {
  const groups = [];
  let looseIndex = 0;
  let previousContainer = null;
  let currentGroup = null;
  let currentToken = null;
  for (const control of authorableControls) {
    const container = control.closest('[data-volume-collapsible-group], [data-volume-control-section]');
    if (!container && previousContainer !== null) looseIndex += 1;
    if (!container && looseIndex === 0) looseIndex = 1;
    const candidate = sourceGroupForControl(control, looseIndex);
    if (!currentGroup || candidate.token !== currentToken) {
      const uniqueId = groups.some(group => group.id === candidate.id)
        ? `${candidate.id}-${groups.length + 1}`
        : candidate.id;
      currentGroup = { ...candidate, id: uniqueId, controlIds: [] };
      delete currentGroup.token;
      groups.push(currentGroup);
      currentToken = candidate.token;
    }
    currentGroup.controlIds.push(control.id);
    previousContainer = container;
  }
  return {
    identity: VOLUME_COCKPIT_LAYOUT_IDENTITY,
    layoutId: 'source-default',
    label: 'Source default',
    groups,
  };
}

function ensureGroupHost(documentRef, surface) {
  const rootId = surface === 'authored-mix'
    ? 'volume-authored-mix-control-root'
    : 'volume-primary-control-root';
  const root = documentRef.getElementById(rootId);
  let host = root.querySelector(':scope > .volume-layout-groups');
  if (!host) {
    host = documentRef.createElement('div');
    host.className = 'volume-layout-groups';
    host.dataset.volumeLayoutSurface = surface;
    root.append(host);
  }
  return host;
}

function groupShell(documentRef, group, actions) {
  const shell = documentRef.createElement('section');
  shell.className = 'volume-layout-group-shell';
  shell.dataset.volumeLayoutGroupId = group.id;
  shell.dataset.volumeLayoutSurface = group.surface;
  const heading = documentRef.createElement('div');
  heading.className = 'volume-layout-group-heading';
  const groupGrip = documentRef.createElement('button');
  groupGrip.type = 'button';
  groupGrip.className = 'volume-layout-group-grip';
  groupGrip.textContent = '⠿';
  groupGrip.title = 'Drag group';
  groupGrip.setAttribute('aria-label', `Drag ${group.label} group`);
  const collapse = documentRef.createElement('button');
  collapse.type = 'button';
  collapse.className = 'volume-layout-group-collapse';
  collapse.textContent = group.collapsed ? '▸' : '▾';
  collapse.title = group.collapsed ? 'Expand group' : 'Collapse group';
  const label = documentRef.createElement('input');
  label.className = 'volume-layout-group-label';
  label.value = group.label;
  label.setAttribute('aria-label', 'Group name');
  const surface = documentRef.createElement('button');
  surface.type = 'button';
  surface.className = 'volume-layout-group-surface';
  surface.textContent = group.surface === 'primary' ? 'Left' : 'Right';
  surface.title = 'Move group to the other control surface';
  const remove = documentRef.createElement('button');
  remove.type = 'button';
  remove.className = 'volume-layout-group-remove';
  remove.textContent = '×';
  remove.title = group.controlIds.length ? 'Only empty groups can be removed' : 'Remove empty group';
  remove.disabled = group.controlIds.length > 0;
  heading.append(groupGrip, collapse, label, surface, remove);
  const body = documentRef.createElement('div');
  body.className = 'volume-layout-group-body';
  body.dataset.volumeLayoutGroupId = group.id;
  body.hidden = group.collapsed;
  shell.append(heading, body);
  collapse.addEventListener('click', () => actions.collapse(group.id));
  label.addEventListener('change', () => actions.rename(group.id, label.value));
  surface.addEventListener('click', () => actions.toggleSurface(group.id));
  remove.addEventListener('click', () => actions.remove(group.id));
  actions.installGroupGrip(groupGrip, group.id);
  return { shell, body };
}

function installControlGrip(documentRef, row, controlId, actions) {
  row.dataset.volumeCockpitControlId = controlId;
  let grip = row.querySelector(':scope > .volume-layout-control-grip');
  if (!grip) {
    grip = documentRef.createElement('button');
    grip.type = 'button';
    grip.className = 'volume-layout-control-grip';
    grip.textContent = '⠿';
    grip.title = 'Drag control';
    grip.setAttribute('aria-label', `Drag ${controlId}`);
    row.prepend(grip);
  }
  actions.installControlGrip(grip, controlId);
}

function controlRecords(documentRef) {
  return collectVolumeCockpitControlElements(documentRef).map(control => ({
    id: control.id,
    tagName: control.tagName,
    type: control.type || control.tagName.toLowerCase(),
    rootId: control.closest('[data-volume-control-root]')?.id || '',
  }));
}

class VolumeCockpitLayoutEditor {
  constructor({ documentRef, schema, authorableControls, sourceDefault, fetchImpl }) {
    this.document = documentRef;
    this.schema = schema;
    this.authorableControls = authorableControls;
    this.authorableControlIds = authorableControls.map(control => control.id);
    this.sourceDefault = sourceDefault;
    this.fetch = fetchImpl;
    this.layout = null;
    this.editing = false;
    this.saveGeneration = 0;
    this.saveQueue = Promise.resolve();
    this.index = null;
    this.toolbar = this.requireToolbar();
  }

  requireToolbar() {
    const toolbar = this.document.getElementById('volume-cockpit-layout-toolbar');
    if (!toolbar) throw new Error('volume-cockpit-layout-toolbar-missing');
    const ids = [
      'volume-cockpit-layout-select', 'volume-cockpit-layout-name', 'volume-cockpit-layout-new',
      'volume-cockpit-layout-edit', 'volume-cockpit-layout-add-group', 'volume-cockpit-layout-reset',
      'volume-cockpit-layout-status',
    ];
    const controls = Object.fromEntries(ids.map(id => {
      const node = this.document.getElementById(id);
      if (!node) throw new Error(`volume-cockpit-layout-toolbar-control-missing:${id}`);
      return [id, node];
    }));
    controls['volume-cockpit-layout-edit'].addEventListener('click', () => this.setEditing(!this.editing));
    controls['volume-cockpit-layout-add-group'].addEventListener('click', () => this.addGroup());
    controls['volume-cockpit-layout-reset'].addEventListener('click', () => this.resetSourceDefault());
    controls['volume-cockpit-layout-new'].addEventListener('click', () => this.createLayout());
    controls['volume-cockpit-layout-select'].addEventListener('change', event => this.loadLayout(event.target.value));
    controls['volume-cockpit-layout-name'].addEventListener('change', event => this.renameLayout(event.target.value));
    return { root: toolbar, ...controls };
  }

  status(message, failed = false) {
    const node = this.toolbar['volume-cockpit-layout-status'];
    node.textContent = message;
    node.dataset.status = failed ? 'failed' : 'effective';
  }

  async requestJson(url, options = {}) {
    const response = await this.fetch(url, { cache: 'no-store', ...options });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || `layout store request failed: ${response.status}`);
    return payload;
  }

  async initialize() {
    this.index = await this.requestJson(LAYOUT_API);
    if (this.index.identity !== 'kaminos.volume.cockpit-layout-index.v1') {
      throw new Error('volume-cockpit-layout-index-identity-mismatch');
    }
    this.syncIndex();
    if (this.index.activeLayoutId) {
      await this.loadLayout(this.index.activeLayoutId, { saveReconciliation: true });
    } else {
      this.layout = cloneDocument(this.sourceDefault);
      this.apply();
      await this.save();
    }
    this.setEditing(false);
    return this.layout;
  }

  syncIndex() {
    const select = this.toolbar['volume-cockpit-layout-select'];
    select.replaceChildren();
    for (const entry of this.index.entries || []) {
      const option = this.document.createElement('option');
      option.value = entry.layoutId;
      option.textContent = entry.label;
      select.append(option);
    }
    select.value = this.index.activeLayoutId || '';
  }

  setEditing(editing) {
    this.editing = Boolean(editing);
    this.toolbar.root.dataset.editing = String(this.editing);
    this.document.getElementById('tab-volume')?.classList.toggle('volume-layout-editing', this.editing);
    const button = this.toolbar['volume-cockpit-layout-edit'];
    button.textContent = this.editing ? 'Done' : 'Edit layout';
    button.setAttribute('aria-pressed', String(this.editing));
  }

  actions() {
    return {
      collapse: groupId => this.updateGroup(groupId, group => { group.collapsed = !group.collapsed; }),
      rename: (groupId, label) => this.updateGroup(groupId, group => { group.label = String(label).trim() || group.label; }),
      toggleSurface: groupId => this.updateGroup(groupId, group => {
        group.surface = group.surface === 'primary' ? 'authored-mix' : 'primary';
      }),
      remove: groupId => {
        const group = this.group(groupId);
        if (group.controlIds.length) return;
        this.layout.groups = this.layout.groups.filter(candidate => candidate.id !== groupId);
        this.applyAndSave();
      },
      installControlGrip: (grip, controlId) => this.installPointerGrip(grip, { kind: 'control', id: controlId }),
      installGroupGrip: (grip, groupId) => this.installPointerGrip(grip, { kind: 'group', id: groupId }),
    };
  }

  group(groupId) {
    const group = this.layout.groups.find(candidate => candidate.id === groupId);
    if (!group) throw new Error(`volume-cockpit-layout-group-missing:${groupId}`);
    return group;
  }

  updateGroup(groupId, mutation) {
    mutation(this.group(groupId));
    this.applyAndSave();
  }

  apply() {
    const reconciled = reconcileVolumeCockpitLayoutDocument({ document: this.layout, authorableControlIds: this.authorableControlIds });
    this.layout = reconciled.document;
    const clusters = new Map(this.authorableControls.map(control => [control.id, controlCluster(control)]));
    const parking = this.document.createDocumentFragment();
    for (const nodes of clusters.values()) for (const node of nodes) parking.append(node);
    for (const host of this.document.querySelectorAll('.volume-layout-groups')) host.remove();
    const hosts = {
      primary: ensureGroupHost(this.document, 'primary'),
      'authored-mix': ensureGroupHost(this.document, 'authored-mix'),
    };
    const actions = this.actions();
    for (const group of this.layout.groups) {
      const { shell, body } = groupShell(this.document, group, actions);
      hosts[group.surface].append(shell);
      for (const controlId of group.controlIds) {
        const nodes = clusters.get(controlId);
        if (!nodes) throw new Error(`volume-cockpit-layout-control-cluster-missing:${controlId}`);
        installControlGrip(this.document, nodes[0], controlId, actions);
        for (const node of nodes) body.append(node);
      }
    }
    for (const legacy of this.document.querySelectorAll('[data-volume-control-section], [data-volume-collapsible-group]')) {
      if (!legacy.querySelector(VOLUME_CONTROL_SELECTOR)) legacy.hidden = true;
    }
    this.toolbar['volume-cockpit-layout-name'].value = this.layout.label;
    this.toolbar['volume-cockpit-layout-select'].value = this.layout.layoutId;
  }

  installPointerGrip(grip, item) {
    grip.onpointerdown = event => {
      if (!this.editing || event.button !== 0) return;
      event.preventDefault();
      grip.setPointerCapture?.(event.pointerId);
      const dragged = item.kind === 'control'
        ? this.document.querySelector(`[data-volume-cockpit-control-id="${CSS.escape(item.id)}"]`)
        : this.document.querySelector(`[data-volume-layout-group-id="${CSS.escape(item.id)}"]`);
      dragged?.classList.add('volume-layout-dragging');
      let target = null;
      const move = moveEvent => {
        const pointed = this.document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
        if (!pointed) return;
        const scrollHost = pointed.closest('#sidebar, #volume-authored-mix-body');
        const bounds = scrollHost?.getBoundingClientRect();
        if (bounds && moveEvent.clientY < bounds.top + 36) scrollHost.scrollBy(0, -14);
        if (bounds && moveEvent.clientY > bounds.bottom - 36) scrollHost.scrollBy(0, 14);
        if (item.kind === 'control') {
          const row = pointed.closest('.slider-row[data-volume-cockpit-control-id]');
          const body = pointed.closest('.volume-layout-group-body');
          if (body) target = { groupId: body.dataset.volumeLayoutGroupId, beforeId: row?.dataset.volumeCockpitControlId || null };
        } else {
          const shell = pointed.closest('.volume-layout-group-shell');
          if (shell) target = { beforeGroupId: shell.dataset.volumeLayoutGroupId };
        }
      };
      const finish = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', finish);
        grip.removeEventListener('pointercancel', finish);
        dragged?.classList.remove('volume-layout-dragging');
        if (!target) return;
        if (item.kind === 'control') this.moveControl(item.id, target.groupId, target.beforeId);
        else this.moveGroup(item.id, target.beforeGroupId);
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', finish);
      grip.addEventListener('pointercancel', finish);
    };
  }

  moveControl(controlId, targetGroupId, beforeId) {
    for (const group of this.layout.groups) group.controlIds = group.controlIds.filter(id => id !== controlId);
    const target = this.group(targetGroupId);
    const index = beforeId ? target.controlIds.indexOf(beforeId) : -1;
    if (index >= 0) target.controlIds.splice(index, 0, controlId);
    else target.controlIds.push(controlId);
    this.applyAndSave();
  }

  moveGroup(groupId, beforeGroupId) {
    if (groupId === beforeGroupId) return;
    const group = this.group(groupId);
    const before = this.group(beforeGroupId);
    if (group.surface !== before.surface) group.surface = before.surface;
    this.layout.groups = this.layout.groups.filter(candidate => candidate.id !== groupId);
    const index = this.layout.groups.findIndex(candidate => candidate.id === beforeGroupId);
    this.layout.groups.splice(index < 0 ? this.layout.groups.length : index, 0, group);
    this.applyAndSave();
  }

  addGroup() {
    let index = this.layout.groups.length + 1;
    let id = `group-${index}`;
    while (this.layout.groups.some(group => group.id === id)) id = `group-${++index}`;
    this.layout.groups.push({ id, label: 'Untitled group', surface: 'primary', collapsed: false, controlIds: [] });
    this.applyAndSave();
    this.setEditing(true);
    const input = this.document.querySelector(`[data-volume-layout-group-id="${CSS.escape(id)}"] .volume-layout-group-label`);
    input?.focus();
    input?.select();
  }

  async createLayout() {
    const copy = cloneDocument(this.sourceDefault);
    copy.layoutId = `layout-${Date.now().toString(36)}`;
    copy.label = 'New layout';
    this.layout = copy;
    this.apply();
    await this.save();
    this.setEditing(true);
    this.toolbar['volume-cockpit-layout-name'].focus();
    this.toolbar['volume-cockpit-layout-name'].select();
  }

  async loadLayout(layoutId, { saveReconciliation = false } = {}) {
    if (!layoutId) return;
    await this.saveQueue;
    this.status(`loading ${layoutId}…`);
    const artifact = await this.requestJson(`/api/volume-cockpit-layout?id=${encodeURIComponent(layoutId)}`);
    const reconciled = reconcileVolumeCockpitLayoutDocument({ document: artifact.layout, authorableControlIds: this.authorableControlIds });
    this.layout = reconciled.document;
    this.apply();
    if (saveReconciliation && reconciled.newControlIds.length) await this.save();
    else this.status(`${this.layout.label} loaded`);
  }

  renameLayout(label) {
    const normalized = String(label || '').trim();
    if (!normalized) {
      this.toolbar['volume-cockpit-layout-name'].value = this.layout.label;
      return;
    }
    this.layout.label = normalized;
    this.applyAndSave();
  }

  resetSourceDefault() {
    const layoutId = this.layout.layoutId;
    const label = this.layout.label;
    this.layout = { ...cloneDocument(this.sourceDefault), layoutId, label };
    this.applyAndSave();
  }

  applyAndSave() {
    this.apply();
    this.save().catch(error => this.status(`save failed: ${error.message || error}`, true));
  }

  async save() {
    const generation = ++this.saveGeneration;
    validateVolumeCockpitLayoutDocument({ document: this.layout, authorableControlIds: this.authorableControlIds });
    const layout = cloneDocument(this.layout);
    this.status('saving layout…');
    const write = async () => {
      const receipt = await this.requestJson(LAYOUT_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout, activate: true }),
      });
      if (receipt.identity !== 'kaminos.volume.cockpit-layout-write-receipt.v1') {
        throw new Error('volume-cockpit-layout-write-receipt-identity-mismatch');
      }
      if (generation !== this.saveGeneration) return receipt;
      this.index = await this.requestJson(LAYOUT_API);
      this.syncIndex();
      this.status(`${this.layout.label} saved`);
      return receipt;
    };
    const queued = this.saveQueue.then(write, write);
    this.saveQueue = queued.catch(() => {});
    return queued;
  }
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
  const allControls = collectVolumeCockpitControlElements(documentRef);
  const authorableControls = allControls.filter(isAuthorableControl);
  const sourceDefault = buildSourceDefaultLayout(authorableControls);
  const editor = new VolumeCockpitLayoutEditor({ documentRef, schema, authorableControls, sourceDefault, fetchImpl });
  await editor.initialize();
  const receipt = validateVolumeCockpitControlInventory({ schema, controlRecords: controlRecords(documentRef) });
  const panel = documentRef.getElementById('volume-authored-mix-panel');
  panel.dataset.cockpitStatus = 'validated';
  panel.dataset.controlCount = String(receipt.controlCount);
  globalThis.__kaminosVolumeCockpitLayoutEditor = editor;
  return {
    ...receipt,
    layoutIdentity: editor.layout.identity,
    layoutId: editor.layout.layoutId,
    layoutLabel: editor.layout.label,
    layoutStorePath: editor.index.storePath,
    authorableControlCount: authorableControls.length,
  };
}
