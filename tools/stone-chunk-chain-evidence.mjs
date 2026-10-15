export function requireChunkStage({status,state,motion}){
 if(status?.backend!=='webgpu'||status.adapterFallback!==false||status.fixture?.route!=='kaminos.stone.axial-chunk-fixture.v1'||status.motion?.route!=='kaminos.stone.detached-translation.webgpu.v1')throw Error('Effective native axial fixture and translation route required');
 const model=status.model;
 if(state?.observation?.kind!=='full-diagnostic'||state.runId!==status.runId||state.steps!==status.submittedSteps||!model||!['points','elements','bonds'].every(k=>Number.isSafeInteger(model[k])&&model[k]>0&&state.model?.[k]===model[k]))throw Error('Complete current acquired fixture state required');
 if(!Array.isArray(state.state)||state.state.length!==model.points*16||!state.state.every(Number.isFinite)||!Array.isArray(state.bonds)||state.bonds.length!==model.bonds*4)throw Error('Complete finite material and bond records required');
 for(let i=0;i<state.bonds.length;i+=4){const [a,b,live,flags]=state.bonds.slice(i,i+4);if(![a,b,flags].every(Number.isSafeInteger)||a<0||b<0||a>=model.points||b>=model.points||a===b||![0,1].includes(live)||flags<0||flags>0xffffffff)throw Error('Valid complete fixture bonds required');}
 if(motion?.route!==status.motion.route||motion.runId!==state.runId||motion.steps!==state.steps||motion.motion!=='translation-only'||!Array.isArray(motion.ownership)||motion.ownership.length!==model.points*4||!motion.ownership.every(Number.isFinite))throw Error('Current complete coherent ownership required');
 for(let i=0;i<model.points;i++){const owner=motion.ownership[i*4+3];if(!Number.isInteger(owner)||owner<0||owner>model.points||(owner>0)!==(state.state[i*16+15]===2)||owner>0&&state.state[i*16+11]===1)throw Error('Rigid ownership must agree with acquired material and supports');}
}

export function requireMovedPieceFracture(before,after,nodes){
 const count=before?.model?.points,bonds=before?.model?.bonds;
 if(!Number.isSafeInteger(count)||count<=0||!Number.isSafeInteger(bonds)||bonds<=0||before.runId!==after?.runId||after.steps<=before.steps||after.model?.points!==count||after.model?.bonds!==bonds||!Array.isArray(nodes)||nodes.length<2||new Set(nodes).size!==nodes.length||!nodes.every(i=>Number.isSafeInteger(i)&&i>=0&&i<count)||![before.bonds,after.bonds].every(a=>Array.isArray(a)&&a.length===bonds*4))throw Error('Complete same-run moved-piece fracture control required');
 const selected=new Set(nodes),inside=[],outside=[];
 for(let i=0;i<before.bonds.length;i+=4){
  const [a,b,live]=before.bonds.slice(i,i+3),[nextA,nextB,nextLive]=after.bonds.slice(i,i+3);
  if(a!==nextA||b!==nextB||![0,1].includes(live)||![0,1].includes(nextLive)||live===0&&nextLive!==0)throw Error('Stable bond identities and prior damage required');
  if(live===1&&nextLive===0)(selected.has(a)&&selected.has(b)?inside:outside).push(i/4);
 }
 if(!inside.length||outside.length)throw Error('New pull must fracture the same moved piece without collateral control release');
 return{inside,outside};
}

export function requireStoneProducerParticipation(proof){
 if(proof?.participation!=='producer'||proof.frameDriver!=='manual'||proof.mount!=='caller-owned'||proof.deviceMatches!==true||proof.callbacks!==0||typeof proof.scene!=='string'||!proof.scene||!Array.isArray(proof.roots)||!proof.roots.length)throw Error('Effective native manual producer participation required');
 const ids=new Set();for(const root of proof.roots){if(typeof root.id!=='string'||!root.id||ids.has(root.id)||root.parentBefore!==null||root.parentAfter!==proof.scene)throw Error('Distinct initially unparented roots mounted in the effective shared scene required');ids.add(root.id);}
}

export function requirePublishedStoneSurface(surface,counts,state,expectedTriangles){
 if(!Array.isArray(surface)||!surface.length||counts?.route!=='kaminos.stone.exposed-cell-faces.webgpu.v1'||!Number.isSafeInteger(expectedTriangles)||expectedTriangles<=0||counts.totalTriangles!==expectedTriangles)throw Error('Complete published exposed-face evidence required');
 let error=0;for(const piece of surface){if(piece.runId!==state.runId||piece.step!==state.steps||piece.route!=='kaminos.deformable-surface.resident-four-split.webgpu.v0'||!Array.isArray(piece.gpu)||!piece.gpu.length||!Array.isArray(piece.reference)||piece.reference.length!==piece.gpu.length*3||!piece.reference.every(Number.isFinite))throw Error('Current complete native published surface required');for(let i=0;i<piece.gpu.length;i++){const point=piece.gpu[i];if(!Array.isArray(point)||point.length!==3||!point.every(Number.isFinite))throw Error('Finite published positions required');for(let k=0;k<3;k++)error=Math.max(error,Math.abs(point[k]-piece.reference[i*3+k]));}}
 if(error>3e-5)throw Error(`Published pose disagrees with acquired material ownership: ${error}`);return{maximumError:error,triangles:expectedTriangles};
}
