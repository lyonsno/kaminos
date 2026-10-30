// kaminos-test: node
import {test} from 'node:test';import assert from 'node:assert/strict';import {checkedBurnable} from '../scene-burning-settings.mjs';import {createSceneBloom} from '../scene-bloom.mjs';import experiment from '../experiments/inference-kiln-material.experiment.mjs';
test('authored burn appearance survives validation for any ordinary mesh',()=>{for(const type of ['glb','pbr','procedural-mesh']){const r=checkedBurnable({type,burnable:{enabled:true,material:'wood',appearance:{profile:'incineration',glow:.75}}});assert.deepEqual(r.appearance,{profile:'composed',glow:.75});}assert.throws(()=>checkedBurnable({type:'glb',burnable:{enabled:true,material:'wood',appearance:{profile:'incineration',glow:11}}}),/gain|glow/);});
test('zero bloom width is an exact scene bypass',()=>{const input={rgb:{add:x=>x},a:1};let called=0;const api=createSceneBloom({bloom(){called++;return {rgb:{},dispose(){}};},convertToTexture:x=>x,vec4:(x,a)=>({x,a}),rebuild(){},redraw(){}});api.set({enabled:true,radius:0});assert.equal(api.output(input,input),input);assert.equal(called,0);});
test('opening and closing the material tool leaves authored scene and fire choices intact',async()=>{
 const mutations=[],objects=[{id:'text',object:{userData:{kaminosPromptRelief:{prompt:'SAVED',appearance:'incineration'}}}}];let frame;
 const session={onFrame(fn){frame=fn;return()=>{};},async dispose(){}};
 const app={read:()=>({objects:[]}),burningState:()=>({status:'resident'}),setBurnable(){mutations.push('burnable');},settleCombustion:async()=>{},setBurnAppearance(){mutations.push('appearance');}};
 const runtime={debugState:()=>({simulationPaused:false}),setSimulationPaused(){assert.fail('material tool changed shared playback');},resetThermalExperimentFluid(){mutations.push('reset');}};
 const host={controls:{document:{defaultView:{kaminosSceneAuthoring:app,kaminosSelection:{read:()=>({activeId:'text'})}},getElementById:()=>({checked:true,value:1600,onchange(){mutations.push('ground');}})}},scene:{open:async()=>session,objects:()=>objects,select(){mutations.push('select');},setTransform(){mutations.push('pose');}},volume:{ready:Promise.resolve(),get:()=>runtime},flame:{open:async()=>({read:()=>({active:true,scene:{objects:[{id:'flame-field'}]},settings:{domControls:{}}}),setControls(){mutations.push('feed');}})}};
 const tool=await experiment.create({host,inputs:{},record(){}});await tool.dispose();assert.deepEqual(mutations,[]);assert.equal(objects.length,1);assert.ok(!Object.hasOwn(tool.operations,'ignite'));assert.ok(!Object.hasOwn(tool.operations,'reset'));
});
test('saving the normal kiln uses its prompt automatically while another object is selected',async()=>{
 const objects=[{id:'prompt',object:{userData:{kaminosPromptRelief:{prompt:'DESIGN SAMPLE'}}}},{id:'cube',object:{userData:{}}}],saved={ok:true,filename:'kiln.kaminos.json'},calls=[];
 const document={defaultView:{kaminosSelection:{read:()=>({activeId:'cube'})},kaminosSceneAuthoring:{burningState:()=>({})},saveScene:async()=>saved,kaminosInferenceKiln:{useSaved:async(result,id)=>{calls.push({result,id});return {selection:{sceneFile:result.filename,promptObjectId:id}};}}}};
 const tool=await experiment.create({host:{controls:{document},scene:{open:async()=>({onFrame:()=>()=>{},dispose(){}}),objects:()=>objects,select(){assert.fail('saving must not require selection changes');}}},record(){}});
 assert.deepEqual(await tool.operations.saveForGenerate(),{sceneFile:'kiln.kaminos.json',promptObjectId:'prompt'});assert.deepEqual(calls,[{result:saved,id:'prompt'}]);await tool.dispose();
});
