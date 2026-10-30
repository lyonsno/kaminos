// kaminos-test: node
import assert from 'node:assert/strict';
import * as replay from '../burn-fracture-replay.mjs';
const {readBurnReplay,replayRegionBodies}=replay;
import {Box3,Vector3} from '../lib/three.core.js';
import {checkBurnFractureInput} from '../burn-fracture-core.mjs';
// Schema fields from the retained native R3 snapshot; values test validation only.
const snapshot={identity:'frozen-material-residue-snapshot-v1',material:new Array(64).fill(0),initial:new Array(8).fill(1),read:{identity:'finite-wood-residue-v1',sourceWorld:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],steps:600}};
assert.equal(readBurnReplay({snapshot}).n,2);assert.equal(readBurnReplay({snapshots:[snapshot]}).steps,600);
for(const raw of [{},{snapshots:[snapshot,snapshot]},{snapshot:{...snapshot,material:[]}},{snapshot:{...snapshot,initial:[1]}},{snapshot:{...snapshot,material:[NaN,...snapshot.material.slice(1)]}},{snapshot:{...snapshot,read:{...snapshot.read,sourceWorld:[]}}}])assert.throws(()=>readBurnReplay(raw));
const prepared={cells:[{}],bonds:[{id:'a',a:0,b:0}]},sections={count:1,buffer:{},device:{},mapping:{connections:[{id:'a',a:0,b:0}]}};
checkBurnFractureInput(prepared,sections,[0]);checkBurnFractureInput(prepared,sections,[]);
for(const value of [{...sections,count:0},{...sections,mapping:null},{...sections,mapping:{connections:[{id:'different',a:0,b:0}]}}])assert.throws(()=>checkBurnFractureInput(prepared,value,[0]));
for(const supports of [undefined,[1],[0,0],[NaN]])assert.throws(()=>checkBurnFractureInput(prepared,sections,supports));

const material=new Float32Array(64),bounds=new Box3(new Vector3(0,0,0),new Vector3(2,2,2));
assert.equal(typeof replayRegionBodies,'function','Remaining material must define contact as well as mass');
for(let i=0;i<8;i++)material[i*8+5]=i%4<2?0:1;
const shape={cells:[{index:0,position:[1,1,1],halfExtents:[1,1,1],volume:8}],pieces:[{index:0,bounds:{min:[0,0,0],max:[2,2,2]}}],bonds:[]};
const field={residentState:()=>({bounds,dimensions:[2,2,2],initial:new Uint32Array(8).fill(1)}),input:{snapshot:{material}}};
const remaining=replayRegionBodies(shape,field,500);
assert.equal(remaining.masses[0],2000);
assert.deepEqual(remaining.prepared.cells[0].position,[1,1.5,1]);
assert.deepEqual(remaining.prepared.cells[0].halfExtents,[1,.5,1],'Consumed bottom half must no longer supply contact');
const bonded={...shape,bonds:[{a:0,b:0,anchorA:[0,-1,0],anchorB:[0,1,0]}]};
const shifted=replayRegionBodies(bonded,field,500).prepared;
assert.deepEqual(shifted.bonds[0].anchorA,[0,-1.5,0],'Recentered mass must preserve original material anchors');
material.fill(0);assert.equal(replayRegionBodies(shape,field,500).masses[0],0,'Exhausted geometry cannot remain a static collision obstacle');
