// kaminos-test: node
import assert from 'node:assert/strict';
import {prepareTorso,addFleshOffsets} from '../experiments/creature-flesh/torso.mjs';
import {tetrahedron} from '../experiments/creature-flesh/elastic.mjs';
const matrix=z=>[[1,0,0,0],[0,1,0,0],[0,0,1,z],[0,0,0,1]],data={manifest:{channels:['fixed','pelvis','spine-lumbar','spine-chest'],bones:['pelvis','spine-lumbar','spine-chest'].map((name,i)=>({name,restMatrix:matrix(i/2)}))},rest:[],weights:[]};
for(let k=0;k<7;k++)for(let a=0;a<16;a++){data.rest.push(Math.cos(a*Math.PI/8),Math.sin(a*Math.PI/8),k/6);data.weights.push(0,0,1,0);}
data.rest=new Float32Array(data.rest);data.weights=new Float32Array(data.weights);
const p=prepareTorso(data);assert.equal(p.positions.length,175);assert.equal(p.tetrahedra.length,576);
for(const ids of p.tetrahedra){const rest=ids.map(i=>p.positions[i]),tet=tetrahedron(rest);assert.ok(tet.volume>0);assert.ok(Math.abs(tet.evaluate(rest).J-1)<1e-10);}
assert.deepEqual(addFleshOffsets(data.rest,p,p.positions.map(()=>[0,0,0])),data.rest,'all source vertices, including unaffected regions, preserve exact baseline');
assert.equal(p.bindingWeights.length,data.rest.length/3*4);assert.ok(p.construction.influencedVertices>0);
for(let i=0;i<p.source.vertices;i++){const w=p.bindingWeights.slice(i*4,i*4+4);assert.ok(w.every(v=>Number.isFinite(v)&&v>=0));assert.ok(w.reduce((a,b)=>a+b,0)<=1.000001);}
assert.throws(()=>prepareTorso({...data,manifest:{...data.manifest,bones:[]}}),/family/);
assert.throws(()=>prepareTorso(data,{crossSection:4}),/Odd/);
console.log('automatic torso construction, valid tets, dense zero-residual preservation and declared family boundary');
