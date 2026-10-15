// Producer callbacks stay out of serializable userData and the draw/clone path.
const snapshots = new WeakMap();
export function registerExportGeometrySnapshot(object, snapshot) {
  snapshots.set(object, snapshot);
}

// Call only on a structure-preserving hierarchy clone, before removing helpers.
// The export owns a copy independent of the producer's invalidatable CPU cache.
export function snapshotExportGeometry(source, clone) {
  const snapshot = snapshots.get(source);
  if (snapshot) clone.geometry = snapshot().clone();
  for (let i = 0; i < source.children.length; i++) snapshotExportGeometry(source.children[i], clone.children[i]);
}
