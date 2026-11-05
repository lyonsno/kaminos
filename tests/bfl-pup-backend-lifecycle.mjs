// kaminos-test: node
// Runtime stubs test rejection, retry and ownership only; they prove no model math.
import assert from 'node:assert/strict';
import {createBrowserPromptHelper,BFL_SOURCE_REVISION} from '../models/bfl-pup/browser-backend.mjs';
globalThis.location={href:'http://localhost/probe.html',origin:'http://localhost'};
globalThis.fetch=async url=>({ok:true,text:async()=> 'source template',json:async()=>url.endsWith('provenance.json')?{status:'complete',source:'/snapshot/'+BFL_SOURCE_REVISION}:{t2i:'scene',i2i:'edit'}});
globalThis.pupRuntimeTest={loads:0,disposed:0,generated:0,visionEncoded:0,rawReads:0,acceptAfter:Infinity,options:[],lastMessages:null};
const runtime=`
export const env={};
export class Tensor{
 constructor(type,data,dims){this.type=type;this.data=data;this.dims=dims;this.disposed=false;}
 slice([start,end]){const width=this.dims[1]??1;return new Tensor(this.type,this.data.slice(start*width,end*width),[end-start,...this.dims.slice(1)]);}
 tolist(){if(this.dims.length===2){const out=[];for(let r=0;r<this.dims[0];r++)out.push(Array.from(this.data.slice(r*this.dims[1],(r+1)*this.dims[1])));return out;}return Array.from(this.data);}
 dispose(){this.disposed=true;}
}
export function cat(tensors){
 for(const t of tensors)if(t.disposed)throw Error('Cannot cat a disposed tensor');
 const width=tensors[0].dims[1],totalRows=tensors.reduce((s,t)=>s+t.dims[0],0),merged=new Float32Array(totalRows*width);
 let offset=0;for(const t of tensors){merged.set(t.data,offset);offset+=t.data.length;}
 return new Tensor(tensors[0].type,merged,[totalRows,width]);
}
export class RawImage{
 constructor(id,width=64,height=64){this.id=id;this.width=width;this.height=height;}
 static async read(src){globalThis.pupRuntimeTest.rawReads++;return new RawImage(String(src),64,64);}
}
export const AutoProcessor={from_pretrained:async()=>Object.assign(async(text,raw)=>{
 if(!raw)return {input_ids:{dims:[1,1],dispose(){}}};
 const patchRows=raw.length*4,pixels=new Float32Array(patchRows*2),grids=new BigInt64Array(raw.length*3);
 raw.forEach((img,idx)=>{
  const seed=[...String(img.id)].reduce((s,c)=>s+c.charCodeAt(0),0);
  for(let i=0;i<8;i++)pixels[idx*8+i]=seed+i;
  grids.set([1n,2n,2n],idx*3);
 });
 return {input_ids:{dims:[1,3],dispose(){}},pixel_values:new Tensor('float32',pixels,[patchRows,2]),image_grid_thw:new Tensor('int64',grids,[raw.length,3])};
},{apply_chat_template:messages=>{globalThis.pupRuntimeTest.lastMessages=messages;return "prompt";},tokenizer:{decode:()=>"A blue kettle"}})};
export class LogitsProcessor{};export class InterruptableStoppingCriteria{interrupt(){}};export class TextStreamer{};
export const Qwen3_5ForConditionalGeneration={from_pretrained:async(model,options)=>{
 const state=globalThis.pupRuntimeTest;state.loads++;state.options.push(options);
 const candidate={_get_text_only_rope_index(){return [{},{data:new BigInt64Array(1)}];},sessions:{embed_tokens:{config:{device:'webgpu'}},vision_encoder:{config:{device:state.loads>state.acceptAfter?'webgpu':'wasm'}},decoder_model_merged:{config:{device:'webgpu'}}},
 async _encode_input(name,feeds){
  if(name!=='vision_encoder')throw Error('unexpected session '+name);
  state.visionEncoded++;
  return new Tensor('float16',new Float32Array([feeds.pixel_values.data[0],feeds.pixel_values.data[1]]),[1,2]);
 },
 generate:async(inputs)=>{
  state.generated++;
  if(inputs.pixel_values&&inputs.image_grid_thw){
   const feat=await candidate.encode_image({pixel_values:inputs.pixel_values,image_grid_thw:inputs.image_grid_thw});
   if(feat.disposed)throw Error('encode_image returned a disposed tensor');
   feat.dispose();
  }
  return {sequences:{tolist:()=>[[1n,2n,3n,12n,248046n]],dispose(){}}};
 },
 dispose:async()=>{state.disposed++;}};
 return candidate;
}};`;
const runtimeUrl='data:text/javascript;base64,'+Buffer.from(runtime).toString('base64');
const helper=await createBrowserPromptHelper({modelUrl:'http://localhost/model',runtimeUrl,prepareReferenceImpl:async raw=>raw});
try{
 for(let attempt=0;attempt<2;attempt++)await assert.rejects(helper.expand({prompt:'blue'}),/vision_encoder did not select/);
 assert.equal(pupRuntimeTest.loads,2,'each retry validates a new candidate');
 assert.equal(pupRuntimeTest.disposed,2,'each rejected candidate is released');
 assert.equal(pupRuntimeTest.generated,0,'a rejected candidate must never generate');
 pupRuntimeTest.acceptAfter=2;
 const origFromPretrained=(await import(runtimeUrl)).Qwen3_5ForConditionalGeneration;
 const result=await helper.expand({prompt:'blue'});
 assert.equal(result.text,'A blue kettle');assert.ok(Object.values(result.sessions).every(s=>s.device==='webgpu'));
 assert.equal(result.mode,'expand');
 assert.equal(pupRuntimeTest.generated,1);
}finally{await helper.dispose();}
assert.equal(pupRuntimeTest.disposed,3);
assert.ok(pupRuntimeTest.options.every(options=>options.progress_callback===undefined),'local HTTP model loading must avoid the pinned runtime metadata preflight that leaves response bodies unread');

