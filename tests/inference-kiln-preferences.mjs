// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import {checkedPreferences,PREFERENCES_SCHEMA} from '../user-preferences.mjs';
test('kiln selection is a retained scene reference with a concrete prompt target',()=>{
 const base={schema:PREFERENCES_SCHEMA};const selected={schema:'kaminos.inference-kiln-selection.v1',sceneFile:'my-kiln.kaminos.json',promptObjectId:'lettering'};
 assert.deepEqual(checkedPreferences({...base,inferenceKiln:selected}).inferenceKiln,selected);
 for(const value of [{...selected,sceneFile:'../lost.kaminos.json'},{...selected,promptObjectId:''},{...selected,schema:'unknown'}])assert.throws(()=>checkedPreferences({...base,inferenceKiln:value}),/kiln|scene|prompt/i);
});
import {createKilnRecipeStore,KILN_SELECTION_SCHEMA} from '../inference-kiln-selection.mjs';
import {BoxGeometry,BufferGeometry,Mesh,MeshStandardMaterial} from '../lib/three.core.js';
import {promptReliefRecord,promptReliefMetadata} from '../inference-kiln-record.mjs';
import {COMPOSITION_SCHEMA} from '../scene-authoring.mjs';
function scene(){const mesh=new Mesh(new BufferGeometry().copy(new BoxGeometry()),new MeshStandardMaterial());mesh.userData.kaminosPromptRelief=promptReliefMetadata('AUTHORED','composed');const record=promptReliefRecord(mesh);mesh.geometry.dispose();mesh.material.dispose();return {version:8,objects:[{...record,id:'prompt'},{id:'flame-emitter',type:'flame-emitter',source:'kaminos:analytic-flame',transform:{position:[0,-.5,0],rotation:[0,0,0],scale:[1,1,1]}}],composition:{schema:COMPOSITION_SCHEMA,flame:{presetId:'vsp-'+ 'a'.repeat(64),stationary:true},lightGainStops:0,route:{volume_light_field:'1'}}};}
test('selection keeps the acknowledged recipe when a scene disappears or preference save conflicts',async()=>{
 let prefs={schema:PREFERENCES_SCHEMA},conflict=false,missing=false,writes=0;
 const preferences={async load(){return structuredClone(prefs);},async save(value){if(conflict)throw Error('revision conflict');writes++;prefs=structuredClone(value);}};
 const store=createKilnRecipeStore({preferences,request:async()=>({ok:!missing,json:async()=>scene()})});
 const selected={schema:KILN_SELECTION_SCHEMA,sceneFile:'authored.kaminos.json',promptObjectId:'prompt'};
 await store.choose(selected);const before=store.read();missing=true;await assert.rejects(store.load(),/unavailable/);assert.deepEqual(store.read(),before);
 missing=false;conflict=true;await assert.rejects(store.choose({...selected,sceneFile:'other.kaminos.json'}),/conflict/);assert.deepEqual(store.read(),before);assert.equal(writes,1);
});
test('an unsupported scene cannot become an acknowledged kiln selection',async()=>{
 let writes=0;const document=scene();document.objects.push({id:'unsupported',type:'image',source:'/image.png'});
 const store=createKilnRecipeStore({preferences:{load:async()=>({schema:PREFERENCES_SCHEMA}),save:async()=>{writes++;}},request:async()=>({ok:true,json:async()=>document})});
 await assert.rejects(store.choose({schema:KILN_SELECTION_SCHEMA,sceneFile:'unsupported.kaminos.json',promptObjectId:'prompt'}),/cannot reconstruct/);assert.equal(writes,0);assert.equal(store.read(),null);
});
