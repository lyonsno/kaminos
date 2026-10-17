// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {run} from '../scripts/skeleton-proportions.mjs';
import {measureSkeleton,compareSkeletons,referenceJoints,validateProportionAtlas} from '../experiments/creature-motion/skeleton-proportions.mjs';
const fixture=()=>({joints:[
 {name:'hips',parent:null,head:[0,0,0]}, {name:'chest',parent:'hips',head:[0,0,4]},
 ...['L','R'].flatMap((s,i)=>{const x=i?1:-1;return [
 {name:s+'hip',parent:'hips',head:[x,0,0]}, {name:s+'knee',parent:s+'hip',head:[x,-2,0]}, {name:s+'ankle',parent:s+'knee',head:[x,-4,0]},
 {name:s+'shoulder',parent:'chest',head:[x*2,0,4]}, {name:s+'elbow',parent:s+'shoulder',head:[x*2,-1,4]}, {name:s+'wrist',parent:s+'elbow',head:[x*2,-3,4]},
 ];})]});
const profile=()=>({schema:'kaminos.quadruped-correspondence.v1',id:'synthetic-explicit',authority:'Synthetic correspondence; no backend claim',trunk:['hips','chest'],fore:{left:['Lshoulder','Lelbow','Lwrist'],right:['Rshoulder','Relbow','Rwrist']},hind:{left:['Lhip','Lknee','Lankle'],right:['Rhip','Rknee','Rankle']}});
const values=m=>Object.fromEntries(m.features.map(f=>[f.id,f.value]));
test('explicit roles measure actual origin chains, widths, segment fractions and rest bends',()=>{
 const s=fixture(),m=measureSkeleton(s,profile()),v=values(m);assert.equal(m.status,'measured');
 assert.equal(v.shoulderWidth,1);assert.equal(v.hipWidth,.5);assert.equal(v.shoulderHipRatio,2);assert.equal(v.foreReach,.75);assert.equal(v.hindReach,1);assert.equal(v.foreHindRatio,.75);assert.equal(v.foreProximalFraction,1/3);assert.equal(v.foreBend,180);
 const withTails=structuredClone(s);for(const j of withTails.joints)j.tail=[900,800,700];assert.deepEqual(values(measureSkeleton(withTails,profile())),v);
 assert.deepEqual(s,fixture());
});
test('translation, rotation, uniform scale and semantic naming leave ratios invariant',()=>{
 const s=fixture();for(const j of s.joints){const [x,y,z]=j.head;j.head=[100-7*z,2+7*y,-11+7*x];}
 const actual=values(measureSkeleton(s,profile())),expected=values(measureSkeleton(fixture(),profile()));assert.ok(Object.keys(expected).length>=10);for(const k of Object.keys(expected))assert.ok(Math.abs(actual[k]-expected[k])<1e-10,k);
});
test('missing and mis-parented roles expose partial comparison rather than a fabricated foot or chain',()=>{
 const s=fixture();s.joints=s.joints.filter(j=>j.name!=='Lwrist');let m=measureSkeleton(s,profile());assert.equal(m.status,'partial');assert.equal(values(m).foreReach,undefined);assert.equal(values(m).hipWidth,.5);assert.ok(m.missing.some(x=>x.includes('Lwrist')));
 const broken=fixture();broken.joints.find(j=>j.name==='Lwrist').parent='hips';m=measureSkeleton(broken,profile());assert.equal(m.status,'partial');assert.equal(values(m).foreReach,undefined);assert.ok(m.missing.some(x=>x.includes('chain')));
 assert.equal(measureSkeleton(fixture(),null).status,'unsupported');
});
test('comparison preserves paired features and reports signed relative deltas, no validity score',()=>{
 const s=fixture();for(const j of s.joints)if(j.name.endsWith('shoulder'))j.head[0]*=2;
 const a=measureSkeleton(s,profile()),b=measureSkeleton(fixture(),profile()),r=compareSkeletons(a,b),width=r.rows.find(x=>x.id==='shoulderWidth');assert.equal(width.delta,1);assert.equal(width.relativeDelta,1);assert.equal(r.valid,undefined);
 const partial=fixture();partial.joints=partial.joints.filter(j=>j.name!=='Lwrist');const p=compareSkeletons(measureSkeleton(partial,profile()),b);assert.equal(p.rows.find(x=>x.id==='foreReach').candidate,null);
});
test('degenerate trunk and malformed correspondence fail visibly',()=>{
 const s=fixture();s.joints[1].head=[0,0,0];assert.throws(()=>measureSkeleton(s,profile()),/trunk/i);
 const p=profile();p.fore.left=['Lshoulder'];assert.throws(()=>measureSkeleton(fixture(),p),/chain/i);
});
test('malformed reference parents, duplicate sample ids and missing source identity cannot look measured',()=>{
 assert.throws(()=>referenceJoints({jointNames:['a','b'],parents:[-1,88],positions:[0,0,0,0,1,0]}),/reference/i);
 const reference={id:'r',label:'r',source:{path:'synthetic',sha256:'a'.repeat(64)},jointNames:fixture().joints.map(j=>j.name),parents:fixture().joints.map(j=>j.parent?fixture().joints.findIndex(x=>x.name===j.parent):-1),positions:fixture().joints.flatMap(j=>j.head),profile:profile()};
 const atlas={schema:'kaminos.skeleton-proportion-atlas.v1',profile:profile(),activeReference:'r',references:[reference,reference]};assert.throws(()=>validateProportionAtlas(atlas,fixture()),/atlas/i);atlas.references=[{...reference,source:null}];assert.throws(()=>validateProportionAtlas(atlas,fixture()),/identity/i);
});
test('file tool retains effective input identity and a failure report before primary measurement',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kaminos-proportions-')),input=path.join(root,'input.json'),out=path.join(root,'report.json');
 try{fs.writeFileSync(input,'{');assert.equal(run({input,out}).status,'failed');assert.equal(JSON.parse(fs.readFileSync(out)).phase,'read');fs.writeFileSync(input,JSON.stringify(fixture()));const report=run({input,out});assert.equal(report.status,'unsupported');assert.equal(report.inputSha256.length,64);assert.equal(report.route,'deterministic-rest-origin-measurements');}finally{for(const file of [input,out])fs.unlinkSync(file);fs.rmdirSync(root);}
});
