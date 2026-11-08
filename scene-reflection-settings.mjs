export function resolveReflectionSettings(value={}){
 const result={enabled:false,resolutionScale:.5,steps:64,maxDistance:50,thickness:.15,roughnessCutoff:.95,temporal:true,historyWeight:.85,...value};
 for(const key of ['enabled','temporal'])if(typeof result[key]!=='boolean')throw Error(`${key} must be boolean`);
 for(const key of ['resolutionScale','maxDistance','thickness','roughnessCutoff'])if(!Number.isFinite(result[key])||result[key]<=0)throw Error(`${key} must be positive`);
 if(result.resolutionScale>1||result.roughnessCutoff>1)throw Error('Reflection scale and roughness cutoff must be at most one');
 if(!Number.isSafeInteger(result.steps)||result.steps<1||result.steps>4294967295)throw Error('Reflection steps must be a positive u32 integer');
 if(!Number.isFinite(result.historyWeight)||result.historyWeight<0||result.historyWeight>=1)throw Error('Reflection history weight must be in [0,1)');
 if(Math.fround(result.historyWeight)>=1)throw Error('Reflection history weight must remain below one at float32 precision');
 return result;
}
