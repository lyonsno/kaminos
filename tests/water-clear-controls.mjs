// kaminos-test: node
import assert from 'node:assert/strict';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {normalizeLocalLiquidEmitter,normalizeLocalLiquidSetup,defaultLocalLiquidSetup} from '../local-liquid-setup.mjs';
let source={schema:'kaminos.local-liquid-emitter.v1',mode:'continuous',baseRadius:.075,strength:1.5,rate:120,aimAt:'target'};
let setup={...defaultLocalLiquidSetup(),cellSize:.025};
const edits=createSceneEdits({read(){},write(){}});
edits.register('@source',{read:()=>source,check:normalizeLocalLiquidEmitter,write:value=>{source=value;}});
edits.register('@setup',{read:()=>setup,check:normalizeLocalLiquidSetup,write:value=>{setup=value;}});
edits.apply('@source',normalizeLocalLiquidEmitter({...source,aimAt:null}));assert.equal(source.aimAt,null,'Free rotation must clear the old target across native history merges');
edits.apply('@setup',normalizeLocalLiquidSetup({...setup,cellSize:null}));assert.equal(setup.cellSize,null,'Automatic resolution must clear the authored cell size across native history merges');
await edits.undo();assert.equal(setup.cellSize,.025);await edits.undo();assert.equal(source.aimAt,'target');await edits.redo();assert.equal(source.aimAt,null);
console.log('Native aim unlink / automatic resolution and undo/redo pass');
