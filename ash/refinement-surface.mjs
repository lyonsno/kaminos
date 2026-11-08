import {ashCornerPackingWGSL} from './corner-packing.mjs';
import {refinementAddressWGSL} from './refinement-wgsl.mjs';

// Both levels reconstruct corners at the same finest-grid positions. Coarse
// top faces are subdivided there as well, including their shared boundary edge.
export function refinementVertexWGSL(p, arena, {cached=false}={}) {
  let code = `fn ash_refined_vertex(rank:u32,uv:vec2<f32>,soft:f32,density:ptr<storage,array<f32>,read>,solid:ptr<storage,array<u32>,read>,faces:ptr<storage,array<u32>,read>,arena:ptr<storage,array<u32>,read>)->vec4<f32>{
 let address=ash_refined_face_code(rank,faces,arena);let tile=address.x;let code=address.y;
 let local=code/24u;let face=(code%24u)/4u;let sub=code%4u;
 let i=ash_tile_cell(tile,local);let c=ash_cell(i);let size=f32(c.size);
 let shape=ash_face_shape(i,face);let width=size/f32(shape.x);let height=size/f32(shape.y);
 let u=f32(sub%shape.x)*width;let v=f32(sub/shape.x)*height;
 let top=f32(c.lower.y)+(*density)[i]/ash_capacity(i)*size;
 var point=vec3<f32>(c.lower);
 if(face==3u){
  point.x+=u+uv.x*width;point.z+=v+(1.0-uv.y)*width;point.y=top;
 }else{
  let axis=face/2u;let tangent=select(0u,2u,axis==0u);
  point[axis]+=select(0.0,size,face%2u==1u);
  point[tangent]+=u+select(uv.x,1.0-uv.x,face==1u||face==4u)*width;
  var q=c.lower;q[axis]+=select(-1,i32(c.size),face%2u==1u);q[tangent]+=i32(u);q.y+=i32(v);
  let j=ash_locate(q);var other=f32(c.lower.y);
  if(j!=0xffffffffu){let n=ash_cell(j);other=f32(n.lower.y)+select((*density)[j]/ash_capacity(j),1.0,(*solid)[j]!=0u)*f32(n.size);}
  let bottom=max(f32(c.lower.y)+v,other);let upper=min(top,f32(c.lower.y)+v+height);
  point.y=mix(bottom,upper,uv.y);
 }
 let above=ash_locate(c.lower+vec3<i32>(0,i32(c.size),0));
 var capped=false;
 if(above!=0xffffffffu){capped=(*solid)[above]!=0u||(*density)[above]>0.0001;}
 var corner=vec4<f32>(top,1.0,0.0,0.0);
 if(!capped){corner=ash_refined_corner(vec2<i32>(round(point.xz)),top,density,solid);}
 // Apply the field edge treatment to subsurface walls as well as top faces.
 let edge=min(min(point.x,f32(ASH_FINE_DIMS.x)-point.x),min(point.z,f32(ASH_FINE_DIMS.z)-point.z));
 let span=clamp(f32(min(ASH_FINE_DIMS.x,ASH_FINE_DIMS.z))*0.04,1.5,8.0);
 corner.y=min(corner.y,clamp(0.22+0.78*edge/span,0.0,1.0));
 // Keep geometry on its physical fill bands. Averaging positions across
 // stacked cells folds top/side faces; only lighting normals are smoothed.
 var normal=vec3<f32>(0.0);normal[face/2u]=select(-1.0,1.0,face%2u==1u);
 let gradient=vec3<f32>(corner.z,1.0,corner.w);
 normal=normalize(mix(normal,normalize(gradient),soft*select(0.35,0.95,face==3u)));
 let nx=u32(round(clamp(normal.x*0.5+0.5,0.0,1.0)*255.0));
 let nz=u32(round(clamp(normal.z*0.5+0.5,0.0,1.0)*255.0));
 let cover=u32(round(corner.y*255.0));
 return vec4<f32>(vec3<f32>(${p.origin.join(',')})+point*${p.cellSize.toFixed(12)},f32(cover+256u*(nx+256u*nz)));
}

${refinementFaceLookupWGSL(p,arena)}
${refinementAddressWGSL(p)}
fn ash_refined_height(x:i32,z:i32,reference:f32,density:ptr<storage,array<f32>,read>,solid:ptr<storage,array<u32>,read>)->f32{
 if(x<0||z<0||x>=i32(ASH_FINE_DIMS.x)||z>=i32(ASH_FINE_DIMS.z)){return -1000000.0;}
 let cy=i32(floor(reference));
 for(var y=min(i32(ASH_FINE_DIMS.y)-1,cy+3);y>=max(0,cy-4);y--){
  let i=ash_locate(vec3<i32>(x,y,z));if(i==0xffffffffu||(*solid)[i]!=0u){continue;}
  let c=ash_cell(i);let fill=(*density)[i]/ash_capacity(i);
  if(fill<0.0001){continue;}
  let above=ash_locate(c.lower+vec3<i32>(0,i32(c.size),0));
  if(above!=0xffffffffu&&(*density)[above]>0.0001){continue;}
  return f32(c.lower.y)+fill*f32(c.size);
 }
 return -1000000.0;
}
fn ash_refined_corner(q:vec2<i32>,reference:f32,density:ptr<storage,array<f32>,read>,solid:ptr<storage,array<u32>,read>)->vec4<f32>{
 let a=ash_refined_height(q.x-1,q.y-1,reference,density,solid);
 let b=ash_refined_height(q.x,q.y-1,reference,density,solid);
 let c=ash_refined_height(q.x-1,q.y,reference,density,solid);
 let d=ash_refined_height(q.x,q.y,reference,density,solid);
 let va=select(0.0,a,a> -999999.0);let vb=select(0.0,b,b> -999999.0);
 let vc=select(0.0,c,c> -999999.0);let vd=select(0.0,d,d> -999999.0);
 let count=select(0.0,1.0,a> -999999.0)+select(0.0,1.0,b> -999999.0)+select(0.0,1.0,c> -999999.0)+select(0.0,1.0,d> -999999.0);
 let height=select(reference,(va+vb+vc+vd)/max(count,1.0),count>0.0);
 let edge=min(min(f32(q.x),f32(ASH_FINE_DIMS.x)-f32(q.x)),min(f32(q.y),f32(ASH_FINE_DIMS.z)-f32(q.y)));
 let span=clamp(f32(min(ASH_FINE_DIMS.x,ASH_FINE_DIMS.z))*0.04,1.5,8.0);
 let cover=min(clamp(0.24+0.22*count,0.0,1.0),clamp(0.22+0.78*edge/span,0.0,1.0));
 return vec4<f32>(height,cover,0.5*((va+vc)-(vb+vd)),0.5*((va+vb)-(vc+vd)));
}`;
  if(p.adaptive||p.hierarchy){
    // Every address helper receives the same storage pointer already used by
    // the vertex consumer; no extra render binding or CPU topology mirror.
    const fixed=refinementAddressWGSL(p);
    const dynamic=refinementAddressWGSL(p,{load:i=>`(*ashMap)[${i}]`,parameter:true});
    const cut=code.indexOf(fixed);const before=code.slice(0,cut),after=code.slice(cut+fixed.length);
    function passMap(source){
      const names=['ash_locate','ash_cell','ash_capacity','ash_tile_cell','ash_face_shape','ash_refined_height','ash_refined_corner'];
      for(const name of names){
        let cursor=0;
        while((cursor=source.indexOf(name+'(',cursor))>=0){
          const open=cursor+name.length;let end=open+1,depth=1;
          while(depth){if(source[end]==='(')depth++;if(source[end]===')')depth--;end++;}
          const declaration=source.slice(Math.max(0,cursor-3),cursor)==='fn ';
          const param=declaration?',arena:ptr<storage,array<u32>,read>':',arena';
          source=source.slice(0,end-1)+param+source.slice(end-1);cursor=end+param.length;
        }
      }return source;
    }
    code=passMap(before)+dynamic+passMap(after);
  }
  if(cached){
    code=code.replace('arena:ptr<storage,array<u32>,read>)->vec4<f32>{','arena:ptr<storage,array<u32>,read>,scratch:ptr<storage,array<u32>,read>,pairs:ptr<storage,array<u32>,read>)->vec4<f32>{');
    code=code.replace('if(!capped){corner=ash_refined_corner', 'if(c.size==1u){let at=vec2<u32>(vec2<i32>(round(point.xz))-c.lower.xz);corner=ash_cached_corner(i,at.x+2u*at.y,top,scratch,pairs);}else if(!capped){corner=ash_refined_corner');
    code+='\n'+ashCornerPackingWGSL;
  }
  return code;
}

