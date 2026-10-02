import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Execute the actual browser predicate, not a second copy of its conditions.
const source=readFileSync(new URL('../scratch/beaming-distributed-witness.mjs',import.meta.url),'utf8');
const predicate=source.match(/await page.waitForFunction\((f=>[\s\S]*?),f,\{timeout:0\}\)/)?.[1];
assert.ok(predicate,'edit-budget settling predicate must be available');
let volume={frameCount:10,active:true,error:null};
globalThis.window={__kaminosVolumePrototype:{debugState:()=>volume}};
const done=eval(`(${predicate})`);
assert.equal(!!done(10),false,'unfinished rendering must wait');
volume={frameCount:10,active:false,error:'angular allocation failed'};
assert.equal(!!done(10),true,'terminal renderer failure must wake the durable failure path');
volume={frameCount:13,active:true,error:null};assert.equal(!!done(10),true);
delete globalThis.window;
console.log('edit-budget witness terminal-progress contracts passed');
