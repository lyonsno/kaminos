// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function syncAuthoredFlameSources(');assert.ok(start>=0);
const source=html.slice(start,html.indexOf('\n}',start)+2);
function replay({lightField=false,composition=null,records=[]}={}){
 const published=[],controls={emitterSourceLaw:'immersed-source'};
 const context={authoredFlamePresent:true,flameDomainFollowSource:true,activeSceneComposition:composition,
  isFireLightFieldRoute:()=>lightField,authoredFlameSourceRecords:()=>records,
  requirePluralFlameSourceRuntime(){},readVolumeControls:()=>controls,
  flameDomainTranslation:[0,0,0],flameDomainScale:1,
  flameSourceInputs:rows=>rows.map(row=>({id:row.id,enabled:row.emissionEnabled!==false})),
  volumePrototype:{setImmersedSources:rows=>published.push(rows)},window:{_kaminosDirty(){}}};
 vm.runInNewContext(source+';syncAuthoredFlameSources()',context);return {context,published};
}
test('a standalone preset retains its control-driven source rather than publishing an empty scene collection',()=>{
 const {context,published}=replay();
 assert.equal(context.authoredFlamePresent,true,'no authored scene must not disable the standalone emitter');
 assert.deepEqual(published,[],'standalone controls retain source ownership');
});
for(const options of [{lightField:true},{composition:{}}])test('an empty authored scene remains authoritative: '+JSON.stringify(options),()=>{
 const {context,published}=replay(options);
 assert.equal(context.authoredFlamePresent,false,'deleting the last source must still disable emission');
 assert.equal(published.length,1);assert.equal(published[0].length,0,'no synthetic source is revived');
});
test('plural authored sources retain their identities and disabled membership',()=>{
 const records=[{id:'first',emission:{settings:{'volume-emitter-source-law':{value:'immersed-source'}}}},
  {id:'second',emissionEnabled:false,emission:{settings:{'volume-emitter-source-law':{value:'immersed-source'}}}}];
 const {context,published}=replay({lightField:true,records});
 assert.equal(context.authoredFlamePresent,true);assert.equal(context.flameDomainFollowSource,false);
 assert.deepEqual(published,[[{id:'first',enabled:true},{id:'second',enabled:false}]]);
});
