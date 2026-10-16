// The scene outliner's tree, as data. Simulation fields own their emitters,
// groups own their members, everything else sits at the root. Each object
// appears once; a collapsed parent hides its descendants. Rendering and
// selection stay with their owners.

/** Ordered outline rows: {kind, id, depth, parentKey, childCount, key}. */
export function buildSceneOutline({fields = [], groups = [], objects = [], emitterFields = {}}) {
  const rows = [];
  const placed = new Set();
  const present = new Set(objects.map(object => object.id));
  const groupOf = new Map();
  for (const group of groups) for (const id of group.objectIds || []) if (present.has(id) && !groupOf.has(id)) groupOf.set(id, group.id);
  const fieldIds = new Set(fields.map(field => field.id));
  const fieldOf = object => (!groupOf.has(object.id) && fieldIds.has(emitterFields[object.type])) ? emitterFields[object.type] : null;
  const push = (kind, id, depth, parentKey, childCount = 0) => rows.push({kind, id, depth, parentKey, childCount, key: `${kind}:${id}`});

  for (const field of fields) {
    const children = objects.filter(object => fieldOf(object) === field.id);
    push('field', field.id, 0, null, children.length);
    for (const object of children) { push('object', object.id, 1, `field:${field.id}`); placed.add(object.id); }
  }
  for (const group of groups) {
    const members = (group.objectIds || []).filter(id => present.has(id) && groupOf.get(id) === group.id && !placed.has(id));
    push('group', group.id, 0, null, members.length);
    for (const id of members) { push('object', id, 1, `group:${group.id}`); placed.add(id); }
  }
  for (const object of objects) if (!placed.has(object.id)) { push('object', object.id, 0, null); placed.add(object.id); }
  return rows;
}

/** Rows to show under a set of collapsed parent keys, each marked collapsed or not. */
export function visibleOutlineRows(rows, collapsed = new Set()) {
  const hidden = new Set();
  const visible = [];
  for (const row of rows) {
    if (row.parentKey && (hidden.has(row.parentKey) || collapsed.has(row.parentKey))) { hidden.add(row.key); continue; }
    visible.push({...row, collapsed: collapsed.has(row.key)});
  }
  return visible;
}
