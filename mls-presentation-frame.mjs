// Presentation changes do not resample particles or change the solver's metre/second.
export function checkedMlsPresentationFrame(value=null){
 const translation=value?.translation??[0,0,0],scale=value?.scale??1;
 if(!Array.isArray(translation)||translation.length!==3||!translation.every(Number.isFinite)||!Number.isFinite(scale)||scale<=0)throw Error('Water presentation requires a finite translation and positive uniform scale');
 return {translation:[...translation],scale};
}
export function presentedMlsDomain(config,frame){
 const {translation,scale}=checkedMlsPresentationFrame(frame);
 return {min:config.min.map((v,i)=>v*scale+translation[i]),cell:config.cell*scale,particleRadius:config.particleRadius*scale};
}
