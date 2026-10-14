export function requireChunkStage({status,state,motion}){
 if(status?.backend!=='webgpu'||status.adapterFallback!==false||status.fixture?.route!=='kaminos.stone.axial-chunk-fixture.v1'||status.motion?.route!=='kaminos.stone.detached-translation.webgpu.v1')throw Error('Effective native axial fixture and translation route required');
 const model=status.model;
 if(state?.observation?.kind!=='full-diagnostic'||state.runId!==status.runId||state.steps!==status.submittedSteps||!model||!['points','elements','bonds'].every(k=>Number.isSafeInteger(model[k])&&model[k]>0&&state.model?.[k]===model[k]))throw Error('Complete current acquired fixture state required');
 if(!Array.isArray(state.state)||state.state.length!==model.points*16||!state.state.every(Number.isFinite)||!Array.isArray(state.bonds)||state.bonds.length!==model.bonds*4)throw Error('Complete finite material and bond records required');
 for(let i=0;i<state.bonds.length;i+=4){const [a,b,live,flags]=state.bonds.slice(i,i+4);if(![a,b,flags].every(Number.isSafeInteger)||a<0||b<0||a>=model.points||b>=model.points||a===b||![0,1].includes(live)||flags<0||flags>0xffffffff)throw Error('Valid complete fixture bonds required');}
 if(motion?.route!==status.motion.route||motion.runId!==state.runId||motion.steps!==state.steps||motion.motion!=='translation-only'||!Array.isArray(motion.ownership)||motion.ownership.length!==model.points*4||!motion.ownership.every(Number.isFinite))throw Error('Current complete coherent ownership required');
 for(let i=0;i<model.points;i++){const owner=motion.ownership[i*4+3];if(!Number.isInteger(owner)||owner<0||owner>model.points||(owner>0)!==(state.state[i*16+15]===2)||owner>0&&state.state[i*16+11]===1)throw Error('Rigid ownership must agree with acquired material and supports');}
}
