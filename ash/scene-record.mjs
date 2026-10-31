import {patchLayout} from './gpu-plan.mjs';
import {sourceSettings} from './fall-plan.mjs';
export const ASH_OBJECT_TYPE='retained-ash';
export const ASH_OBJECT_SOURCE='kaminos:retained-ash';
export const defaultAshSettings=()=>({schema:'kaminos.ash-object.v1',width:7.68,depth:7.68,height:1.6,cellSize:.04,initialDepth:.08,paused:false,emitting:false,rate:.008,spread:.24,sourcePosition:[0,1.15,0],checkpoint:null});
export function checkedAshSettings(raw){
 if(!raw||raw.schema!=='kaminos.ash-object.v1')throw Error('Ash object requires saved ash settings');
 for(const key of ['width','depth','height','cellSize'])if(!Number.isFinite(raw[key])||raw[key]<=0)throw Error(`Invalid ash ${key}`);
 if(!Number.isFinite(raw.initialDepth)||raw.initialDepth<0||raw.initialDepth>raw.height)throw Error('Invalid initial ash depth');
 for(const key of ['paused','emitting'])if(typeof raw[key]!=='boolean')throw Error(`Invalid ash ${key}`);
 sourceSettings({position:raw.sourcePosition,rate:raw.rate,spread:raw.spread});
 if(raw.sourcePosition[1]<0||Math.abs(raw.sourcePosition[0])>raw.width/2||Math.abs(raw.sourcePosition[2])>raw.depth/2)throw Error('Place the ash source over its field');
 if(raw.checkpoint!=null&&raw.checkpoint.schema!=='kaminos.tiled-ash.v1')throw Error('Invalid retained ash checkpoint schema');
 const result=structuredClone(raw);ashObjectLayout(result);return result;
}
export function ashObjectLayout(s){return patchLayout({cellSize:s.cellSize,tileSize:16,bounds:{min:[-s.width/2,0,-s.depth/2],max:[s.width/2,s.height,s.depth/2]}});}
export function checkedAshPose(pose){
 for(const key of ['position','rotation','scale'])if(!Array.isArray(pose?.[key])||pose[key].length!==3||!pose[key].every(Number.isFinite))throw Error('Invalid ash transform');
 if(pose.scale.some(x=>x===0))throw Error('Ash scale must be nonzero');
 return pose;
}
export function checkedAshRecord(raw){
 if(raw?.type!==ASH_OBJECT_TYPE||raw.source!==ASH_OBJECT_SOURCE||typeof raw.id!=='string'||!raw.id)throw Error('Ash object requires stable source, type and id');
 checkedAshPose(raw.transform);
 return {...raw,ash:checkedAshSettings(raw.ash)};
}
export const ashRecordDomain={type:ASH_OBJECT_TYPE,check:checkedAshRecord,
 fields:record=>({ash:checkedAshSettings(record.ash)}),
 reloadable:record=>{checkedAshRecord(record);return true;},
 load:(record,loaders,options)=>loaders.ash(record,options),
};
