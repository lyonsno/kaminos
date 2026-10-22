// Whether this build's levels module can serve a request. Levels for a surfels-only asset (reference 'raw-decode')
// need a module that declares that reference in GENERATION_LEVEL_REFERENCES; an older module ignores the reference
// and would treat the surfel GLB as a hero mesh. Returns null to run, or a skipped report saying why.
export function admitLevelsRequest(levels,{reference=null}={}){
  if(!reference||reference==='hero')return null;
  if(Array.isArray(levels?.GENERATION_LEVEL_REFERENCES)&&levels.GENERATION_LEVEL_REFERENCES.includes(reference))return null;
  return {phase:'skipped',reason:reference==='raw-decode'?'this build\'s levels module cannot measure tiers against the raw decode yet (surfels-only GI tiers)':`unsupported levels reference ${reference}`};
}