// The physical face code is identical for both derived encodings. Checkpoints
// store material and ownership, so changing this cache needs no state migration.
export function refinementFaceLookupWGSL(p,arena){
 const lookup=arena.surfaceCache?.encoding==='cell-masks'?`
 let base=tile*${p.tiles.cellsPerTile*2}u;var lo=0u;var hi=${p.tiles.cellsPerTile}u;
 loop{if(lo>=hi){break;}let mid=(lo+hi)/2u;if((*faces)[base+mid*2u+1u]<=slot){lo=mid+1u;}else{hi=mid;}}
 var before=0u;if(lo>0u){before=(*faces)[base+(lo-1u)*2u+1u];}
 var mask=(*faces)[base+lo*2u];
 for(var n=0u;n<slot-before;n++){mask&=mask-1u;}
 let code=lo*24u+firstTrailingBit(mask);`:`let code=(*faces)[(*arena)[tile*8u+4u]+slot];`;
 return `fn ash_refined_face_code(rank:u32,faces:ptr<storage,array<u32>,read>,arena:ptr<storage,array<u32>,read>)->vec2<u32>{
 var low=0u;var high=${p.tiles.count}u;
 loop{if(low>=high){break;}let mid=(low+high)/2u;if((*arena)[${arena.prefix}u+mid+1u]<=rank){low=mid+1u;}else{high=mid;}}
 let tile=low;let slot=rank-(*arena)[${arena.prefix}u+tile];
 ${lookup}
 return vec2<u32>(tile,code);
}`;
}

export const refinementNormalWGSL = `fn ash_refined_normal(packed:f32)->vec3<f32>{
 let bits=u32(round(packed));
 let x=f32((bits>>8u)&255u)/255.0*2.0-1.0;
 let z=f32((bits>>16u)&255u)/255.0*2.0-1.0;
 return normalize(vec3<f32>(x,sqrt(max(0.0001,1.0-x*x-z*z)),z));
}`;

export const refinementOpacityWGSL = `fn ash_refined_opacity(cover:f32,point:vec3<f32>,origin:vec3<f32>,size:f32)->f32{
 if(cover>=0.995){return 1.0;}
 let p=(point.xz-origin.xz)/size;
 let grain=fract(sin(dot(floor(p*8.0),vec2<f32>(127.1,311.7)))*43758.5453);
 let broad=fract(sin(dot(floor(p*0.5),vec2<f32>(269.5,183.3)))*43758.5453);
 return select(0.0,1.0,cover>0.24+0.40*broad+0.28*grain);
}`;
