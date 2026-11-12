import {tetVolume} from './material.mjs';
export function assertEarthAdapter(info){if(!info||typeof info.vendor!=='string'||!info.vendor||info.isFallbackAdapter!==false)throw Error('Effective renderer hardware adapter identity required');return info;}
export function assertEarthSource(actual,expected){if(actual?.commit!==expected?.commit||actual?.dirty!==false)throw Error('Served source differs from the clean recorded source');return actual;}
export function earthPhysicalEvidence(state,{grains,steps}={}){
 if(state?.solver?.route!=='webgpu/rigid-sphere-pairs/yielding-tetrahedra'||state.solver.grains!==grains||state.solver.steps!==steps)throw Error('Wrong physical route, population or completed step');
 if(!state.floats?.length||!state.tets?.length||!state.floats.every(Number.isFinite)||!state.tets.every(Number.isFinite))throw Error('Missing or nonfinite complete physical state');
 const js=state.material.tets.map(t=>tetVolume(...t.ids.map(i=>state.material.nodes[i].p))/t.rest);let minJ=Infinity,maxJ=-Infinity,minY=Infinity;for(const j of js){minJ=Math.min(minJ,j);maxJ=Math.max(maxJ,j);}for(const n of state.material.nodes)minY=Math.min(minY,n.p[1]);
 const evidence={minJ,maxJ,inverted:js.filter(j=>j<=0||!Number.isFinite(j)).length,minMaterialY:minY,tetrahedra:js.length};
 if(evidence.inverted||minY< -1e-9)throw Object.assign(Error('Invalid material geometry: '+JSON.stringify(evidence)),{physicalEvidence:evidence});return evidence;
}
