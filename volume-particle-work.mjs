// Authoring work gates share the same file-in/file-out settings as the live UI.
export const PARTICLE_WORK_DEFAULTS=Object.freeze({exchangeEnabled:true,groupingEnabled:true,exchangeRate:1,exchangeHeat:1,exchangeSpecies:1,exchangeSoot:1,exchangeEvery:1,exchangeSpacing:0,acquisitionEnabled:true,birthsEnabled:true,acquisitionEvery:1,updateEnabled:true,reactionEnabled:true,transportEnabled:true,profileMode:0,maxFootprint:0,opticalCutoff:0,largeSupportFade:0,liveTimings:true,timingEvery:30,hud:true});
export const PARTICLE_WORK_FLAGS=['exchangeEnabled','groupingEnabled','acquisitionEnabled','birthsEnabled','updateEnabled','reactionEnabled','transportEnabled','liveTimings','hud'];
export function validateParticleWorkSettings(s){
 for(const k of PARTICLE_WORK_FLAGS)if(typeof s[k]!=='boolean')throw Error('Particle '+k+' must be boolean');
 for(const k of ['exchangeRate','exchangeHeat','exchangeSpecies','exchangeSoot','exchangeSpacing','maxFootprint','opticalCutoff'])if(!(Number.isFinite(s[k])&&s[k]>=0&&Number.isFinite(Math.fround(s[k]))))throw Error('Invalid particle '+k);
 for(const k of ['exchangeEvery','acquisitionEvery','timingEvery'])if(!Number.isSafeInteger(s[k])||s[k]<1)throw Error('Particle '+k+' must be a positive whole number');
 if(![0,1].includes(s.profileMode)||!(s.largeSupportFade>=0&&s.largeSupportFade<=1))throw Error('Invalid particle footprint work controls');return s;
}
export function createParticleCaptureClock(){let last=null,key=null;return {due({enabled,step,interval,identity,advancing=true,bootstrap=false}){if(!enabled)return false;return bootstrap||(advancing&&(key!==identity||last===null||step<last||step-last>=interval));},mark(step,identity){last=step;key=identity;},reset(){last=null;key=null;},read(){return {lastCaptureStep:last,identity:key};}};}
