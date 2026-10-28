// kaminos-test: node
import assert from 'node:assert/strict';
import {readBurnReplay} from '../burn-fracture-replay.mjs';
import {checkBurnFractureInput} from '../burn-fracture-core.mjs';
// Schema fields from the retained native R3 snapshot; values test validation only.
const snapshot={identity:'frozen-material-residue-snapshot-v1',material:new Array(64).fill(0),initial:new Array(8).fill(1),read:{identity:'finite-wood-residue-v1',sourceWorld:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],steps:600}};
assert.equal(readBurnReplay({snapshot}).n,2);assert.equal(readBurnReplay({snapshots:[snapshot]}).steps,600);
for(const raw of [{},{snapshots:[snapshot,snapshot]},{snapshot:{...snapshot,material:[]}},{snapshot:{...snapshot,initial:[1]}},{snapshot:{...snapshot,material:[NaN,...snapshot.material.slice(1)]}},{snapshot:{...snapshot,read:{...snapshot.read,sourceWorld:[]}}}])assert.throws(()=>readBurnReplay(raw));
const prepared={cells:[{}],bonds:[{id:'a',a:0,b:0}]},sections={count:1,buffer:{},device:{},mapping:{connections:[{id:'a',a:0,b:0}]}};
checkBurnFractureInput(prepared,sections,[0]);checkBurnFractureInput(prepared,sections,[]);
for(const value of [{...sections,count:0},{...sections,mapping:null},{...sections,mapping:{connections:[{id:'different',a:0,b:0}]}}])assert.throws(()=>checkBurnFractureInput(prepared,value,[0]));
for(const supports of [undefined,[1],[0,0],[NaN]])assert.throws(()=>checkBurnFractureInput(prepared,sections,supports));
