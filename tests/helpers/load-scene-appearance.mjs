import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root=fileURLToPath(new URL('../..',import.meta.url));
export async function loadSceneAppearance({outputRoot=tmpdir()}={}){
const output=join(mkdtempSync(join(outputRoot,'kaminos-appearance-')),'appearance.mjs');
const built=await build({stdin:{contents:"export * from './scene-appearance-resources.mjs';export * as THREE from './lib/three.webgpu.js';",resolveDir:root},
 bundle:true,format:'esm',platform:'browser',outfile:output,metafile:true,
 plugins:[{name:'actual-vendored-three',setup(build){build.onResolve({filter:/^three(?:\/webgpu|\/tsl)?$/},args=>({path:join(root,args.path==='three/tsl'?'lib/three.tsl.js':'lib/three.webgpu.js')}));}}]});
assert(Object.keys(built.metafile.inputs).some(path=>path.endsWith('lib/three.webgpu.js')),'actual vendor namespace must be bundled');
assert(!Object.keys(built.metafile.inputs).some(path=>/node_modules\/three\/(build|src)\//.test(path)),'installed Three must not supply a second core namespace');
const api=await import(pathToFileURL(output));
assert.equal(typeof api.createSceneAppearanceResources,'function');return api;
}
