// kaminos-test: node — the GI levels module worker loads in a browser: workers get no import map, so every
// module it reaches must be imported by relative or absolute URL, never a bare specifier like 'three'
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// Static imports, and dynamic ones; a dynamic node: builtin is Emscripten's Node-only branch, never taken in a browser.
const specifiers=source=>[...source.matchAll(/(?:^|[;\s}])(?:import|export)\s*(?:[^'"`;(]*?\sfrom\s*)?['"]([^'"]+)['"]/g),
  ...[...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].filter(m=>!m[1].startsWith('node:'))].map(m=>m[1]);

test('every module the GI levels worker reaches is imported by URL, not by bare specifier',()=>{
  const seen=new Set(),bare=[],queue=[resolve(root,'generation-levels-worker.mjs')];
  while(queue.length){const file=queue.pop();if(seen.has(file))continue;seen.add(file);
    for(const s of specifiers(readFileSync(file,'utf8'))){
      if(/^(\.{1,2}\/|\/)/.test(s))queue.push(resolve(dirname(file),s));
      else if(!/^(https?:|data:|blob:)/.test(s))bare.push(`${file.slice(root.length+1)} imports '${s}'`);}}
  assert.ok(seen.size>3,'the walk followed the worker\'s imports');
  assert.deepEqual(bare,[]);
});
