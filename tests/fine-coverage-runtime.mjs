// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function updateAutomaticFineCoverage('),html.indexOf('function readFineCoverageState('));
function fixture({mode='fire',present=true,active=null}={}){
 const calls=[];const ctx={performance,readFineCoverageSettings:()=>({mode}),fineCoverageStatus:{},authoringBusy:false,sceneDocument:{state:()=>({})},scenePlacementTools:{edits:{state:()=>({active})}},flameDomainDraft:null,
 fineCoverageController:{due:()=>true,release:()=>calls.push('release'),update:()=>({status:'move',target:{translate:[0,2,0],scale:1}}),accept:()=>calls.push('accept')},
 volumePrototype:{fineCoverageInputs:()=>({status:'active'})},flameDomainTranslation:[0,0,0],flameDomainScale:1,flameEmitterPose:{position:[0,0,0]},primaryAuthoredFlameSource:()=>present?{}:null,
 setFlameDomainTranslation:()=>calls.push('move'),writeAuthoredFlameEmitterPose:()=>calls.push('write-source'),syncAuthoredFlameSources:()=>calls.push('sync-sources'),refreshFlameDomainPreview:()=>{},window:{}};
 vm.createContext(ctx);vm.runInContext(source,ctx);ctx.updateAutomaticFineCoverage(1);return {calls,status:ctx.fineCoverageStatus};
}
test('fire remaining after source removal can move coverage without manufacturing a source',()=>{
 const f=fixture({present:false});assert.ok(f.calls.includes('move'));assert.ok(f.calls.includes('sync-sources'));assert.ok(!f.calls.includes('write-source'));
});
test('automatic relocation reprojects existing sources and yields during manual Fine edits',()=>{
 assert.deepEqual(fixture().calls,['move','write-source','accept']);
 assert.deepEqual(fixture({active:{id:'@flame-domain'}}).calls,[]);
 assert.deepEqual(fixture({mode:'off'}).calls,['release']);
});
