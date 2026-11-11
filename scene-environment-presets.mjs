export const SCENE_HDR_PRESETS = {
  studio: {
    label: 'Studio',
    url: './assets/hdr/studio_small_09_1k.hdr',
    previewUrl: './assets/hdr/studio_small_09_128.hdr',
    // Noah's interim viewing defaults (2026-10-07), until the new lighting lands.
    exposure: 1.1,
    intensity: 0.7,
  },
  sunset: {
    label: 'Sunset',
    url: './assets/hdr/kloofendal_48d_partly_cloudy_puresky_1k.hdr',
    previewUrl: './assets/hdr/kloofendal_48d_partly_cloudy_puresky_128.hdr',
    exposure: 1.2,
    intensity: 1.0,
  },
  warehouse: {
    label: 'Warehouse',
    url: './assets/hdr/empty_warehouse_01_1k.hdr',
    previewUrl: './assets/hdr/empty_warehouse_01_128.hdr',
    exposure: 1.4,
    intensity: 1.2,
  },
  courtyard: {
    label: 'Courtyard',
    url: './assets/hdr/royal_esplanade_1k.hdr',
    previewUrl: './assets/hdr/royal_esplanade_128.hdr',
    exposure: 1.0,
    intensity: 1.0,
  },
  night: {
    label: 'Night',
    url: './assets/hdr/moonlit_golf_1k.hdr',
    previewUrl: './assets/hdr/moonlit_golf_128.hdr',
    exposure: 2.0,
    intensity: 1.5,
  },
  neutral: {
    label: 'Neutral',
    url: null, // procedural
    exposure: 1.5,
    intensity: 1.0,
  },
};
