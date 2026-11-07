export function microstructureFileURL(base,name){
  const url=new URL(base);
  if(url.pathname==='/api/read'){url.searchParams.set('path',(url.searchParams.get('path')??'')+name);return url;}
  return new URL(name,url);
}

export function assertMicroFieldSource(source,model){
  if(typeof source.sourceSHA256!=='string'||!source.sourceSHA256||source.sourceSHA256!==model.sourceSHA256||source.carrierCount!==model.carrierCount||source.radius!==model.radius)throw Error('Learned field belongs to a different source/carrier set');
  for(const name of ['rows.f32','carriers.f32','source-ids.u32'])if(!source.files?.[name]?.sha256||source.files[name].sha256!==model.sourceFiles?.[name]?.sha256)throw Error(`Learned field source identity differs: ${name}`);
}

export function packMicroField(meta,arrays){
  const {grid:g,features:f,width:w,carrierCount:c}=meta;
  const output=['distance/radius','nx','ny','nz','srgb.r','srgb.g','srgb.b','metallic','roughness'];
  if(meta.schema!=='kaminos.microstructure-field.v1'||![g,f,w,c].every(n=>Number.isSafeInteger(n)&&n>0)||g<2||!Number.isFinite(meta.radius)||meta.radius<=0||meta.hiddenActivation!=='relu'||meta.distanceActivation!=='softplus'||meta.interpolation!=='trilinear'||meta.gridOrder!=='carrier,x,y,z,feature'||meta.output?.length!==output.length||output.some((name,i)=>meta.output[i]!==name))throw Error('Unsupported learned field layout');
  const expected={grid:[c*g**3,f],'layers.0.weight':[w,f+3],'layers.0.bias':[w],'layers.1.weight':[w,w],'layers.1.bias':[w],'layers.2.weight':[9,w],'layers.2.bias':[9]};
  for(const [name,shape]of Object.entries(expected)){
    const descriptor=meta.files?.[name],data=arrays[name];
    if(!descriptor||descriptor.dtype!=='float32'||descriptor.shape?.length!==shape.length||descriptor.shape.some((n,i)=>n!==shape[i])||!(data instanceof Float32Array)||data.length!==shape.reduce((a,b)=>a*b,1)||!data.every(Number.isFinite))throw Error(`Learned field parameter layout differs: ${name}`);
  }
  const names=Object.keys(expected).filter(n=>n!=='grid'),parameters=new Float32Array(names.reduce((sum,name)=>sum+arrays[name].length,0)),offsets={};let cursor=0;
  for(const name of names){offsets[name]=cursor;parameters.set(arrays[name],cursor);cursor+=arrays[name].length;}
  return {meta,grid:arrays.grid,parameters,offsets};
}

