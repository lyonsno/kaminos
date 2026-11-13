export function checkedNeuralAppearanceParameters(raw={}){
 if(!raw.source||typeof raw.source.url!=='string'||! /^(?:\/api\/|https?:\/\/)/.test(raw.source.url)||! /^[a-f0-9]{64}$/.test(raw.source.sha256??''))throw Error('NVIDIA appearance requires a reloadable checkpoint URL and SHA256');
 const uvScale=raw.uvScale??1,gain=raw.gain??1,reflectionColor=raw.reflectionColor??"#777777",reflectionRoughness=raw.reflectionRoughness??.24;
 if(!Number.isFinite(uvScale)||uvScale<=0||!Number.isFinite(gain)||gain<=0)throw Error('NVIDIA appearance UV scale and gain must be positive');
 if(typeof reflectionColor!=="string"||!/^#[0-9a-f]{6}$/i.test(reflectionColor))throw Error("Reflection color requires a hex color");
 if(!Number.isFinite(reflectionRoughness)||reflectionRoughness<0||reflectionRoughness>1)throw Error("Reflection roughness must be between 0 and 1");
 return {...raw,source:structuredClone(raw.source),uvScale,gain,reflectionColor,reflectionRoughness};
}
export const neuralAppearanceDefinition={id:'neural-appearance',version:1,title:'NVIDIA neural appearance',supportsBurning:false,check:checkedNeuralAppearanceParameters,
 description:'Learned response for direct lights. Environment and scene reflections use the editable GGX approximation and mesh normals.',
 fields:[{key:'uvScale',label:'UV scale',type:'number',min:Number.MIN_VALUE,step:.05,default:1},{key:'gain',label:'Material gain',type:'number',min:Number.MIN_VALUE,step:.05,default:1},{key:'reflectionColor',label:'Reflection color',type:'color',default:'#777777'},{key:'reflectionRoughness',label:'Reflection roughness',type:'number',min:0,max:1,step:.01,default:.24}],
 describe:p=>`Checkpoint: ${p.source.url}\nSHA256: ${p.source.sha256}`};
