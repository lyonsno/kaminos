// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import experiment from '../experiments/inference-kiln.experiment.mjs';
function fixture({active=true}={}){
 const ground={checked:true,onchange(){}};
 const ctx={font:'',measureText:s=>({width:s.length*40}),clearRect(){},fillText(){}};
 const document={createElement:()=>({getContext:()=>ctx}),getElementById:()=>ground,defaultView:{kaminosSelection:{clear(){}}}};
 let paused=false,removed=0,callback=null,resetCount=0;
 const values={'volume-flow-rate':.8,'volume-immersed-fuel':.7,'volume-ray-start-noise':true,'volume-ray-noise-animated':true};
 const runtime={setSimulationPaused(v){paused=v;},debugState:()=>({simulationPaused:paused}),resetThermalExperimentFluid(){assert.ok(paused);resetCount++;}};
 const flame={read:()=>({active,settings:{domControls:Object.fromEntries(Object.entries(values).map(([id,value])=>[id,{value}]))},runtime:{controls:values},clock:{}}),setControls:patch=>Object.assign(values,patch)};
 const session={attach:async root=>({id:'prompt',root}),redraw(){},setView:v=>v,onFrame:fn=>{callback=fn;return()=>callback=null;},dispose:async()=>{removed++;}};
 const host={controls:{document},scene:{open:async()=>session,objects:()=>[]},volume:{ready:Promise.resolve(),get:()=>runtime},flame:{open:async()=>flame}};
 return{host,ground,values,paused:()=>paused,removed:()=>removed,resets:()=>resetCount,tick:dt=>callback?.({deltaSeconds:dt})};
}
test('closing a prompt study restores borrowed controls, ground and simulation state',async()=>{
 const f=fixture(),study=await experiment.create({host:f.host,inputs:{},record(){}});
 study.operations.ignite();f.tick(2);assert.ok(study.read().progress>0);
 await study.dispose();assert.equal(f.paused(),false);assert.equal(f.ground.checked,true);assert.deepEqual(f.values,{'volume-flow-rate':.8,'volume-immersed-fuel':.7,'volume-ray-start-noise':true,'volume-ray-noise-animated':true});
 const progress=study.read().progress;f.tick(10);assert.equal(study.read().progress,progress);
 await study.dispose();assert.equal(f.removed(),1);
});
test('failed flame admission restores the ground and releases the attached study',async()=>{
 const f=fixture({active:false});await assert.rejects(experiment.create({host:f.host,inputs:{},record(){}}),/needs the flame route/);
 assert.equal(f.ground.checked,true);assert.equal(f.removed(),1);
});
test('invalid study inputs reject before allocating or changing shared state',async()=>{
 const f=fixture();await assert.rejects(experiment.create({host:f.host,inputs:{duration:0},record(){}}),/positive finite/);
 assert.equal(f.ground.checked,true);assert.equal(f.paused(),false);assert.equal(f.removed(),1);
});
test('consumption and replay preserve the complete source prompt',async()=>{
 const f=fixture(),prompt='A copper torch with a blue enamel handle';const study=await experiment.create({host:f.host,inputs:{prompt},record(){}});
 study.operations.ignite();f.tick(6);assert.equal(study.read().consumed,true);assert.equal(study.read().prompt,prompt);
 f.tick(2);assert.equal(f.paused(),true);assert.equal(study.read().cooling,false);
 study.operations.reset();assert.equal(study.read().progress,0);assert.equal(study.read().prompt,prompt);await study.dispose();
});
