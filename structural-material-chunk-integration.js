import {StorageBufferAttribute} from 'three/webgpu';
import {IntegrationStage} from './vendor/webphysics/src/physics/gpu/integration.ts';
import {disposeAll} from './structural-material-disposal.mjs';

export async function createChunkIntegration(renderer,count){
 const attributes={},make=(name,vecs=1)=>{const a=new StorageBufferAttribute(new Float32Array(count*vecs*4),4);attributes[name]=a;return a;};
 const positions=make('positions'),initial=make('initial',2),inertial=make('inertial',4),velocities=make('velocities'),previous=make('previous'),quaternions=make('quaternions'),angular=make('angular');
 for(let i=0;i<count;i++)quaternions.array[i*4+3]=1;
 const stage=new IntegrationStage(positions,initial,inertial,velocities,previous,quaternions,angular,[0,0,0],count);
 try{
  await renderer.computeAsync(stage.kernel,[1,1,1]);
  return{sourceRevision:'96b043c88dc2a4af5367820caf1e1e9f458d5560',motion:'translation-only',
   buffers:Object.fromEntries(Object.entries(attributes).map(([name,a])=>[name,renderer.backend.get(a).buffer])),
   step(timeStep,gravity){stage.kernel.computeNode.parameters.gravity.value.set(0,-gravity,0);stage.dispatch(renderer,count,timeStep);},
   dispose(){disposeAll([()=>stage.kernel.dispose(),...Object.values(attributes).map(a=>()=>{if(renderer.backend.get(a).buffer)renderer.backend.destroyAttribute(a);})],'Chunk integration cleanup failed');}
  };
 }catch(error){disposeAll([()=>stage.kernel.dispose(),...Object.values(attributes).map(a=>()=>{if(renderer.backend.get(a).buffer)renderer.backend.destroyAttribute(a);})],'Chunk integration initialization failed',error);}
}
