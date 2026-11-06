// kaminos-test: node
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {recoverStockSection} from '../experiments/stock-family/section.mjs';

const field={origin:[0,0],scale:1,centers:[[0,0]],weights:[[.1,0]],affine:[[0,0],[0,0],[0,0]]};
const recovery={schema:'kaminos.stock-profile.v1',observations:[{station:0,field}]};
const surface=(p,n)=>({positions:Float32Array.from(p),normals:Float32Array.from(n),profile:{min:-.5,max:.5,xMin:-2,xMax:2,locks:[]}});
const source=surface([.5,.5,0],[1,0,0]);
const result=recoverStockSection(source,recovery),term=.1*(Math.log(.5)+1)*.5;
assert.ok(Math.abs(result.positions[0]-(.5+.025*Math.log(.5)))<1e-6,'Observed profile displacement must move actual positions');
assert.ok(Math.abs(result.normals[0]-1/Math.hypot(1,term))<1e-6);
assert.ok(Math.abs(result.normals[1]+term/Math.hypot(1,term))<1e-6,'Normals must follow the nonlinear profile Jacobian');
assert.deepEqual(source.positions,Float32Array.from([.5,.5,0]));

const drift={schema:recovery.schema,observations:[-.5,.5].map(station=>({station,field:{...field,centers:[],weights:[],affine:[[-.3*station,0],[0,0],[0,0]]}}))};
const tilted=recoverStockSection(surface([1,0,0],[1,0,0]),drift);
assert.ok(Math.abs(tilted.normals[2]-.3/Math.hypot(1,.3))<1e-6,'Station interpolation contributes to the normal');
const folded={...recovery,observations:[{station:0,field:{...field,centers:[],weights:[],affine:[[0,0],[-2,0],[0,0]]}}]};
assert.throws(()=>recoverStockSection(source,folded),/reverse|collapse|Jacobian/i);
assert.throws(()=>recoverStockSection(surface([],[]),recovery),/nonempty|matching|finite/i);
assert.throws(()=>recoverStockSection(surface([1,0,1],[1,0,0]),recovery),/outside observed/i);
assert.throws(()=>recoverStockSection(source,{...recovery,observations:[{station:0,field:{...field,weights:[]}}]}),/matching|field/i);
assert.ok(recoverStockSection(surface([1,0,1],[1,0,0]),{...recovery,outside:'hold'}).sectionRecovery.minJacobianDeterminant>0);

const translated={...recovery,outside:'hold',observations:[{station:0,field:{...field,centers:[],weights:[],affine:[[.2,0],[0,0],[0,0]]}}]};
const framed=JSON.parse(execFileSync(process.execPath,[new URL('../tools/stock-source-frame.mjs',import.meta.url).pathname],{input:JSON.stringify({
  source:{sha256:'a'.repeat(64),fit:{axis:'z'}},sectionRecovery:translated,
  positions:[-1,0,-1,1,0,-1,-1,0,1,1,0,1],normals:[0,1,0,0,1,0,0,1,0,0,1,0],
}),encoding:'utf8'}));
assert.ok(Math.abs(framed.positions[0]+.3)<1e-6,'The actual source-frame command must apply the requested profile correction');
assert.equal(framed.sectionRecovery.method,'observed-profile-thin-plate-displacement');
