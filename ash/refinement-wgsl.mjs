const u3 = values => `vec3<u32>(${values.map(n => `${n}u`).join(',')})`;
const i3 = values => `vec3<i32>(${values.join(',')})`;

// The fixed-region slice compiles its compact address map into each consumer.
// Density, collision, airborne deposition and drawing therefore share ownership.
export function refinementAddressWGSL(p) {
  const regions = p.regions;
  return `
const ASH_FINE_DIMS = ${u3(p.dims)};
const ASH_CELL_COUNT:u32 = ${p.count}u;
const ASH_TILE_COUNT:u32 = ${p.tiles.count}u;
struct AshCell {lower:vec3<i32>,size:u32,tile:u32,owned:bool}
fn ash_locate(q:vec3<i32>)->u32 {
 if(any(q<vec3<i32>(0))||any(q>=vec3<i32>(ASH_FINE_DIMS))){return 0xffffffffu;}
 ${regions.slice(1).map(r => `if(all(q>=${i3(r.low)})&&all(q<${i3(r.high)})){
 let c=vec3<u32>(q-${i3(r.low)});return ${r.offset}u+c.x+${r.layout.dims[0]}u*(c.y+${r.layout.dims[1]}u*c.z);}`).join('\n')}
 let c=vec3<u32>(q)/2u;return c.x+${regions[0].layout.dims[0]}u*(c.y+${regions[0].layout.dims[1]}u*c.z);
}
fn index(c:vec3<u32>)->u32 {return ash_locate(vec3<i32>(c));}
fn ash_cell(i:u32)->AshCell {
 ${regions.map(r => `if(i>=${r.offset}u&&i<${r.offset + r.layout.count}u){
 let j=i-${r.offset}u;let c=vec3<u32>(j%${r.layout.dims[0]}u,(j/${r.layout.dims[0]}u)%${r.layout.dims[1]}u,j/${r.layout.dims[0] * r.layout.dims[1]}u);
 let q=${i3(r.low)}+vec3<i32>(c)*${r.scale};let t=c/${p.tiles.width}u;
 return AshCell(q,${r.scale}u,${r.tileOffset}u+t.x+${r.layout.tiles.dims[0]}u*(t.y+${r.layout.tiles.dims[1]}u*t.z),ash_locate(q)==i);
 }`).join('\n')}
 return AshCell(vec3<i32>(0),0u,0u,false);
}
fn ash_face_shape(i:u32,face:u32)->vec2<u32> {
 let c=ash_cell(i);if(c.size==1u){return vec2<u32>(1u);}
 if(face==3u){return vec2<u32>(2u);}
 let axis=face/2u;var q=c.lower;q[axis]+=select(-1,2,face%2u==1u);
 let j=ash_locate(q);var height=1u;
 if(j!=0xffffffffu&&ash_cell(j).size==1u){height=2u;}
 return vec2<u32>(2u,height);
}
fn ash_capacity(i:u32)->f32 {let s=ash_cell(i).size;return f32(s*s*s);}
fn ash_tile_cell(t:u32,local:u32)->u32 {
 ${regions.map(r => `if(t>=${r.tileOffset}u&&t<${r.tileOffset + r.layout.tiles.count}u){
 let j=t-${r.tileOffset}u;let tc=vec3<u32>(j%${r.layout.tiles.dims[0]}u,(j/${r.layout.tiles.dims[0]}u)%${r.layout.tiles.dims[1]}u,j/${r.layout.tiles.dims[0] * r.layout.tiles.dims[1]}u);
 let c=tc*${p.tiles.width}u+vec3<u32>(local%${p.tiles.width}u,(local/${p.tiles.width}u)%${p.tiles.width}u,local/${p.tiles.width ** 2}u);
 if(any(c>=${u3(r.layout.dims)})){return 0xffffffffu;}
 return ${r.offset}u+c.x+${r.layout.dims[0]}u*(c.y+${r.layout.dims[1]}u*c.z);
 }`).join('\n')}
 return 0xffffffffu;
}`;
}
