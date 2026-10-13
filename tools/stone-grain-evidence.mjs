export const GRAIN_EVIDENCE_SCHEMA='stone-grain-evidence-v1';
import {requireNativeStone} from '../experiments/stone/stone-fracture.experiment.mjs';
export function requireGrainEvidence({status,grains,faces,state}){
 requireNativeStone(status);
 if(grains?.route!=='kaminos.stone.connected-grains.v1'||!(grains.scale>0)||!grains.groups?.length||!grains.groups.some(g=>g.length>1))throw Error('Actual coherent-grain route required');
 if(faces?.route!=='kaminos.stone.exposed-cell-faces.webgpu.v1'||!['exteriorTriangles','interiorTriangles','totalTriangles','capacityTriangles'].every(k=>Number.isSafeInteger(faces[k])&&faces[k]>=0)||faces.totalTriangles===0||faces.totalTriangles!==faces.exteriorTriangles+faces.interiorTriangles||faces.totalTriangles>faces.capacityTriangles)throw Error('Complete nonblank native exposure required');
 const model=status.model,completeModel=model?.kind==='graph'&&['points','elements','bonds'].every(k=>Number.isSafeInteger(model[k])&&model[k]>0&&state?.model?.[k]===model[k])&&state?.model?.kind===model.kind;
 if(state?.runId!==status.runId||!Number.isSafeInteger(status.submittedSteps)||status.submittedSteps<0||state.steps!==status.submittedSteps||state.observation?.kind!=='full-diagnostic'||!completeModel||!Array.isArray(state.state)||state.state.length!==model.points*16||!Array.from(state.state).every(Number.isFinite)||!Array.isArray(state.bonds)||state.bonds.length!==model.bonds*4)throw Error('Complete acquired current material required');
 for(let i=0;i<state.bonds.length;i+=4){const [a,b,live,flags]=state.bonds.slice(i,i+4);if(![a,b,flags].every(v=>Number.isInteger(v)&&v>=0&&v<=0xffffffff)||a>=model.points||b>=model.points||a===b||![0,1].includes(live))throw Error('Complete valid material bond records required');}
 return true;
}
