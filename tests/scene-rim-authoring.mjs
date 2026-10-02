import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('authored rim transforms update the saved light recipe through its owner adapter',()=>{
 const start=html.indexOf('function applyAuthoredScenePose('),end=html.indexOf('function validateLiveLocalLiquidEmitterPose',start);
 let applied=null;
 const entry={id:'@rim-light',type:'authored-rim-light',object:{}};
 const context=vm.createContext({sceneObjects:[entry],FLAME_EMITTER_TYPE:'flame-emitter',LOCAL_LIQUID_EMITTER_TYPE:'local-liquid-emitter',RIM_LIGHT_ID:'@rim-light',
  writeAuthoredRimPose:pose=>{applied=pose;},applySceneObjectTransformState(){},updateTransformInspector(){},window:{kaminosSceneObjectDebugState:()=>[entry]}});
 vm.runInContext(html.slice(start,end),context);
 vm.runInContext("applyAuthoredScenePose('@rim-light',{position:[1,2,3],rotation:[0,1,0],scale:[1,1,1]})",context);
 assert.deepEqual(applied?.position && Array.from(applied.position),[1,2,3]);
});

const {rimRecipePose,rimRecipeFromPose}=await import('../scene-rim-light.mjs');
const {Vector3,Euler}=await import('../lib/three.core.js');
const recipe={enabled:true,intensity:120,distance:6,azimuth:135,elevation:30,target:[0,0,0],angle:35,penumbra:.65};
const near=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-9,`${a} != ${b}`));
test('moving a rim light translates its saved aim and rotation aims from the fixed light origin',()=>{
 const initial=rimRecipePose(recipe);
 const moved={...initial,position:initial.position.map((v,i)=>v+[1,2,3][i])};
 const translated=rimRecipeFromPose(recipe,moved);near(translated.target,[1,2,3]);near(rimRecipePose(translated).position,moved.position);
 const rotated={...initial,rotation:[0,Math.PI/2,0]};
 const aimed=rimRecipeFromPose(recipe,rotated);near(rimRecipePose(aimed).position,initial.position);
 near(new Vector3(...aimed.target).sub(new Vector3(...initial.position)).normalize().toArray(),[-1,0,0]);
 assert.equal(aimed.intensity,recipe.intensity);assert.equal(aimed.distance,recipe.distance);
 assert.throws(()=>rimRecipeFromPose(recipe,{...initial,scale:[2,2,2]}),/Cone Angle/);
});
test('vertical light aim survives recipe roundtrip',()=>{
 for(const elevation of [-90,90]){const value={...recipe,elevation};const p=rimRecipePose(value);const roundtrip=rimRecipeFromPose(value,p);near(rimRecipePose(roundtrip).position,p.position);near(roundtrip.target,value.target);}
});

test('selected flame shortcuts bind controls present in the Volume cockpit',()=>{
 const body=html.slice(html.indexOf('function createFlameQuickFields()'),html.indexOf('function installAuthoringParameterEditing()'));
 for(const match of body.matchAll(/\['(volume-[^']+)'\s*,/g))assert.ok(html.includes(`id="${match[1]}"`),`missing source control ${match[1]}`);
});
