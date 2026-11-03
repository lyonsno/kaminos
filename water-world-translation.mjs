export function checkedTranslation(delta){
 if(!Array.isArray(delta)||delta.length!==3||!delta.every(Number.isFinite))throw Error('World translation requires three finite coordinates');
 return [...delta];
}
export function translateWaterSetup(setup,delta){
 checkedTranslation(delta);const next=structuredClone(setup);
 for(const key of ['worldBounds','container']){const bounds=next?.waterSampling?.[key];if(bounds)for(const side of ['min','max'])bounds[side]=bounds[side].map((v,i)=>v+delta[i]);}
 return next;
}
