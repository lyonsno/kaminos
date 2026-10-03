import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const revision = '96b043c88dc2a4af5367820caf1e1e9f458d5560';
const root = resolve(process.argv[2] || 'vendor/webphysics');
async function get(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}
const tree = await (await get(`https://api.github.com/repos/jure/webphysics/git/trees/${revision}?recursive=1`)).json();
if (tree.sha !== revision || tree.truncated) throw new Error('incomplete or wrong upstream tree');
const files = tree.tree.filter(item => item.type === 'blob' &&
  (/^src\/(physics|lvbh)\//.test(item.path) ||
   ['src/gpuLimits.ts', 'LICENSE.md', 'README.md', 'package.json'].includes(item.path)));
const receipt = { source: 'https://github.com/jure/webphysics', revision, files: [] };
for (const file of files) {
  const bytes = Buffer.from(await (await get(`https://raw.githubusercontent.com/jure/webphysics/${revision}/${file.path}`)).arrayBuffer());
  const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (blob !== file.sha || bytes.length !== file.size) throw new Error(`upstream blob mismatch: ${file.path}`);
  const destination = resolve(root, file.path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  receipt.files.push({ path: file.path, gitBlob: blob, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
}
await writeFile(resolve(root, 'provenance.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(`Vendored ${files.length} exact upstream source files at ${revision} into ${root}`);
