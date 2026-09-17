export const COMPOSITION_SCHEMA = 'kaminos.stationary-flame-composition.v1';
const clone = value => JSON.parse(JSON.stringify(value));

export function normalizeComposition(value) {
  if (value == null) return null;
  if (value.schema !== COMPOSITION_SCHEMA) throw new Error('Unsupported scene composition');
  if (!/^vsp-[a-f0-9]{64}$/.test(value.flame?.presetId || '')) throw new Error('Composition requires an immutable basin preset');
  if (value.flame.stationary !== true) throw new Error('Only stationary flame compositions are supported');
  if (!Number.isFinite(value.lightGainStops)) throw new Error('Invalid fire light gain');
  if (!value.route || typeof value.route !== 'object' || Array.isArray(value.route)) throw new Error('Composition route is required');
  if (value.route.volume_light_field !== '1') throw new Error('Stationary composition requires the ordinary light-field route');
  for (const [key, item] of Object.entries(value.route)) {
    if (!(key.startsWith('volume_light_field') || key === 'composition_module_url') || typeof item !== 'string') {
      throw new Error(`Unsupported composition route field: ${key}`);
    }
  }
  return clone(value);
}

export function normalizeSceneCapture(value) {
  if (value == null) return null;
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value.image || '')) throw new Error('Scene capture must be a PNG');
  if (![value.width, value.height].every(n => Number.isInteger(n) && n > 0)) throw new Error('Invalid capture dimensions');
  if (typeof value.label !== 'string' || !value.label.trim()) throw new Error('Capture label is required');
  if (!Number.isFinite(Date.parse(value.capturedAt))) throw new Error('Capture time is required');
  return clone(value);
}

export function compositionRestoreUrl(composition, sceneFile, origin) {
  const state = normalizeComposition(composition);
  if (!sceneFile || /[/\\]/.test(sceneFile)) throw new Error('Saved scene filename is required');
  const target = new URL(state ? '/volume-settings-preset.html' : '/', origin);
  if (state) target.searchParams.set('preset', state.flame.presetId);
  const hash = new URLSearchParams(state?.route || {});
  hash.set('authoring', '1');
  hash.set('scene', sceneFile);
  target.hash = hash.toString();
  return target.href;
}

export function forwardCompositionHash(target, sourceHash) {
  const url = new URL(target);
  const hash = new URLSearchParams(sourceHash.replace(/^#/, ''));
  const forwarded = new URLSearchParams();
  for (const [key, value] of hash) {
    if (['authoring', 'scene', 'composition_module_url'].includes(key) || key.startsWith('volume_light_field')) forwarded.set(key, value);
  }
  url.hash = forwarded.toString();
  return url.href;
}

// Both canvases are sampled synchronously in one animation callback. This is a
// picture of the visible composition, not a checkpoint of the fluid solver.
export function captureComposedCanvases({ host, volume, document, label, simulation, capturedAt = new Date().toISOString() }) {
  if (!host || !host.width || !host.height) throw new Error('Host canvas is unavailable');
  const bounds = host.getBoundingClientRect();
  if (!(bounds.width > 0 && bounds.height > 0)) throw new Error('Host canvas has no visible area');
  const canvas = document.createElement('canvas');
  canvas.width = host.width;
  canvas.height = host.height;
  const context = canvas.getContext('2d');
  context.drawImage(host, 0, 0);
  if (volume) {
    if (!volume.width || !volume.height) throw new Error('Flame canvas is unavailable');
    const rect = volume.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) throw new Error('Flame canvas has no visible area');
    context.drawImage(volume,
      (rect.left - bounds.left) * canvas.width / bounds.width,
      (rect.top - bounds.top) * canvas.height / bounds.height,
      rect.width * canvas.width / bounds.width,
      rect.height * canvas.height / bounds.height);
  }
  return normalizeSceneCapture({ label, capturedAt, width: canvas.width, height: canvas.height,
    image: canvas.toDataURL('image/png'), simulation: simulation || null,
    layers: volume ? ['mesh', 'ordinary-emissive-volume'] : ['mesh'] });
}
