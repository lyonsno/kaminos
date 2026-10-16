// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../tools/paw-articulation-witness.mjs',import.meta.url),'utf8');
const begin=source.indexOf(' report.casts=[];'),end=source.indexOf(" report.phase='reopen';",begin);
assert.ok(begin>=0&&end>begin,'Actual witness cast loop must be available');
const loop=new Function('setup','invoke','read','capture','report','writeFileSync','join','out','assert',`return (async()=>{${source.slice(begin,end)}})()`);
async function replay({fixedGeometry=false}={}){
 const state={cast:0,angle:25},files=new Map(),report={};
 const setup={casts:[{candidate:{case_sha256:'zero'}},{candidate:{case_sha256:'one'}},{candidate:{case_sha256:'two'}}]};
 const invoke=async(name,value)=>{if(name==='cast')state.cast=value;else if(name==='pose')state.angle=value.angle;};
 const read=async()=>({cast:state.cast,angle:state.angle,bodies:[{}, {caseSha256:setup.casts[state.cast].candidate.case_sha256}],geometry:[[state.angle,0,0],[fixedGeometry?0:state.angle,0,0]]});
 await loop(setup,invoke,read,async()=>{},report,(path,value)=>files.set(path,JSON.parse(value)),(...p)=>p.join('/'),'out',assert);
 return {state,files,report};
}
test('actual alternate-cast witness clears inherited flex before neutral and restores it afterward',async()=>{
 const {state,files}=await replay();
 for(const i of [1,2]){
  const neutral=files.get(`out/cast-${i}.json`);
  assert.equal(neutral.angle,0,'A prior25 degree pose must not masquerade as neutral');
  const flex=files.get(`out/cast-${i}-flex.json`);
  assert.ok(flex,'The raw flex observation must be retained');
  assert.notDeepEqual(flex.geometry,neutral.geometry);
 }
 assert.equal(state.angle,0,'The final cast must return to neutral');
});
test('actual witness rejects identical neutral/flex geometry even if pose labels change',async()=>{
 await assert.rejects(()=>replay({fixedGeometry:true}));
});