const cachedHelper=await createBrowserPromptHelper({modelUrl:'http://localhost/model',runtimeUrl,prepareReferenceImpl:async raw=>raw});
try{
 pupRuntimeTest.visionEncoded=0;pupRuntimeTest.rawReads=0;
 const turn1=await cachedHelper.expand({prompt:'make it brass',images:['imgA','imgB']});
 assert.equal(pupRuntimeTest.visionEncoded,2,'first multi-image turn encodes both reference images');
 assert.equal(pupRuntimeTest.rawReads,2,'first multi-image turn prepares both reference images');
 assert.deepEqual(turn1.visionCache,{hits:0,misses:2,entries:2});
 assert.equal(turn1.mode,'expand');

 const turn2=await cachedHelper.expand({prompt:'Critique the brass specular highlights.',images:['imgA','imgB'],mode:'vlm',systemPrompt:'You are a shader reviewer.'});
 assert.equal(pupRuntimeTest.visionEncoded,2,'second turn with identical images reuses cached vision_encoder features');
 assert.equal(pupRuntimeTest.rawReads,2,'second turn with identical image keys reuses prepared RawImage');
 assert.deepEqual(turn2.visionCache,{hits:2,misses:0,entries:2});
 assert.equal(turn2.mode,'vlm');
 assert.equal(pupRuntimeTest.lastMessages[0].content,'You are a shader reviewer.');
 assert.equal(pupRuntimeTest.lastMessages[1].content.at(-1).text,'Critique the brass specular highlights.');

 const turn3=await cachedHelper.expand({prompt:'blend imgB and imgC',images:['imgB','imgC']});
 assert.equal(pupRuntimeTest.visionEncoded,3,'third turn reuses imgB from cache and encodes only new imgC');
 assert.deepEqual(turn3.visionCache,{hits:1,misses:1,entries:3});
}finally{await cachedHelper.dispose();}
console.log('BFL rejected-route retry and model ownership pass');
