// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const method=source.match(/    relocateOrdinaryDomain\([\s\S]*?\n    },/)[0].replace(/,$/,'');
const transform={translate:[0,0,0],scale:1};let rebuilds=0;
const context={followingDomain:null,productFrameOwner:'prototype',productTransform:transform,volumePrimitives:[],normalizePrimitiveRecord:x=>x,publishVolumePrimitiveState(){},getPrimitiveSource(){},device:{},gridSize:32,rebuildFluidState(){rebuilds++;},writeLiquidFireContactParams(){}};
const runtime=vm.runInNewContext(`({${method}})`,context);
assert.equal(runtime.relocateOrdinaryDomain([1,2,3],[],2),true);
assert.equal(transform.scale,2,'runtime must apply the authored world scale');
assert.equal(rebuilds,1);
assert.equal(runtime.relocateOrdinaryDomain([1,2,3],[],2),false);
assert.equal(rebuilds,1,'same domain must preserve the evolving field');
assert.throws(()=>runtime.relocateOrdinaryDomain([1,2,3],[],0),/positive/);
assert.equal(transform.scale,2,'invalid resize must preserve accepted state');
context.followingDomain={};assert.throws(()=>runtime.relocateOrdinaryDomain([2,3,4]),/Release object-following/);
assert.equal(rebuilds,1,'manual box edit cannot silently reset a following flame');
console.log('Runtime resize admission and one-rebuild boundary pass');
