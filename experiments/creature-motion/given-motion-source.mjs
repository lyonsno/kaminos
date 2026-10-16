// Admission of retained source versus fixed-grid learned continuation; no pose repair.
export function validateGivenMotionSource({motion:m,prefix,prefixSha256}) {
 const fail=message=>{throw Error(message);};
 if(m?.status!=='completed'||m.route!=='unimate.text-to-motion.webgpu-local.v0'||m.textEncoder!=='browser T5'||m.cooperative!==true)fail('Retained motion route is missing or fallback');
 if(!m.continuation){if(m.controllerNorm!=='valid-joints')fail('Retained source controller differs');if(Object.hasOwn(m,'sampling')&&m.sampling!=='dopri5-valid-joints')fail('Retained source sampler differs');return {sampling:'dopri5-valid-joints',controllerNorm:m.controllerNorm,prefixFrames:null};}
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

export function prepareGivenContinuation({raw,run,prefix,prefixSha256}) {
 if(Object.hasOwn(raw,'route')&&raw.route!==prefix.route)throw Error('Raw continuation route differs');
 if(Object.hasOwn(raw,'controllerNorm')&&raw.controllerNorm!==null)throw Error('Raw continuation controller differs');
 if(run?.status!=='completed'||run.phase!=='complete'||!run.segments?.length)throw Error('Incomplete continuation generation');
 if(!/^[a-f0-9]{40}$/i.test(run.source?.rev??'')||run.source.dirtyFiles?.length!==0||raw.source?.rev!==run.source.rev||raw.source?.dirtyFiles?.length!==0)throw Error('Continuation execution source differs or is dirty');
 const segmentFrames=raw.segmentFeatures?.length/(raw.joints*12),addedSegments=run.segments.length;
 if(!Number.isInteger(segmentFrames)||!Number.isInteger(raw.frames)||raw.frames<=prefix.frames)throw Error('Incomplete continuation segment');
 const stride=(raw.frames-prefix.frames)/addedSegments,overlap=segmentFrames-stride;
 if(!Number.isInteger(stride)||run.segments.some((s,i)=>s.frames!==prefix.frames+(i+1)*stride||s.evaluations!==50))throw Error('Continuation generation segment accounting differs');
 const motion={...raw,route:prefix.route,controllerNorm:null,
  continuation:{schema:'kaminos.creature.continuation.v1',parentMotionSha256:prefixSha256,prefixFrames:prefix.frames,segmentFrames,overlap,addedSegments},
  generationSource:structuredClone(run.source)};
 validateGivenMotionSource({motion,prefix,prefixSha256});
 return motion;
}

export function givenCanonicalGroundHeight(frame) {
 const a=frame?.canonicalWorldToSourceNormalized;
 if(a?.length!==4||a.some(row=>row?.length!==4||!row.every(Number.isFinite))||Math.abs(a[1][0])>1e-5||Math.abs(a[1][2])>1e-5||a[1][1]<=0)throw Error('Canonical ground is not a horizontal reference in this given frame');
 return a[1][3]; // One fixed reference, never an animated lowest-foot correction.
}

export function givenSourceSoleHeight(vertices,matrix) {
 if(!vertices?.length||vertices.length%3||!Array.from(vertices).every(Number.isFinite))throw Error('Incomplete source vertices for ground calibration');
 if(matrix?.length!==16||!Array.from(matrix).every(Number.isFinite))throw Error('Incomplete source world matrix for ground calibration');
 let height=Infinity;for(let i=0;i<vertices.length;i+=3)height=Math.min(height,matrix[1]*vertices[i]+matrix[5]*vertices[i+1]+matrix[9]*vertices[i+2]+matrix[13]);
 return height;
}
