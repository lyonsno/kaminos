// kaminos-test: node
import assert from 'node:assert/strict';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {createFireLightingHistory} from '../fire-lighting-history.mjs';
let current,settle=Promise.resolve(),syncs=0;
const make=()=>({state:{pointEvaluationBudget:4,pointCount:8,pointSampling:'all',smokeShadowSteps:8,smokeShadowResolution:32,smokeShadowFilter:true,smokeShadowFilterAngle:6,smokeShadowFilterTaps:2,smokeShadowMediumResolution:16},
 debugState(){return structuredClone(this.state);},whenRebuilt:()=>settle,
 setPointEvaluationBudget(n){if(!Number.isInteger(n)||n<0)throw Error('invalid budget');this.state.pointEvaluationBudget=n;},
 setSmokeShadowQuality(v){for(const [k,s] of Object.entries({steps:'smokeShadowSteps',resolution:'smokeShadowResolution',filter:'smokeShadowFilter',angleDegrees:'smokeShadowFilterAngle',tapsPerAxis:'smokeShadowFilterTaps',mediumResolution:'smokeShadowMediumResolution'}))this.state[s]=v[k];},
 setQuadrature(points,pointSampling){this.state.pointCount=points;this.state.pointSampling=pointSampling;},
});
current=make();const edits=createSceneEdits({read:()=>null,write(){}}),history=createFireLightingHistory({edits,getSource:()=>current,sync:()=>syncs++});
await history.run('setPointEvaluationBudget',2);assert.equal(edits.state().undoCount,1);await edits.undo();assert.equal(current.state.pointEvaluationBudget,4);await edits.redo();assert.equal(current.state.pointEvaluationBudget,2);
await history.run('setSmokeShadowQuality',{mediumResolution:8});assert.equal(current.state.smokeShadowSteps,8);await edits.undo();assert.equal(current.state.smokeShadowMediumResolution,16);await edits.redo();assert.equal(current.state.smokeShadowMediumResolution,8);
await history.run('setQuadrature',{points:6,pointSampling:'all'});assert.equal(current.state.pointCount,6);await edits.undo();assert.equal(current.state.pointCount,8);
const past=edits.state().undoCount;await assert.rejects(history.run('setPointEvaluationBudget',-1),/invalid budget/);assert.equal(edits.state().undoCount,past);assert.equal(edits.state().active,null);assert.equal(current.state.pointEvaluationBudget,2);
// A renderer replacement must not leave history bound to its disposed instance.
current=make();await edits.undo();assert.equal(current.state.smokeShadowMediumResolution,16);await edits.undo();assert.equal(current.state.pointEvaluationBudget,4);
let release;settle=new Promise(resolve=>release=resolve);const pending=history.run('setPointEvaluationBudget',1);await Promise.resolve();assert(edits.isSettling());assert.equal(edits.state().undoCount,0);release();await pending;assert.equal(edits.state().undoCount,1);assert(syncs>0);
console.log('PASS fire settings history restores live values, patches independent quality, rejects invalid edits and follows remounted consumers');
