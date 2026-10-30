// A frozen source export. CPU work here happens at admission, never in the frame loop.
export function validateFrozenHill(input,bounds){
  if(input?.schema!=='kaminos.frozen-hill.v1'||!input.source?.repo||!input.source?.commit||
    input.source.phase!=='frozen'||!input.source.sampleChecksum)throw Error('Invalid frozen Hill source');
  const g=input.grid;
  if(!g||![g.x,g.z].every(v=>Number.isSafeInteger(v)&&v>=2)||
    g.min?.length!==2||!g.min.every(Number.isFinite)||g.step?.length!==2||!g.step.every(v=>Number.isFinite(v)&&v>0))throw Error('Invalid Hill grid');
  if(input.heights?.length!==g.x*g.z||!input.heights.every(Number.isFinite))throw Error('Incomplete or invalid Hill heights');
  if(input.colors?.length!==g.x*g.z*3||!input.colors.every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('Invalid Hill colors');
  if(!Number.isFinite(input.transform?.scale)||input.transform.scale<=0||input.transform.translation?.length!==3||!input.transform.translation.every(Number.isFinite))throw Error('Invalid Hill transform');
  const heights=Float32Array.from(input.heights),colors=Float32Array.from(input.colors);
  if(!heights.every(Number.isFinite))throw Error('Hill heights exceed float32');
  const max=[g.min[0]+(g.x-1)*g.step[0],g.min[1]+(g.z-1)*g.step[1]];
  // Reserve one cell above the surface for particle clearance and APIC support.
  if(bounds&&(g.min[0]<bounds.min[0]||max[0]>bounds.max[0]||g.min[1]<bounds.min[2]||max[1]>bounds.max[2]||
    heights.some(y=>y<bounds.min[1]||y>bounds.max[1]-.05)))throw Error('Hill is outside the supported MLS domain');
  return {...structuredClone(input),grid:structuredClone(g),heights,colors};
}

export function buildFrozenHillGeometry(hill){
  const {grid:g,heights,colors}=hill,positions=new Float32Array(heights.length*3),indices=new Uint32Array((g.x-1)*(g.z-1)*6);
  for(let z=0;z<g.z;z++)for(let x=0;x<g.x;x++)positions.set([g.min[0]+x*g.step[0],heights[z*g.x+x],g.min[1]+z*g.step[1]],(z*g.x+x)*3);
  let offset=0;
  for(let z=0;z<g.z-1;z++)for(let x=0;x<g.x-1;x++){
    const a=z*g.x+x,b=a+1,c=a+g.x,d=c+1;indices.set([a,c,b,b,c,d],offset);offset+=6;
  }
  return {positions,colors,indices};
}

// Offline inspection oracle: uses the same triangle split as the visible mesh.
export function sampleFrozenHill(hill,x,z){
  const {grid:g,heights:h}=hill,ux=(x-g.min[0])/g.step[0],uz=(z-g.min[1])/g.step[1];
  if(ux<0||uz<0||ux>g.x-1||uz>g.z-1)return null;
  const ix=Math.min(Math.floor(ux),g.x-2),iz=Math.min(Math.floor(uz),g.z-2),fx=ux-ix,fz=uz-iz,a=iz*g.x+ix;
  const h00=h[a],h10=h[a+1],h01=h[a+g.x],h11=h[a+g.x+1];
  const first=fx+fz<=1,dx=first?h10-h00:h11-h01,dz=first?h01-h00:h11-h10;
  const height=first?h00+fx*dx+fz*dz:h11+(fx-1)*dx+(fz-1)*dz;
  const gx=dx/g.step[0],gz=dz/g.step[1],n=Math.hypot(gx,1,gz);
  return {height,normal:[-gx/n,1/n,-gz/n]};
}

export function hillContactWGSL(heightBinding,paramBinding){return `
  @group(0) @binding(${heightBinding}) var<storage,read> hillHeights:array<f32>;
  struct HillGrid { originStep:vec4f, shape:vec4u }
  @group(0) @binding(${paramBinding}) var<uniform> hill:HillGrid;
  // Returns height and slope in solver-cell coordinates, plus coverage.
  fn hillSample(p:vec2f)->vec4f {
    if(hill.shape.z==0u){return vec4f(0.);}
    let uv=(p-hill.originStep.xy)/hill.originStep.zw;
    let limit=vec2f(hill.shape.xy-vec2u(1));
    if(any(uv<vec2f(0.))||any(uv>limit)){return vec4f(0.);}
    let cell=min(vec2u(floor(uv)),hill.shape.xy-vec2u(2));
    let f=uv-vec2f(cell);let a=cell.y*hill.shape.x+cell.x;
    let h00=hillHeights[a];let h10=hillHeights[a+1u];
    let h01=hillHeights[a+hill.shape.x];let h11=hillHeights[a+hill.shape.x+1u];
    var dx=h10-h00;var dz=h01-h00;var h=h00+f.x*dx+f.y*dz;
    if(f.x+f.y>1.){dx=h11-h01;dz=h11-h10;h=h11+(f.x-1.)*dx+(f.y-1.)*dz;}
    return vec4f(h,dx/hill.originStep.z,dz/hill.originStep.w,1.);
  }
`;}
