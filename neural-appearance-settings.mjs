export function checkedNeuralAppearanceParameters(raw={}){
 if(!raw.source||typeof raw.source.url!=='string'||! /^(?:\/api\/|https?:\/\/)/.test(raw.source.url)||! /^[a-f0-9]{64}$/.test(raw.source.sha256??''))throw Error('NVIDIA appearance requires a reloadable checkpoint URL and SHA256');
 const uvScale=raw.uvScale??1,gain=raw.gain??1;
 if(!Number.isFinite(uvScale)||uvScale<=0||!Number.isFinite(gain)||gain<=0)throw Error('NVIDIA appearance UV scale and gain must be positive');
 return {...raw,source:structuredClone(raw.source),uvScale,gain};
}
export const neuralAppearanceDefinition={id:'neural-appearance',version:1,title:'NVIDIA neural appearance',supportsBurning:false,check:checkedNeuralAppearanceParameters,
 description:'Compact learned directional response under native lights. This first adapter uses authored texels/MIPs; indirect and area lighting are not evaluated.',
 fields:[{key:'uvScale',label:'UV scale',type:'number',min:Number.MIN_VALUE,step:.05,default:1},{key:'gain',label:'Material gain',type:'number',min:Number.MIN_VALUE,step:.05,default:1}],
 describe:p=>`Checkpoint: ${p.source.url}\nSHA256: ${p.source.sha256}`};
