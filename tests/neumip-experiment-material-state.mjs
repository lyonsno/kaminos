// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import experiment from '../experiments/neumip.experiment.mjs';
import {createNeumipCarrier,NEUMIP_CARRIER_SOURCE} from '../neumip-carrier.mjs';
test('experiment controls and URL follow native recipes, custom names and reconstructed carriers',async()=>{
 const fetchBefore=globalThis.fetch;globalThis.fetch=async()=>({ok:true,json:async()=>({schema:'kaminos.neumip.author-models.v1',materials:{wool2:{filename:'wool2_web.model',sha256:'a'.repeat(64)}}})});
 const make=()=>{const m=createNeumipCarrier({surface:'sphere'});m.userData.kaminosSceneObject={neuralCarrier:{surface:'sphere'}};return m;};
 const entry={id:'carrier',source:NEUMIP_CARRIER_SOURCE,neuralCarrier:{surface:'folded'},object:make()},listeners=new Set();let persisted,framed;
 let library={recipes:[{id:'recipe',name:'My boutique knit',implementation:'neumip',parameters:{source:{url:'/api/read?root=image-inbox&path=neumip-author-models%2Fwool2_web.model',sha256:'a'.repeat(64)},uvScale:3,gain:1}}],bindings:[{objectId:entry.id,slot:'.:0',recipeId:'recipe'}]};
 const materials={read:()=>structuredClone(library),edit:(_id,patch)=>{Object.assign(library.recipes[0].parameters,patch.parameters);for(const l of listeners)l();},subscribe:fn=>{listeners.add(fn);return ()=>listeners.delete(fn);}};
 const session={readView:()=>({}),attach:async root=>({id:entry.id,root,owned:false}),dispose:async()=>{},redraw(){}};
 const document={activeElement:null,nodes:[],createElement(tag){const node={tag,ownerDocument:this,children:[],append(...xs){this.children.push(...xs);},addEventListener(){},value:'',readOnly:true};this.nodes.push(node);return node;}};
 const host={scene:{materials,open:async()=>session,renderer:()=>({backend:{isWebGPUBackend:true}}),objects:()=>[entry],frame:roots=>framed=roots},controls:{installNumberDrag:()=>({dispose(){}})}};
 let owner;try{
  owner=await experiment.create({host,inputs:{},record(){},updateInputs:value=>persisted=value});owner.mount({root:document.createElement('root'),document,invoke(){}});
  const scale=document.nodes.find(n=>n.children.some(c=>c.textContent==='UV scale ')).children.find(n=>n.tag==='input');
  materials.edit('recipe',{parameters:{uvScale:1.75}});
  assert.equal(scale.value,'1.75','Mounted control must follow native recipe edits');assert.equal(persisted.uvScale,1.75);
  assert.equal(document.nodes.find(n=>n.tag==='select').value,'wool2','Checkpoint selection follows source identity, not authored recipe name');
  assert.equal((await owner.read()).surface,'sphere','Borrowing reads live carrier state over its admission snapshot');
  const replaced=make();entry.object=replaced;owner.operations.setSurface('folded');owner.operations.frame();assert.equal(framed[0],replaced);assert.equal(replaced.userData.kaminosSceneObject.neuralCarrier.surface,'folded');
 }finally{await owner?.dispose();assert.equal(listeners.size,0);globalThis.fetch=fetchBefore;}
});
