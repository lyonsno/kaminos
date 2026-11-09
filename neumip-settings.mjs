// Pure authored recipe; decoding and GPU resources belong to the runtime.
export function checkedNeumipParameters(raw={}){
 const source=raw.source;
 if(!source||typeof source.url!=='string'||!(/^(?:\/api\/|https?:\/\/)/.test(source.url)))throw Error('NeuMIP requires a reloadable checkpoint URL');
 if(typeof source.sha256!=='string'||! /^[a-f0-9]{64}$/.test(source.sha256))throw Error('NeuMIP requires the checkpoint SHA256 digest');
 const uvScale=raw.uvScale??3,gain=raw.gain??1;
 for(const [name,value] of Object.entries({uvScale,gain}))if(!Number.isFinite(value)||value<=0)throw Error(`NeuMIP ${name} must be positive`);
 return {...raw,source:structuredClone(source),uvScale,gain};
}
export const neumipDefinition={id:'neumip',version:1,title:'Neural surface',supportsBurning:false,
 description:'Author NeuMIP appearance under native point, spot and directional lights. Requires UVs; environment and indirect response are not evaluated.',
 check:checkedNeumipParameters,
 describe:p=>`Checkpoint: ${p.source.url}\nSHA256: ${p.source.sha256}`,
 fields:[{key:'uvScale',label:'UV scale',type:'number',min:Number.MIN_VALUE,step:.05,default:3},{key:'gain',label:'Material gain',type:'number',min:Number.MIN_VALUE,step:.05,default:1}]};
