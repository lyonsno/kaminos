export const STONE_EXPERIMENT_ID='stone/fracture';
const vector=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
export function requireNativeStone(state){
 if(state?.route!=='kaminos.picked-stone.bounded-shards.webgpu.v0'||state.backend!=='webgpu'||state.adapterFallback!==false||state.connectivity!=='elastic-support'||state.failure||typeof state.runId!=='string'||!Number.isSafeInteger(state.submittedSteps)||state.submittedSteps<0)throw Error('Native bounded elastic-support stone required');
 return state;
}

export default {
 id:STONE_EXPERIMENT_ID,
 title:'Stone fracture',
 async create({host,inputs,record}){
  if(typeof host?.stone?.open!=='function')throw Error('Stone experiment requires host.stone.open');
  const stone=await host.stone.open(inputs);
  try{requireNativeStone(await stone.read());}catch(error){await stone.dispose();throw error;}
  const read=async()=>requireNativeStone(await stone.read());
  const perform=(name,apply)=>async requested=>{
   try{await apply(requested);const effective=await read();record({kind:`stone.${name}`,target:'stone',phase:'applied',requested,effective,actor:'experiment-operation'});return effective;}
   catch(error){record({kind:`stone.${name}`,target:'stone',phase:'failed',requested,effective:{error:error.message},actor:'experiment-operation'});throw error;}
  };
  const operations={
   hold:perform('hold',()=>stone.hold()),resume:perform('resume',()=>stone.resume()),reset:perform('reset',()=>stone.reset()),
   tension:perform('tension',value=>{if(!Number.isFinite(value)||value<=0)throw Error('Tension must be positive');return stone.tension(value);}),
   grip:perform('grip',request=>{if(!request||!Number.isSafeInteger(request.pieceId)||!Number.isSafeInteger(request.faceIndex)||request.faceIndex<0||!vector(request.point))throw Error('Explicit finite stone face contact required');return stone.grip(request);}),
   move:perform('move',value=>{if(!vector(value))throw Error('Displacement must be a finite three-vector');return stone.move(value);}),
   release:perform('release',()=>stone.release()),
   step:perform('step',async count=>{if(!Number.isSafeInteger(count)||count<=0)throw Error('Step count must be a positive integer');if(!(await read()).paused)throw Error('Explicit stepping requires held material');return stone.step(count);}),
   view:perform('view',value=>{if(!vector(value?.position)||!vector(value?.target))throw Error('Camera requires finite position and target');return stone.view(value);}),
   async observe(){if(!(await read()).paused)throw Error('Observation requires held material');return stone.observe();},
  };
  return {read,operations,mount:context=>host.controls?.mountStone?.(context)??null,dispose:()=>stone.dispose()};
 },
};
