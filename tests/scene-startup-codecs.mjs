// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
const root=new URL('../',import.meta.url);
const html=await readFile(new URL('index.html',root),'utf8');
const map=JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
const page=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
// Let the JS parser classify dependencies rather than matching import text.
const result=await build({stdin:{contents:page,sourcefile:'index-page.mjs',resolveDir:root.pathname},bundle:true,format:'esm',write:false,metafile:true,logLevel:'silent',plugins:[{name:'record-imports',setup(b){b.onResolve({filter:/.*/},a=>({path:a.path,external:true}));}}]});
const imports=Object.values(result.metafile.outputs)[0].imports;
const addons=imports.filter(i=>i.path.startsWith('three/addons/'));
test('required and optional addons resolve to the installed pinned local package',async()=>{
 const prefix=new URL(map['three/addons/'],'http://kaminos.local/');
 assert.equal(prefix.origin,'http://kaminos.local','editor addons must not need an external CDN');
 const pkg=JSON.parse(await readFile(new URL('node_modules/three/package.json',root),'utf8'));
 const manifest=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
 assert.equal(pkg.version,manifest.devDependencies.three);
 assert.ok(addons.length>0,'the real page graph must be inspected');
 for(const {path} of addons){
  const relative=map['three/addons/']+path.slice('three/addons/'.length);
  assert.ok((await readFile(new URL(relative,root),'utf8')).length>0,path);
 }
});
test('unused EXR code is absent and OBJ/MTL/export are deferred until invoked',()=>{
 assert.equal(imports.some(i=>i.path.endsWith('/EXRLoader.js')),false,'unused EXR loader must not join startup');
 for(const name of ['OBJLoader','MTLLoader','GLTFExporter']){
  const edges=imports.filter(i=>i.path.endsWith('/'+name+'.js'));
  assert.ok(edges.length>0,`${name} remains available`);
  assert.ok(edges.every(i=>i.kind==='dynamic-import'),`${name} must not block startup`);
 }
});
