export const LEGACY_STONE_SOURCE_SHA256='33eb6f774a3b2bd52751c052029b529359957a71ec3eeee2e93c51bee46d8011';
const digest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const defaultSupport={kind:'clamp-min',axis:0,band:.035};
function requireSupport(value){
 if(value?.kind==='none')return{kind:'none'};
 if(value?.kind!=='clamp-min'||!Number.isInteger(value.axis)||value.axis<0||value.axis>2||!Number.isFinite(value.band)||value.band<=0)throw Error('Explicit finite specimen support required');
 return{kind:'clamp-min',axis:value.axis,band:value.band};
}

export function admitStoneSource(manifest,{baseUrl}={}){
 if(manifest?.status!=='passed'||manifest.model?.kind!=='graph'||!digest(manifest.sourceSha256))throw Error('Admitted material source manifest required');
 if(manifest.sourceAsset===undefined){
  if(manifest.sourceSha256!==LEGACY_STONE_SOURCE_SHA256)throw Error('Non-default material requires its verified source asset');
  return{asset:null,support:requireSupport(manifest.support??defaultSupport)};
 }
 const asset=manifest.sourceAsset;
 if(!asset||!digest(asset.sha256)||asset.sha256!==manifest.sourceSha256||typeof asset.id!=='string'||!asset.id.trim()||typeof asset.url!=='string'||!asset.url.trim()||!Number.isSafeInteger(asset.triangles)||asset.triangles<=0)throw Error('Matching source asset identity and triangle inventory required');
 if(asset.label!==undefined&&(typeof asset.label!=='string'||!asset.label.trim()))throw Error('Finite source asset label required');
 const url=new URL(asset.url,baseUrl);if(!['http:','https:'].includes(url.protocol))throw Error('HTTP source asset route required');
 return{asset:{...asset,url:url.href},support:requireSupport(manifest.support)};
}

export function stoneSupportNodes(positions,support=defaultSupport){
 support=requireSupport(support);
 if(!Array.isArray(positions)||!positions.length||!positions.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)))throw Error('Complete finite material positions required for support');
 if(support.kind==='none')return[];
 const minimum=positions.reduce((v,p)=>Math.min(v,p[support.axis]),Infinity);
 return positions.flatMap((p,i)=>p[support.axis]<minimum+support.band?[i]:[]);
}
