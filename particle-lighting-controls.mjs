import {validateParticleLightView} from './volume-particle-light-view.mjs';
export function particleLightingOptions(input={}){
 const s={width:24,transportWidth:32,directions:24,filterLength:.125,albedo:.5,mode:2,exposure:-5,...input};
 for(const k of ['width','transportWidth'])if(!Number.isSafeInteger(s[k])||s[k]<2)throw Error(k+' must be an integer of at least2');
 if(s.width%2||!Number.isSafeInteger(s.directions)||s.directions<2||s.directions%2||!Number.isFinite(s.filterLength)||s.filterLength<0)throw Error('Use even receiver width and direction count, with nonnegative smoothing');
 validateParticleLightView(s);return s;
}
export const particleLightFieldKeys=['width','transportWidth','directions','filterLength'];
export const sameParticleLightField=(a,b)=>!!a&&!!b&&particleLightFieldKeys.every(k=>a[k]===b[k]);
export function particleLightingEdit(requested,effective,patch){
 const settings=particleLightingOptions({...requested,...patch}),fieldChanged=!sameParticleLightField(settings,requested);
 const usesDisplayedField=sameParticleLightField(settings,effective);
 return {settings,fieldChanged,usesDisplayedField,requiresBuild:!usesDisplayedField&&(fieldChanged||particleLightFieldKeys.some(k=>Object.hasOwn(patch,k)))};
}
