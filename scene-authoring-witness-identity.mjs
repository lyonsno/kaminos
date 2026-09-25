import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export async function verifyAuthoringServer({ origin, repoRoot, fetch = globalThis.fetch }) {
  const readJson = async route => {
    const response = await fetch(new URL(route, origin), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Server identity unavailable: ${route}`);
    return response.json();
  };
  const runtime = await readJson('/api/runtime-config');
  const root = await realpath(repoRoot);
  if (!runtime.source?.repoRoot || await realpath(runtime.source.repoRoot).catch(() => null) !== root) {
    throw new Error('Witness origin does not serve the requested checkout');
  }
  const hashes = {};
  for (const name of ['index.html', 'serve.py', 'scene-persistence-core.js', 'scene-edit-session.mjs',
    'scene-navigation.mjs', 'volume-settings-preset.html', 'volume-settings-preset-contract.mjs',
    'volume-settings-preset-schema-v2.json', 'volume-core.js', 'sf3d-host-device.mjs',
    'sf3d-live-flame-inject.mjs', 'lib/sf3d/sf3d-producer.js', 'sf3d-shared-device-smoke.mjs',
    'sf3d-kiln-save-reopen-witness.mjs']) {
    const response = await fetch(new URL(`/${name}`, origin), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Served source unavailable: ${name}`);
    const sha = bytes => createHash('sha256').update(bytes).digest('hex');
    const local = sha(await readFile(path.join(root, name)));
    const served = sha(Buffer.from(await response.arrayBuffer()));
    if (local !== served) throw new Error(`Served source differs from reviewed checkout: ${name}`);
    hashes[name] = served;
  }
  const roots = await readJson('/api/roots');
  const presets = await readJson('/api/volume-settings-presets');
  if (!roots.scenes?.exists || !path.isAbsolute(roots.scenes.path) || !path.isAbsolute(presets.storePath || '')) {
    throw new Error('Effective authoring persistence roots are unavailable');
  }
  return { origin, repoRoot: root, source: runtime.source, hashes,
    sceneStore: roots.scenes.path, basinStore: presets.storePath };
}
