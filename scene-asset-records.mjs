// File-backed assets keep their existing supported source routes. Successful
// validation here identifies a reconstruction route, not retained remote bytes.
const remote=source=>typeof source==='string'&&(source.startsWith('/api/')||source.startsWith('http://')||source.startsWith('https://'));
const demo=source=>typeof source==='string'&&source.startsWith('demos/');
export const sceneAssetRecordDomains=[
  {type:'glb',fields:()=>({}),reloadable:r=>remote(r.source)||demo(r.source),load:(r,l,o)=>l.glb(r,o)},
  {type:'image',fields:()=>({}),reloadable:r=>remote(r.source)||demo(r.source),load:(r,l,o)=>l.image(r,o)},
  {type:'pbr',fields:()=>({}),reloadable:r=>demo(r.source),load:(r,l,o)=>l.pbr(r,o)},
  {type:'splat',fields:()=>({}),reloadable:r=>remote(r.source),load:(r,l,o)=>l.splat(r,o),
    capture(entry,{readers}){const transform=readers.splatTransform(entry);return {transform,sceneTransform:transform};}},
];
