// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('reinjury exercises the actual material threshold instead of an obsolete profile',async()=>{
 const source=fs.readFileSync(new URL('../tools/stone-chunk-smoke.mjs',import.meta.url),'utf8'),start=source.indexOf("await invoke('tension'"),end=source.indexOf('const repeated=',start),calls=[];
 assert.ok(start>0&&end>start);
 await vm.runInNewContext(`(async()=>{${source.slice(start,end)}})()`,{invoke:async(...args)=>calls.push(args),intact:{witness:{materialRegime:{threshold:18000}}}});
 assert.deepEqual(calls[0],['tension',18000]);
});
