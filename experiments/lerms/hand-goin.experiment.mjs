import hand from '../hand-browser-juice.experiment.mjs';
import {PLAY_SPACE_DEFAULTS} from '../hand-play-space.mjs';
import goin from './goin-pursuit.experiment.mjs';

export default {id:'lerms/hand-goin',title:'Lerms - hand and goin',async create({host,inputs={},record}){
 let liveWater=null,handEntry,goinEntry,disposed=false;
 const handHost={...host,fluid:{...host.fluid,async openInlets(options){
   const water=await host.fluid.openInlets(options);
   if(disposed){await water.dispose();throw Error('Hand/goin composition disposed');}
   liveWater=water;
   return {...water,async dispose(){if(liveWater===water)liveWater=null;await water.dispose();}};
 }}};
 try{
   handEntry=await hand.create({host:handHost,record,inputs:{
     particleCount:12000,sourceFlux:1800,jetSpeed:4.5,particleLifetimeSeconds:6,
     fluidGridSize:[128,80,128],sceneLayout:'runway',...inputs.hand,
     playSpace:{...PLAY_SPACE_DEFAULTS,...inputs.hand?.playSpace},fluidBackend:'mls-mpm',goinPile:null}});
   goinEntry=await goin.create({host,record,inputs:{...inputs,
     water:{...inputs.water,route:'borrowed-mls'}}},{waterReceiver:{
       async sample(sphere){
         const water=liveWater;
         if(!water)return {status:'awaiting-water',route:'mls-mpm'};
         try{
           const result=await water.sampleSphere(sphere);
           return water===liveWater?result:{status:'superseded',route:'mls-mpm'};
         }catch(error){if(water!==liveWater)return {status:'superseded',route:'mls-mpm'};throw error;}
       },dispose(){},
     }});
   const read=()=>({...goinEntry.read(),hand:handEntry.read(),composition:'one-hand-one-creature-one-physical-goin'});
   return {read,inspect:goinEntry.inspect,operations:{...handEntry.operations,...goinEntry.operations,
     sampleLiquidSphere(sphere){if(!liveWater)throw Error('Water is not mounted');return liveWater.sampleSphere(sphere);}},
     mount(context){handEntry.mount(context);return goinEntry.mount({...context,reopen:recipe=>{
       const current=handEntry.read(),juice=current.fingerJuice;
       return globalThis.window.kaminosWorkbenchExperiments.open('lerms/hand-goin',{
         ...recipe,hand:{...inputs.hand,playSpace:current.playSpace.config,handedness:current.handedness,
           acquisitionMode:current.acquisitionMode,cropPadding:current.cropPadding,detectorThreshold:current.detectorThreshold,
           particleCount:juice.load.requestedParticleCount,sourceFlux:juice.load.requestedRate,
           jetSpeed:juice.jetSpeedWorldPerSecond,particleLifetimeSeconds:juice.particleLifetimeSeconds}});
     }});},
     async dispose(){disposed=true;try{await goinEntry.dispose();}finally{await handEntry.dispose();}}
   };
 }catch(error){disposed=true;try{await goinEntry?.dispose();}finally{await handEntry?.dispose();}throw error;}
}};
