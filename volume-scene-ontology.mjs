// Old scene names are input compatibility, never alternative simulation laws.
export const DEFAULT_VOLUME_SCENE = 'flame';
export const VOLUME_SCENE_ONTOLOGY = Object.freeze({
  flame: Object.freeze({
    label: 'Flame', status: 'active', authority: 'single-flame-simulator-v1', supersededBy: null,
  }),
});

export function volumeSceneReceipt(value) {
  const requested = value == null || value === '' ? DEFAULT_VOLUME_SCENE : String(value);
  const migrated = requested !== DEFAULT_VOLUME_SCENE;
  return {
    identity: 'kaminos-volume-scene-authority-v1',
    requested,
    effective: DEFAULT_VOLUME_SCENE,
    ...VOLUME_SCENE_ONTOLOGY.flame,
    migrated,
    migrationNote: migrated ? `Simulation mode ${requested} migrated to the single Flame simulator; saved parameter values are retained.` : null,
    fallbackReason: null,
  };
}

export function normalizeVolumeScene() { return DEFAULT_VOLUME_SCENE; }
