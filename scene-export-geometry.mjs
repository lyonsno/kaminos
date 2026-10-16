// Producer callbacks stay out of serializable userData and the draw/clone path.
const snapshots = new WeakMap();
export function registerExportGeometrySnapshot(object, snapshot) {
  snapshots.set(object, snapshot);
}
// Explicit CPU consumers (export and current-content framing) share the same
// posed source. Merely drawing or selecting a mesh does not request this solve.
export function currentGeometrySnapshot(object) {
  return snapshots.get(object)?.();
}

// Call only on a structure-preserving hierarchy clone, before removing helpers.
// The export owns a copy independent of the producer's invalidatable CPU cache.
export function snapshotExportGeometry(source, clone) {
  const snapshot = snapshots.get(source);
  if (snapshot) clone.geometry = snapshot().clone();
  for (let i = 0; i < source.children.length; i++) snapshotExportGeometry(source.children[i], clone.children[i]);
}
