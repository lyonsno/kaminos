export const DEFAULT_VOLUME_SCENE = 'tall_plume';

export const VOLUME_SCENE_ONTOLOGY = Object.freeze({
  tall_plume: Object.freeze({
    label: 'Tall plume',
    status: 'prototype',
    authority: 'tall-plume-prototype-authority-v0',
    supersededBy: null,
  }),
  compact_plume: Object.freeze({
    label: 'Compact plume',
    status: 'superseded',
    authority: 'compatibility-only-no-prototype-authority-v0',
    supersededBy: 'tall_plume',
  }),
  canonical_plume: Object.freeze({
    label: 'Canonical plume',
    status: 'superseded',
    authority: 'compatibility-only-no-prototype-authority-v0',
    supersededBy: 'tall_plume',
  }),
  bonfire_plume: Object.freeze({
    label: 'Bonfire plume',
    status: 'superseded',
    authority: 'compatibility-only-no-prototype-authority-v0',
    supersededBy: 'tall_plume',
  }),
});

export function volumeSceneReceipt(value) {
  const raw = value == null || value === '' ? DEFAULT_VOLUME_SCENE : String(value);
  const supported = Object.hasOwn(VOLUME_SCENE_ONTOLOGY, raw);
  const effective = supported ? raw : DEFAULT_VOLUME_SCENE;
  const definition = VOLUME_SCENE_ONTOLOGY[effective];
  return {
    identity: 'kaminos-volume-scene-authority-v0',
    requested: raw,
    effective,
    status: definition.status,
    authority: definition.authority,
    supersededBy: definition.supersededBy,
    fallbackReason: supported ? null : `unsupported-volume-scene:${raw}`,
  };
}

export function normalizeVolumeScene(value) {
  return volumeSceneReceipt(value).effective;
}
