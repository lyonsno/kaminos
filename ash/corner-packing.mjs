export const ashCornerPackingWGSL=`
fn ash_pack_corner(corner:vec4<f32>)->u32{
 let n=normalize(vec3<f32>(corner.z,1.0,corner.w));let o=n.xz/(abs(n.x)+n.y+abs(n.z));
 let q=vec2<u32>(round(clamp(o*.5+.5,vec2<f32>(0),vec2<f32>(1))*255.0));
 return q.x|(q.y<<8u)|(u32(round(clamp(corner.y,0.0,1.0)*255.0))<<16u);
}
fn ash_unpack_corner(code:u32,top:f32)->vec4<f32>{
 let o=vec2<f32>(f32(code&255u),f32((code>>8u)&255u))/255.0*2.0-1.0;
 let n=normalize(vec3<f32>(o.x,max(0.0,1.0-abs(o.x)-abs(o.y)),o.y));
 // Existing lighting normalizes (slopeX,1,slopeZ). Retain that direction.
 return vec4<f32>(top,f32((code>>16u)&255u)/255.0,n.x/max(n.y,1e-8),n.z/max(n.y,1e-8));
}
fn ash_cached_corner(i:u32,n:u32,top:f32,scratch:ptr<storage,array<u32>,read>,pair:ptr<storage,array<u32>,read>)->vec4<f32>{
 let a=(*scratch)[i];let b=(*pair)[i*2u];let c=(*pair)[i*2u+1u];var code=0u;
 switch n{case 0u:{code=a;}case 1u:{code=(a>>24u)|(b<<8u);}case 2u:{code=(b>>16u)|(c<<16u);}default:{code=c>>8u;}}
 return ash_unpack_corner(code&0xffffffu,top);
}`;
