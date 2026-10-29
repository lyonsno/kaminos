// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {WORLD_SMOKE_OPTICS_WGSL} from '../volume-world-smoke-optics.mjs';
import {DISPLAY_RECONSTRUCTION_WGSL} from '../volume-display-reconstruction.mjs';
import {HISTORY_ALLOCATION_WGSL} from '../volume-history-allocation.mjs';
import {readFileSync} from 'node:fs';
const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
test('fine display, middle/world fields and sample history coexist at distinct shader bindings',()=>{
 const source=[WORLD_SMOKE_OPTICS_WGSL,DISPLAY_RECONSTRUCTION_WGSL,HISTORY_ALLOCATION_WGSL].join('\n');
 const bindings=[...source.matchAll(/@group\((\d+)\)\s*@binding\((\d+)\)/g)].map(m=>m[1]+':'+m[2]);
 assert.equal(new Set(bindings).size,bindings.length,'composed shader resources cannot alias');
 const displayBinding=Number(DISPLAY_RECONSTRUCTION_WGSL.match(/@binding\((\d+)\) var displayField/)[1]);
 const helper=core.match(/function createFluidRenderBindGroup\([\s\S]*?\n  }\n/)[0];
 const entries=[...helper.matchAll(/binding: (\d+),/g)].map(m=>Number(m[1]));
 assert.equal(new Set(entries).size,entries.length,'composed host resources cannot alias');
 assert.match(helper,new RegExp('binding: '+displayBinding+', resource: displayReconstruction.view'));
});
