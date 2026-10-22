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
  const dynamicsChanged = migrated && requested !== 'tall_plume';
  return {
    identity: 'kaminos-volume-scene-authority-v1',
    requested,
    effective: DEFAULT_VOLUME_SCENE,
    ...VOLUME_SCENE_ONTOLOGY.flame,
    migrated,
    dynamicsChanged,
    migrationNote: migrated ? (dynamicsChanged
      ? `Simulation mode ${requested} retired; retained parameter values now run under Flame dynamics.`
      : 'Simulation mode tall_plume renamed to Flame; saved parameter values are retained.') : null,
    fallbackReason: null,
  };
}

export function normalizeVolumeScene() { return DEFAULT_VOLUME_SCENE; }
