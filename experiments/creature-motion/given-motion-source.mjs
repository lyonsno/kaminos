// Admission of retained source versus fixed-grid learned continuation; no pose repair.
export function validateGivenMotionSource({motion:m,prefix,prefixSha256}) {
 const fail=message=>{throw Error(message);};
 if(m?.status!=='completed'||m.route!=='unimate.text-to-motion.webgpu-local.v0'||m.textEncoder!=='browser T5'||m.cooperative!==true)fail('Retained motion route is missing or fallback');
 if(!m.continuation){if(m.controllerNorm!=='valid-joints')fail('Retained source controller differs');return {sampling:'dopri5-valid-joints',controllerNorm:m.controllerNorm,prefixFrames:null};}
 const c=m.continuation;
 if(!prefix||!/^[a-f0-9]{64}$/i.test(prefixSha256??''))fail('Verified continuation prefix required');
 validateGivenMotionSource({motion:prefix});
 if(c.schema!=='kaminos.creature.continuation.v1'||c.parentMotionSha256!==prefixSha256||c.prefixFrames!==prefix.frames)fail('Continuation prefix identity differs');
 if(m.sampling!=='replacement-euler-50'||m.controllerNorm!==null||m.evaluations!==50)fail('Continuation fixed sampler identity differs');
 if(!Number.isInteger(c.segmentFrames)||!Number.isInteger(c.overlap)||c.overlap<=0||c.overlap>=c.segmentFrames||!Number.isInteger(c.addedSegments)||c.addedSegments<1||m.frames!==prefix.frames+c.addedSegments*(c.segmentFrames-c.overlap))fail('Continuation segment accounting differs');
 if(m.joints!==prefix.joints||m.assetCondSha256!==prefix.assetCondSha256||m.prompt!==prefix.prompt||m.cfgScale!==prefix.cfgScale||m.skeleton?.fps!==prefix.skeleton?.fps||JSON.stringify(m.skeleton?.jointNames)!==JSON.stringify(prefix.skeleton?.jointNames)||JSON.stringify(m.skeleton?.parents)!==JSON.stringify(prefix.skeleton?.parents))fail('Continuation conditioning/topology differs');
 for(const [name,width,tolerance] of [['features',12,0],['positions',3,1e-6],['localRotations',4,1e-6]]){
  const prior=prefix[name],current=m[name];
  if(prior?.length!==prefix.frames*m.joints*width||current?.length!==m.frames*m.joints*width||!current.every(Number.isFinite)||!prior.every(Number.isFinite))fail('Incomplete continuation '+name);
  if(prior.some((value,i)=>Math.abs(value-current[i])>tolerance))fail('Continuation changed preserved prefix '+name);
 }
 return {sampling:m.sampling,controllerNorm:null,prefixFrames:c.prefixFrames,parentMotionSha256:prefixSha256,addedSegments:c.addedSegments,overlap:c.overlap};
}
