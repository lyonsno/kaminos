export function validateNormalizationDerivation(input){
 const {plan,source,report,original,corrected,correction}=input;
 const same=(a,b)=>typeof a?.path==='string'&&/^[a-f0-9]{64}$/.test(a?.sha256??'')&&a.path===b?.path&&a.sha256===b?.sha256;
 if(!report?.inputs?.some(r=>same(r,plan))||!same(corrected?.provenance?.normalizationPlan,plan))throw Error('Correction plan digest differs from supplied plan');
 if(!same(correction?.sourceCase,source)||original?.sourceSha256!==corrected?.sourceSha256)throw Error('Correction names a different original case');
 if(!same(correction?.sourceFit,corrected?.provenance?.normalizationFit))throw Error('Correction fit identity differs from package');
 if(correction.variant!=='rig-proportions')throw Error('Moving candidate requires explicit rig-proportions correction');
 return input;
}