export async function loadMicroField(base,{fetcher=fetch,digest=bytes=>crypto.subtle.digest('SHA-256',bytes)}={}){
  const response=await fetcher(microstructureFileURL(base,'model.json'));if(!response.ok)throw Error(`Learned model HTTP ${response.status}`);
  const meta=await response.json(),arrays={};
  for(const name of ['grid','layers.0.weight','layers.0.bias','layers.1.weight','layers.1.bias','layers.2.weight','layers.2.bias']){
    const descriptor=meta.files?.[name];if(!descriptor)throw Error(`Missing learned parameter ${name}`);
    const response=await fetcher(microstructureFileURL(base,descriptor.file));if(!response.ok)throw Error(`Learned parameter HTTP ${response.status}`);
    const bytes=await response.arrayBuffer(),sha=Array.from(new Uint8Array(await digest(bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(bytes.byteLength!==descriptor.bytes||sha!==descriptor.sha256)throw Error(`Learned parameter hash/size differs: ${name}`);
    arrays[name]=new Float32Array(bytes);
  }
  return packMicroField(meta,arrays);
}

export function decodeMicroField(model,id,position){
  const {meta:{grid:g,features:f,width:w,carrierCount:c},grid,parameters:p,offsets:o}=model;
  if(!Number.isInteger(id)||id<0||id>=c||position.length!==3||!position.every(Number.isFinite))throw Error('Matching carrier and finite normalized position required');
  const v=position.map(n=>Math.max(0,Math.min(1,n))),q=v.map(n=>n*(g-1)),low=q.map(n=>Math.min(g-2,Math.floor(n))),fraction=q.map((n,i)=>n-low[i]),input=new Float64Array(f+3);
  for(let x=0;x<2;x++)for(let y=0;y<2;y++)for(let z=0;z<2;z++){
    const index=((id*g+low[0]+x)*g+low[1]+y)*g+low[2]+z,weight=(x?fraction[0]:1-fraction[0])*(y?fraction[1]:1-fraction[1])*(z?fraction[2]:1-fraction[2]);
    for(let j=0;j<f;j++)input[j]+=grid[index*f+j]*weight;
  }
  input.set(v.map(n=>n*2-1),f);let values=input;
  for(let layer=0;layer<3;layer++){
    const size=layer===2?9:w,next=new Float64Array(size),weights=o[`layers.${layer}.weight`],bias=o[`layers.${layer}.bias`];
    for(let j=0;j<size;j++){let sum=p[bias+j];for(let k=0;k<values.length;k++)sum+=values[k]*p[weights+j*values.length+k];next[j]=layer===2?sum:Math.max(0,sum);}
    values=next;
  }
  values[0]=Math.max(values[0],0)+Math.log1p(Math.exp(-Math.abs(values[0])));return Array.from(values);
}

export function microFieldWGSL(model){
  const {meta:{grid:g,features:f,width:w},offsets:o}=model;
  return `fn micro_field_decode(id:u32,position:vec3<f32>,grid:ptr<storage,array<f32>,read>,parameters:ptr<storage,array<f32>,read>)->mat3x3<f32>{
 let p=clamp(position,vec3<f32>(0.0),vec3<f32>(1.0));let q=p*${g-1}.0;
 let low=vec3<u32>(min(floor(q),vec3<f32>(${g-2}.0)));let fraction=q-vec3<f32>(low);
 var inputs:array<f32,${f+3}>;
 for(var x=0u;x<2u;x++){for(var y=0u;y<2u;y++){for(var z=0u;z<2u;z++){
  let index=((id*${g}u+low.x+x)*${g}u+low.y+y)*${g}u+low.z+z;
  let weight=select(1.0-fraction.x,fraction.x,x==1u)*select(1.0-fraction.y,fraction.y,y==1u)*select(1.0-fraction.z,fraction.z,z==1u);
  for(var j=0u;j<${f}u;j++){inputs[j]+=(*grid)[index*${f}u+j]*weight;}
 }}}
 inputs[${f}]=p.x*2.0-1.0;inputs[${f+1}]=p.y*2.0-1.0;inputs[${f+2}]=p.z*2.0-1.0;
 var a:array<f32,${w}>;var b:array<f32,${w}>;var result:array<f32,9>;
 for(var j=0u;j<${w}u;j++){var sum=(*parameters)[${o['layers.0.bias']}u+j];for(var k=0u;k<${f+3}u;k++){sum+=inputs[k]*(*parameters)[${o['layers.0.weight']}u+j*${f+3}u+k];}a[j]=max(sum,0.0);}
 for(var j=0u;j<${w}u;j++){var sum=(*parameters)[${o['layers.1.bias']}u+j];for(var k=0u;k<${w}u;k++){sum+=a[k]*(*parameters)[${o['layers.1.weight']}u+j*${w}u+k];}b[j]=max(sum,0.0);}
 for(var j=0u;j<9u;j++){var sum=(*parameters)[${o['layers.2.bias']}u+j];for(var k=0u;k<${w}u;k++){sum+=b[k]*(*parameters)[${o['layers.2.weight']}u+j*${w}u+k];}result[j]=sum;}
 result[0]=max(result[0],0.0)+log(1.0+exp(-abs(result[0])));
 return mat3x3<f32>(vec3<f32>(result[0],result[1],result[2]),vec3<f32>(result[3],result[4],result[5]),vec3<f32>(result[6],result[7],result[8]));
}`;
}
