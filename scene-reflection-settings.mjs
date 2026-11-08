export function resolveReflectionSettings(value={}){
 const result={enabled:false,resolutionScale:.33,steps:6,refinementSteps:6,samples:1,sampling:'stochastic',maxDistance:50,thickness:.15,roughnessCutoff:.95,temporal:true,historyWeight:.85,...value};
 for(const key of ['enabled','temporal'])if(typeof result[key]!=='boolean')throw Error(`${key} must be boolean`);
 for(const key of ['resolutionScale','maxDistance','thickness','roughnessCutoff'])if(!Number.isFinite(result[key])||result[key]<=0)throw Error(`${key} must be positive`);
 if(result.resolutionScale>1||result.roughnessCutoff>1)throw Error('Reflection scale and roughness cutoff must be at most one');
 if(!Number.isSafeInteger(result.steps)||result.steps<1||result.steps>4294967295)throw Error('Reflection steps must be a positive u32 integer');
 if(!Number.isSafeInteger(result.refinementSteps)||result.refinementSteps<0||result.refinementSteps>4294967295)throw Error('Reflection refinement steps must be a nonnegative u32 integer');
 if(!Number.isSafeInteger(result.samples)||result.samples<1||result.samples>4294967295)throw Error('Reflection samples must be a positive u32 integer');
 if(!['stochastic','stable'].includes(result.sampling))throw Error('Unknown reflection sampling sequence');
 if(!Number.isFinite(result.historyWeight)||result.historyWeight<0||result.historyWeight>=1)throw Error('Reflection history weight must be in [0,1)');
 if(Math.fround(result.historyWeight)>=1)throw Error('Reflection history weight must remain below one at float32 precision');
 return result;
}

export const REFLECTION_COST_HELP='Trace work grows with tracing pixels × rays per pixel. Each ray takes up to its march-step budget; each candidate depth crossing can add the refinement-step budget before a hit is accepted or rejected. Early exits reduce that work. Source mip generation, reconstruction, history and final shading have separate costs.';
export const REFLECTION_CONTROL_FIELDS=[
 {key:'enabled',label:'Screen reflections',type:'checkbox',help:'Reflect visible opaque scene surfaces. Missing screen-space information falls back to the existing environment.'},
 {key:'resolutionScale',label:'Tracing resolution',type:'number',step:.05,min:0,max:1,help:'Fraction of viewport width and height used for ray tracing. 0.5 traces 25% of the pixels; 0.25 traces 6.25%. Lower values reduce trace work and need more reconstruction.'},
 {key:'samples',label:'Rays per pixel',type:'number',step:1,min:1,help:'Reflection directions sampled per tracing pixel each frame. More rays reduce angular sampling noise. Each ray has its own march and crossing-refinement work.'},
 {key:'steps',label:'March steps per ray',type:'number',step:1,min:1,help:'Maximum coarse depth-search samples along each ray. More steps help find thin or distant screen-space features. This is separate from glossy ray count and hit refinement.'},
 {key:'refinementSteps',label:'Refinement steps per crossing',type:'number',step:1,min:0,help:'Binary-search steps after a candidate depth crossing. Each step halves that candidate interval. A rejected candidate can be followed by another crossing, so this budget can run more than once per ray. Zero disables binary refinement.'},
 {key:'sampling',label:'Sampling sequence',type:'select',options:[['stochastic','Scrambled samples'],['stable','Fixed pattern (diagnostic)']],help:'Scrambled directions avoid coherent angular bands. Fixed pattern retains the rejected comparison for diagnosis; its correlated visibility transitions can produce hard artifacts.'},
 {key:'temporal',label:'Reproject reflection history',type:'checkbox',help:'Reuse validated previous reflection samples during camera movement. Depth, normal, roughness and hit-distance checks reject incompatible or newly exposed history.'},
 {key:'historyWeight',label:'History blend',type:'number',step:.01,min:0,max:1,help:'Maximum weight of accepted previous reflection history. Larger values suppress noise but respond more slowly. Invalid history receives no weight; the value must remain below one.'},
 {key:'maxDistance',label:'Ray distance',type:'number',step:.1,min:0,help:'Maximum world-space distance searched by each reflection ray. Longer searches cover more of the scene and can need additional coarse march steps.'},
 {key:'thickness',label:'Hit depth tolerance',type:'number',step:.01,min:0,help:'Allowed depth penetration when accepting a refined crossing, in view-space scene units. Too small rejects real hits; too large can accept unrelated surfaces.'},
 {key:'roughnessCutoff',label:'Roughness cutoff',type:'number',step:.01,min:0,max:1,help:'Surfaces at or above this roughness use environment lighting without tracing screen reflections.'},
];
