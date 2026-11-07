import {SURFACE_SPLAT_EXTENSION} from './surface-splat-object.mjs';
import {checkedSurfaceSplatOptics} from './deferred-surface-splats.mjs';

// Keep the supplied proxy geometry and materials as the standard glTF fallback.
// The added buffer views carry the exact fitted surface, without quantizing it.
export function embedSurfaceSplats(source,{data,meta,footprints,depthTolerance}, {meshNode,optics={mode:'glass',ior:1.45,thickness:.06}}={}){
 optics=checkedSurfaceSplatOptics(optics);
 const bytes=new Uint8Array(source),header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.length<28||header.getUint32(0,true)!==0x46546c67||header.getUint32(4,true)!==2||header.getUint32(8,true)!==bytes.length||header.getUint32(16,true)!==0x4e4f534a)throw Error('Expected a complete GLB v2 proxy');
 const jsonSize=header.getUint32(12,true),binOffset=20+jsonSize;
 if(binOffset+8>bytes.length||header.getUint32(binOffset+4,true)!==0x004e4942)throw Error('Proxy needs an embedded binary buffer');
 const doc=JSON.parse(new TextDecoder().decode(bytes.subarray(20,binOffset))),bin=bytes.slice(binOffset+8);
 if(doc.buffers?.length!==1||doc.buffers[0].uri||doc.buffers[0].byteLength>bin.length)throw Error('Proxy needs one embedded buffer');
 const candidates=doc.nodes.flatMap((n,i)=>Number.isInteger(n.mesh)?[i]:[]);meshNode??=candidates.length===1?candidates[0]:undefined;
 if(!Number.isInteger(meshNode)||!doc.nodes[meshNode]||!Number.isInteger(doc.nodes[meshNode].mesh))throw Error('Select one proxy mesh node explicitly');
 if(doc.nodes[meshNode].extensions?.[SURFACE_SPLAT_EXTENSION])throw Error('Proxy already contains surface splats');
 if(meta.stride!==12||!Number.isSafeInteger(meta.count)||meta.count<1||!Number.isFinite(meta.radius)||meta.radius<=0)throw Error('Invalid surface splat metadata');
 const chunks=[bin],views=doc.bufferViews??(doc.bufferViews=[]);let length=bin.length;
 function add(array,width){
  if(!(array instanceof Float32Array)||array.length!==meta.count*width||!array.every(Number.isFinite))throw Error('Invalid surface splat field');
  const offset=length,chunk=new Uint8Array(array.buffer,array.byteOffset,array.byteLength);chunks.push(chunk);length+=chunk.length;
  views.push({buffer:0,byteOffset:offset,byteLength:chunk.length});return views.length-1;
 }
 const ext={version:1,count:meta.count,sourceCount:meta.sourceCount??meta.count,radius:meta.radius,data:add(data,12),footprints:add(footprints,8),optics};
 if(meta.adaptive&&!depthTolerance)throw Error('Adaptive splats require depth tolerance');
 if(depthTolerance)ext.depthTolerance=add(depthTolerance,1);
 if(meta.adaptive)ext.adaptive=meta.adaptive;
 doc.nodes[meshNode].extensions={...doc.nodes[meshNode].extensions,[SURFACE_SPLAT_EXTENSION]:ext};
 doc.extensionsUsed=[...new Set([...(doc.extensionsUsed??[]),SURFACE_SPLAT_EXTENSION])];doc.buffers[0].byteLength=length;
 const text=new TextEncoder().encode(JSON.stringify(doc)),padded=(text.length+3)&~3,result=new Uint8Array(28+padded+length),view=new DataView(result.buffer);
 view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,result.length,true);view.setUint32(12,padded,true);view.setUint32(16,0x4e4f534a,true);
 result.fill(32,20,20+padded);result.set(text,20);view.setUint32(20+padded,length,true);view.setUint32(24+padded,0x004e4942,true);
 let at=28+padded;for(const chunk of chunks){result.set(chunk,at);at+=chunk.length;}return result.buffer;
}
