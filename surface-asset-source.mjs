// Stored fitted-surface bundles use the same mounted asset routes as ordinary GLBs.
export function isSurfaceAssetSource(source){
 try{const u=new URL(source,'http://localhost/'),p=u.searchParams.get('path')||'';return ['http:','https:'].includes(u.protocol)&&u.pathname==='/api/read'&&u.searchParams.get('root')==='generated-meshes'&&!p.startsWith('/')&&!p.split('/').includes('..')&&p.endsWith('.surface.json');}catch{return false;}
}
export function surfaceFieldURL(base,name){
 const u=new URL(base);if(u.pathname!=='/api/read')return new URL(name,u).href;
 const path=u.searchParams.get('path');if(!path||!u.searchParams.get('root'))throw Error('Surface source requires a mounted asset path');
 u.searchParams.set('path',decodeURIComponent(new URL(name,'https://asset.invalid/'+path).pathname.slice(1)));return u.href;
}
export function surfaceAssetSources(source,manifest){
 if(!isSurfaceAssetSource(source)||manifest?.schema!=='kaminos.surface-fields-asset.v1'||typeof manifest.name!=='string'||!manifest.name.trim())throw Error('Invalid stored surface asset');
 const relative=p=>typeof p==='string'&&p.length>0&&!p.startsWith('/')&&!p.includes('\\')&&!p.split('/').some(x=>x==='..'||x==='.')&&!/[?#:%]/.test(p);
 if(!relative(manifest.base)||!manifest.base.endsWith('/')||!relative(manifest.shadowProxy)||!manifest.shadowProxy.endsWith('/'))throw Error('Surface asset requires relative field and shadow directories');
 const required=[manifest.base+'report.json',manifest.base+'surfels.f32',manifest.base+'footprints.f32',manifest.shadowProxy+'report.json',manifest.shadowProxy+'positions.f32',manifest.shadowProxy+'triangles.u32'];
 const files=manifest.files;if(!files||required.some(p=>!relative(p)||!/^[a-f0-9]{64}$/.test(files[p]?.sha256)||!Number.isSafeInteger(files[p]?.bytes)||files[p].bytes<1))throw Error('Surface asset requires complete payload identities');
 return {base:surfaceFieldURL(source,manifest.base),shadowBase:surfaceFieldURL(source,manifest.shadowProxy),files:new Map(required.map(p=>[surfaceFieldURL(source,p),files[p]]))};
}
