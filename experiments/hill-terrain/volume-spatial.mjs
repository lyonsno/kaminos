// One center entry per represented body. Buckets contain linked lists, so
// neither dense cells nor bodies leaving the domain silently drop contacts.
export function volumeSpatialConfig(model,packed){
 const radius=Math.max(...model.bodies.map((_,i)=>packed.body[i*40+32]));
 if(!Number.isFinite(radius)||radius<=0)throw Error('Spatial contact needs bounded rock volumes');
 const width=Math.fround(2*radius*(1+1e-6)),dimensions=model.config.dimensions.map(v=>Math.max(1,Math.ceil(v*model.config.cell/width)));
 const bytes=new ArrayBuffer(32),f=new Float32Array(bytes),u=new Uint32Array(bytes);f.set([...model.config.origin,width]);u.set([...dimensions,model.bodies.length],4);
 return{width,radius,dimensions,cellCount:dimensions.reduce((n,v)=>n*v,1),uniform:new Uint8Array(bytes)};
}
