const modes = Object.freeze({
  all: Object.freeze({ shared: true, flameField: true }),
  shared: Object.freeze({ shared: true, flameField: false }),
  'flame-field': Object.freeze({ shared: false, flameField: true }),
  neither: Object.freeze({ shared: false, flameField: false }),
});

export function renderingChannelsForMode(mode) {
  if (!Object.hasOwn(modes, mode)) throw new Error(`unknown rendering mode: ${mode}`);
  return { ...modes[mode] };
}

export function sceneSourceIntensityForMode(intensity, mode, gainStops = 0) {
  if (!Array.isArray(intensity) || intensity.length !== 3 || !intensity.every(value => Number.isFinite(value) && value >= 0)) {
    throw new Error('source intensity must be nonnegative finite linear RGB');
  }
  if (!Number.isFinite(gainStops)) throw new Error('source gain must be finite stops');
  return renderingChannelsForMode(mode).shared ? intensity.map(value => value * 2 ** gainStops) : [0, 0, 0];
}

export function parseSceneSourcePosition(text) {
  if (typeof text !== 'string') return null;
  const parts = text.split(',').map(part => part.trim());
  if (parts.length !== 3 || parts.some(part => part === '')) return null;
  const position = parts.map(Number);
  return position.every(Number.isFinite) ? position : null;
}
