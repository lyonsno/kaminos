import {validateGenerationInputs} from './generation-inputs.js';
import {buildSparseSamplerPlan} from './sparse-sampler.js';
import {buildSLatSamplerPlan} from './slat-sampler.js';
import {validateNativePrefixBackend} from './sparse-prefix-witness-checks.js';
export const GENERATION_ROUTE='trellis2.image-generation.webgpu.v0';
export const GENERATION_PHASES=Object.freeze(['sparse-structure-sampling','occupancy-decoding','low-resolution-shape-sampling',
  'learned-cascade-support','high-resolution-shape-sampling','learned-geometry-decoding','shape-conditioned-texture-sampling','shape-guided-material-decoding']);
export const GENERATION_FIELDS=Object.freeze(['conditioning','geometry.features','geometry.coordinates','material.features',
  'material.coordinates','shapeCodes','textureCodes','noise.sparse','noise.lowResolutionShape','noise.highResolutionShape','noise.texture',
  'geometry.subdivision0','geometry.subdivision1','geometry.subdivision2','geometry.subdivision3']);
export function generationModelCallCounts(m){
  const count=p=>p.steps.reduce((n,s)=>n+(s.guided?2:1),0),c=m.models;
  return{[GENERATION_PHASES[0]]:count(buildSparseSamplerPlan(c.sparseFlow.config)),
    [GENERATION_PHASES[2]]:count(buildSLatSamplerPlan({...c.lowResolutionShape.config,tokenRows:1,mode:'shape'})),
    [GENERATION_PHASES[4]]:count(buildSLatSamplerPlan({...c.highResolutionShape.config,tokenRows:1,mode:'shape'})),
    [GENERATION_PHASES[6]]:count(buildSLatSamplerPlan({...c.textureFlow.config,tokenRows:1,mode:'texture'}))};
}
export function validateGenerationResult(result,m){
  validateGenerationInputs(m);validateNativePrefixBackend(result.backend);
  const c=result.composition;
  if(result.status!=='succeeded'||result.effectiveRoute!==GENERATION_ROUTE||result.requestedRoute!==GENERATION_ROUTE||
    result.backend.isFallbackAdapter!==false||result.profileStatus!=='passed'||result.profile?.evidence?.mode!=='live'||
    result.profile?.routeId!==GENERATION_ROUTE||result.numericalStatus!=='not-compared')throw Error('complete native generation route/profile required; not matched-reference fidelity');
  if(c?.dinoBlocksExecuted!==24||c.featureBytesToCPUDuringServing!==0||c.coordinateBytesToCPUDuringServing!==0||
    c.sameInvocation!==true||JSON.stringify(c.phases)!==JSON.stringify(GENERATION_PHASES)||!(c.lowResolutionRows>0)||!(c.highResolutionRows>0))
    throw Error('complete resident image-to-learned-fields composition required');
  for(const [phase,calls]of Object.entries(generationModelCallCounts(m)))
    if(c.stageCounts?.[phase]?.['terminal-output-projection']!==calls||c.stageCounts?.[phase]?.['block-modulation']!==calls*30)
      throw Error('complete actual30block/source schedule execution required '+phase);
  for(const name of GENERATION_FIELDS){
    const row=result.outputs?.[name];if(!row||!Array.isArray(row.shape)||!row.shape.every(n=>Number.isSafeInteger(n)&&n>0)||
      !['f32','i32'].includes(row.dtype)||row.byteLength!==row.shape.reduce((n,x)=>n*x,4)||row.finite!==true||!/^[a-f0-9]{64}$/.test(row.sha256??''))
      throw Error('complete finite retained generation field required '+name);
  }
  const out=result.outputs;
  for(const [name,shape]of Object.entries({conditioning:[1,1029,1024],shapeCodes:[c.highResolutionRows,32],textureCodes:[c.highResolutionRows,32],
    'noise.sparse':[1,8,16,16,16],'noise.lowResolutionShape':[c.lowResolutionRows,32],
    'noise.highResolutionShape':[c.highResolutionRows,32],'noise.texture':[c.highResolutionRows,32]}))
    if(JSON.stringify(out[name].shape)!==JSON.stringify(shape)||out[name].dtype!=='f32')throw Error('complete source field/noise shape required '+name);
  for(const [prefix,channels]of [['geometry',7],['material',6]]){
    const fields=out[prefix+'.features'],coords=out[prefix+'.coordinates'];
    if(fields.dtype!=='f32')throw Error('F32 learned '+prefix+' features required');
    if(fields.shape.length!==2||fields.shape[1]!==channels||coords.dtype!=='i32'||coords.shape.length!==2||
      coords.shape[1]!==3||coords.shape[0]!==fields.shape[0])throw Error('complete learned '+prefix+' fields and coordinates required');
    if(c[prefix+'Resolution']!==m.meshResolution)throw Error('canonical learned '+prefix+' resolution required');
    const levels=c[prefix+'Levels'],config=m.models[prefix==='geometry'?'shapeDecoder':'textureDecoder'].config;
    if(!Array.isArray(levels)||levels.length!==config.channels.length)throw Error('complete actual decoder level metadata required '+prefix);
    for(const [i,level]of levels.entries()){
      const resolution=m.meshResolution/2**(levels.length-1-i);
      if(!Number.isSafeInteger(level.rows)||level.rows<1||level.rows>resolution**3||level.resolution!==resolution||
        level.channels!==config.channels[i]||level.blocksExecuted!==config.numBlocks[i]||
        (i===0?level.rows!==c.highResolutionRows:level.rows>levels[i-1].rows*8)||
        (i===levels.length-1&&level.rows!==fields.shape[0])||
        (prefix==='material'&&level.rows!==c.geometryLevels[i].rows))throw Error('actual decoder level row/resolution/block contract required '+prefix+'.'+i);
      if(prefix==='geometry'&&i<levels.length-1){
        const guide=out['geometry.subdivision'+i];
        if(guide.dtype!=='f32')throw Error('F32 geometry subdivision guide required '+i);
        if(JSON.stringify(guide.shape)!==JSON.stringify([level.rows,8]))throw Error('actual parent-row subdivision guide required '+i);
      }
    }
  }
  if(out['geometry.coordinates'].sha256!==out['material.coordinates'].sha256)throw Error('shape-guided material coordinate identity required');
  return true;
}
