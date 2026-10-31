import {createCrust,saveCrust,restoreCrust} from './crust.mjs';
export const CRYSTAL_TYPE='crystal-growth',CRYSTAL_SOURCE='kaminos:crystal-growth';
export const crystalRuntime=Symbol('crystal-growth-runtime');
export function defaultCrystalSnapshot(){return {schema:'kaminos.crystal-growth.v1',state:saveCrust(createCrust({setup:'neighbors',arrangement:'arcs',tilt:.24})),rate:1,playing:false,interfaces:false,substrate:true,pendingModelSeconds:0};}
export function checkedCrystalSnapshot(value){
 if(value?.schema!=='kaminos.crystal-growth.v1')throw Error('Unknown crystal growth snapshot');
 const state=restoreCrust(value.state);
 for(const key of ['rate','pendingModelSeconds'])if(!Number.isFinite(value[key])||value[key]<0)throw Error('Invalid crystal '+key);
 for(const key of ['playing','interfaces','substrate'])if(typeof value[key]!=='boolean')throw Error('Invalid crystal '+key);
 return {...value,state:saveCrust(state)};
}
export function checkedCrystalRecord(record){
 if(record.type!==CRYSTAL_TYPE||record.source!==CRYSTAL_SOURCE)throw Error('Invalid crystal scene source');
 return {...record,crystalGrowth:checkedCrystalSnapshot(record.crystalGrowth)};
}
export const crystalRecordDomain={type:CRYSTAL_TYPE,source:CRYSTAL_SOURCE,
 check:checkedCrystalRecord,fields:record=>({crystalGrowth:record.crystalGrowth}),
 capture:entry=>({crystalGrowth:entry.object?.[crystalRuntime]?.snapshot()??checkedCrystalSnapshot(entry.crystalGrowth)}),
 reloadable:record=>{checkedCrystalRecord(record);return true;},
 load:(record,loaders,options)=>loaders.crystal(checkedCrystalRecord(record),options),
};
