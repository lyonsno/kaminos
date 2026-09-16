import { readFile, writeFile, mkdir, symlink, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const host = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkout = process.argv[2];
if (!checkout) throw new Error('Usage: node scripts/build-kimodo-live-flame.mjs /absolute/kimodo-checkout');
const root = await realpath(checkout);
const out = path.join(host, 'artifacts/kimodo-live-flame');
const git = (...args) => execFileSync('git', ['-C', root, ...args], {encoding:'utf8'}).trim();
if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('Kimodo tracked source must be clean for the library manifest');
const commit = git('rev-parse', 'HEAD');
const { build } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')));
await mkdir(out, {recursive:true});
// A sentinel makes an interrupted rebuild explicit to the page.
await writeFile(path.join(out, 'manifest.json'), JSON.stringify({status:'building', sourceCommit:commit}));
await build({
  root, configFile:false, publicDir:false,
  build: { outDir:path.join(out, 'lib'), emptyOutDir:true, minify:false,
    lib:{entry:{producer:path.join(root,'src/lib/producer.js'), gpu:path.join(root,'src/lib/gpu.js'), telemetry:path.join(root,'src/lib/frontend-telemetry.js')}, formats:['es'], fileName:(_format,name)=>`${name}.js`},
  },
});
await mkdir(path.join(out,'assets'), {recursive:true});
const assets = {};
for (const name of ['kimodo.bin','kimodo.json','fk_data.json','motion_rep_stats.json']) {
  const source = await realpath(path.join(root,'public',name));
  const target = path.join(out,'assets',name);
  try { await lstat(target); if (await realpath(target) !== source) throw new Error(`Asset mount conflicts: ${target}`); }
  catch(error) { if (error.code !== 'ENOENT') throw error; await symlink(source,target); }
  assets[name] = {sha256:createHash('sha256').update(await readFile(source)).digest('hex')};
}
const { readdir } = await import('node:fs/promises');
const bundles = {};
for (const name of await readdir(path.join(out,'lib'))) {
  bundles[name] = createHash('sha256').update(await readFile(path.join(out,'lib',name))).digest('hex');
}
const manifest = {status:'built',sourceRepo:'lyonsno/kimodo-webgpu',sourceCommit:commit,sourceRoot:root,hostCommit:execFileSync('git',['-C',host,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),assets,bundles};
await writeFile(path.join(out,'manifest.json'), JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
