// Refresh after changing files consumed by the standalone setup command.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../../', import.meta.url);
const paths = ['demos/hand-mesh/index.html', 'demos/hand-mesh/style.css', 'demos/hand-mesh/main.js', 'demos/hand-mesh/model-files.js',
  'models/mobrecon/portable_pack.py', 'models/mobrecon/OPENMESH-LICENSE.txt', 'models/mobrecon/fixtures/tensor-shapes.json', 'models/wilor-hand-detector/pack-weights.py',
  'lib/three.core.js', 'lib/three.webgpu.js', 'lib/three.tsl.js', 'webgpu-inference-kit/LICENSE'];
async function include(directory) {
  for (const entry of await readdir(new URL(directory + '/', root), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await include(path);
    else if (entry.name.endsWith('.js')) paths.push(path);
  }
}
for (const directory of ['webgpu-inference-kit/src', 'models/mobrecon', 'models/wilor-hand-detector']) await include(directory);
const files = await Promise.all([...new Set(paths)].sort().map(async path => ({ path, sha256: createHash('sha256').update(await readFile(new URL(path, root))).digest('hex') })));
await writeFile(new URL('demos/hand-mesh/setup-client.json', root), JSON.stringify({ schema: 'kaminos.hand-demo-client.v1', files }, null, 2) + '\n');
console.log(`Recorded ${files.length} client files.`);
