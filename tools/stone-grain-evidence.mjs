export const GRAIN_EVIDENCE_SCHEMA='stone-grain-evidence-v1';
import {requireNativeStone} from '../experiments/stone/stone-fracture.experiment.mjs';
export function requireGrainEvidence({status,grains,faces,state}){
 requireNativeStone(status);
 if(grains?.route!=='kaminos.stone.connected-grains.v1'||!(grains.scale>0)||!grains.groups?.length||!grains.groups.some(g=>g.length>1))throw Error('Actual coherent-grain route required');
 if(faces?.route!=='kaminos.stone.exposed-cell-faces.webgpu.v1'||!['exteriorTriangles','interiorTriangles','totalTriangles','capacityTriangles'].every(k=>Number.isSafeInteger(faces[k])&&faces[k]>=0)||faces.totalTriangles===0||faces.totalTriangles!==faces.exteriorTriangles+faces.interiorTriangles||faces.totalTriangles>faces.capacityTriangles)throw Error('Complete nonblank native exposure required');
 if(state?.runId!==status.runId||state.observation?.kind!=='full-diagnostic'||!Number.isSafeInteger(state.model?.points)||state.model.points<=0||state.state?.length!==state.model.points*16||!state.state.every(Number.isFinite)||!Array.isArray(state.bonds)||state.bonds.length%4)throw Error('Complete acquired current material required');
 return true;
}
