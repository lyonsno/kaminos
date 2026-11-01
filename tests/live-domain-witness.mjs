// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../tools/live-domain-witness.mjs',import.meta.url),'utf8');
const check=vm.runInNewContext(source.slice(source.indexOf(' const check='),source.indexOf(' const capture='))+';check',{assert});
const before={backend:'webgpu:apple',active:true,error:null,allocation:3,resets:2,step:80,
 world:{steps:80,anchor:{translate:[0,0,0],scale:2},identity:'world-smoke-one-way-v0',worldAnchored:true},
 adaptive:{effective:{identity:'pooled-material-hierarchy-v1',steps:50,anchor:{translate:[0,0,0],scale:2}},error:null}};
const after=structuredClone(before);after.step++;after.world.steps++;after.adaptive.effective.steps++;
check(after,before,{advancing:true});check(before,before,{advancing:false});
for(const field of ['world','adaptive']){
 const frozen=structuredClone(after);
 if(field==='world')frozen.world.steps=before.world.steps;else frozen.adaptive.effective.steps=before.adaptive.effective.steps;
 assert.throws(()=>check(frozen,before,{advancing:true}),/advance/,`${field} frozen during live movement must fail`);
}
const movedAnchor=structuredClone(after);movedAnchor.world.anchor.translate[0]++;
assert.throws(()=>check(movedAnchor,before,{advancing:true}),/anchor/);
console.log('Live witness rejects frozen World/adaptive fields and changed World anchor');
