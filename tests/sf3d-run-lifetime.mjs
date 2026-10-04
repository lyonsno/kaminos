import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../sf3d-live-flame-inject.mjs', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('async function runSf3d('), source.indexOf('export async function mountComposition'));
const state = {};
const elements = new Map();
const hud = key => {if (!elements.has(key)) elements.set(key,{style:{}});return elements.get(key);};
let release, imported;
const importing = new Promise(resolve=>{imported=resolve;});
const hold = new Promise(resolve=>{release=resolve;});
let calls=0;
const producer = {async run(){calls++;return {glb:new ArrayBuffer(1),cooperativeReports:{},numVertices:3,numFaces:1};}};
const host={async presentGlb(){imported();await hold;return {status:'registered',objectId:'chair'};}};
const prototype={debugState:()=>({frameCount:1,simStepCount:1})};
const run = new Function('state','hud','sha256Hex','CANONICAL_DEMO_CHAIR_GLB_SHA256','summarizeGaps','window',`${body}; return runSf3d;`)(
  state,hud,async()=> 'fixture','fixture',()=>({}),{__compositionRoute:{}});
const first=run(producer,{},host,prototype);
await importing;
const second=run(producer,{},host,prototype).then(value=>({value}),error=>({error}));
try {
  assert.equal(calls,1,'host import retains exclusive run ownership');
  assert.match((await second).error?.message || '', /already running/);
} finally {release();await first;await second;}
assert.equal(state.running,false);
console.log('SF3D run ownership survives host publication');
