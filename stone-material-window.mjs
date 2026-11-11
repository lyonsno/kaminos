import {stoneTransitionRegion} from './stone-transition-source.mjs';

// Change the planar query domain by a rigid translation of the entire teacher.
// Stone dimensions, detailed triangles, material IDs and transport halo stay intact.
export function stoneMaterialWindow(source,window){
 if(window===undefined)return source;
 const {uvOrigin,uvScale}=window??{};
 if(source.schema!=='kaminos.stone-transition-source.v1'||!Array.isArray(uvOrigin)||uvOrigin.length!==2||!uvOrigin.every(Number.isFinite)||!Number.isFinite(uvScale)||uvScale<=0||uvScale>1||uvOrigin.some(v=>v<0||v+uvScale>1))throw Error('Invalid stone reference window');
 const worldCenter=[(uvOrigin[0]+uvScale/2-.5)*source.config.width,0,(uvOrigin[1]+uvScale/2-.5)*source.config.depth];
 const shift=p=>p.map((v,i)=>v-worldCenter[i]);
 const triangles=source.triangles.map(t=>({...t,a:shift(t.a),b:shift(t.b),c:shift(t.c),
  reference:Object.fromEntries(['a','b','c'].map(k=>[k,shift(t.reference[k])])),
  carrier:Object.fromEntries(['a','b','c'].map(k=>[k,shift(t.carrier[k])]))}));
 return {...source,triangles,stones:source.stones.map(s=>({...s,center:shift(s.center)})),
  captureDomain:{width:source.config.width*uvScale,depth:source.config.depth*uvScale},
  window:{uvOrigin:[...uvOrigin],uvScale,worldCenter,transform:'all teacher positions minus worldCenter; directions and physical dimensions unchanged',validity:'bounded reference window with original surrounding source; periodic latent lookup does not establish periodic source edges'}};
}

export function stoneWindowRegion(uv,source){
 const p=source.window?uv.map((v,i)=>source.window.uvOrigin[i]+v*source.window.uvScale):uv;
 return stoneTransitionRegion(p,source.config);
}

export function stoneWindowQuads(quads,window){
 if(!window)return quads;
 const [x,y]=window.uvOrigin,s=window.uvScale;
 return quads.map(([a,b,c,d])=>[Math.max(x,a),Math.max(y,b),Math.min(x+s,c),Math.min(y+s,d)])
  .filter(([a,b,c,d])=>a<c&&b<d).map(([a,b,c,d])=>[(a-x)/s,(b-y)/s,(c-x)/s,(d-y)/s]);
}

// Display-only clipping. The transport teacher retains every context triangle.
export function stoneWindowDisplayPositions(triangles,domain){
 const result=[];
 for(const t of triangles){
  let polygon=[t.a,t.b,t.c];
  for(const [axis,bound,sign]of [[0,-domain.width/2,1],[0,domain.width/2,-1],[2,-domain.depth/2,1],[2,domain.depth/2,-1]]){
   const next=[];
   for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length],da=sign*(a[axis]-bound),db=sign*(b[axis]-bound);
    if(da>=0)next.push(a);
    if((da>=0)!==(db>=0)){const f=da/(da-db);next.push(a.map((v,k)=>k===axis?bound:v+(b[k]-v)*f));}
   }
   polygon=next;if(!polygon.length)break;
  }
  for(let i=1;i+1<polygon.length;i++)result.push(...polygon[0],...polygon[i],...polygon[i+1]);
 }
 return result;
}
