import {mountInferenceFlameCockpit} from '../inference-flame-cockpit.mjs';
import blendDefinition from './flame-blend.experiment.mjs';
import {createInferenceFlame} from '../inference-flame.mjs';
import {inferenceEvents} from '../inference-events.mjs';
import {inferenceFlameDemo} from '../inference-flame-demo.mjs';
export default {id:'inference-flame',title:'Flame · inference & replay',async create(context){
 const {host,inputs,record}=context;
 let arrangement=inputs.arrangement;
 if(inputs.arrangementUrl){
  const result=await fetch(inputs.arrangementUrl);
  if(!result.ok)throw Error('Arrangement HTTP '+result.status);
  arrangement=await result.json();
 }
 const initialBlend=inputs.blend??arrangement?.score?.objects?.[0]?.recipe??Object.values(arrangement?.score?.stages??{})[0];
 const blend=await blendDefinition.create({...context,inputs:{}}),flame=await host.flame.open(),scene=await host.scene.open();
 let sync=()=>{},cockpit;
 const response=createInferenceFlame({flame,source:inferenceEvents,onFrame:scene.onFrame,changed:()=>sync()});
 response.operations.load(inferenceFlameDemo());
 try{if(arrangement)response.operations.restore(arrangement);if(initialBlend)blend.operations.restore(initialBlend);}catch(e){response.dispose();await blend.dispose();await scene.dispose();throw e;}
 const operations={...Object.fromEntries(Object.entries(blend.operations).map(([key,fn])=>[key,(...args)=>{response.operations.pause();return fn(...args);}]))};
 for(const [name,fn] of Object.entries(response.operations))operations['response.'+name]=(...args)=>{
  blend.operations.pause();const result=fn.apply(response.operations,args),state=response.read({includeScore:false});
  record({kind:'inference-flame.'+name,phase:'applied',effective:{position:state.position,live:state.live}});return result;
 };
 operations['response.assignBlend']=stage=>operations['response.assign']({stage,recipe:blend.operations.snapshot()});
 operations['response.saveBlendObject']=value=>operations['response.saveObject']({...value,recipe:blend.operations.snapshot()});
 operations['response.updateBlendObject']=value=>operations['response.updateObject']({...value,recipe:blend.operations.snapshot()});
 operations['response.editObject']=id=>{
  response.operations.pause();const object=response.read().score.objects?.find(item=>item.id===id);
  if(!object)throw Error('Choose a saved state or effect');return blend.operations.restore(object.recipe);
 };
 operations['response.editStage']=stage=>{
  response.operations.pause();const score=response.read().score,layer=score.stacks?.[stage]?.[0];
  const recipe=score.objects?.find(item=>item.id===layer?.objectId)?.recipe??score.stages[stage];
  if(!recipe)throw Error('Add a state or effect to this phase first');return blend.operations.restore(recipe);
 };
 operations['response.capturePeak']=values=>operations['response.captureFlare']({...values,fields:blend.read().fields});
 operations['response.demo']=()=>operations['response.load'](inferenceFlameDemo());
 return {read:()=>({blend:blend.read(),response:response.read()}),operations,async mount({root,document,invoke}){
  cockpit=await mountInferenceFlameCockpit({root,document,host,flame,blend,response,invoke,arrangement});sync=cockpit.sync;
 },async dispose(){cockpit?.dispose();response.dispose();await blend.dispose();await scene.dispose();}};
}};
