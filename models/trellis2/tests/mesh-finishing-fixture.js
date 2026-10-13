// Deterministic raw-mesh inputs for the browser finishing parity contracts.
// The bytes are produced here and recorded by export-mesh-finishing-fixtures.mjs
// together with the accepted source finisher's output for exactly these bytes.
function random(seed){
  return ()=>{seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
}

// Subdivided octahedron on a noisy sphere; returns positions and faces.
function octasphere(level,rand,{radius,center,noise}){
  let v=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  let f=[[0,2,4],[2,1,4],[1,3,4],[3,0,4],[2,0,5],[1,2,5],[3,1,5],[0,3,5]];
  for(let l=0;l<level;l++){
    const mid=new Map(),next=[];
    const m=(a,b)=>{const k=a<b?a+','+b:b+','+a;let i=mid.get(k);if(i===undefined){i=v.length;v.push(v[a].map((x,j)=>(x+v[b][j])/2));mid.set(k,i);}return i;};
    for(const [a,b,c] of f){const ab=m(a,b),bc=m(b,c),ca=m(c,a);next.push([a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]);}
    f=next;
  }
  const p=v.map(x=>{const n=Math.sqrt(x[0]*x[0]+x[1]*x[1]+x[2]*x[2]),s=radius*(1+noise*(rand()-.5))/n;return x.map((y,j)=>center[j]+y*s);});
  return {p,f};
}

function assemble(parts,rand,{removeFraction,flipFraction,duplicates,fins}){
  const positions=[],faces=[];
  for(const {p,f} of parts){
    const base=positions.length/3;positions.push(...p.flat());
    for(const [a,b,c] of f){
      if(rand()<removeFraction)continue;
      faces.push(rand()<flipFraction?[base+c,base+b,base+a]:[base+a,base+b,base+c]);
    }
  }
  // Fins: a third face on an existing edge makes that edge non-manifold.
  for(let i=0;i<fins;i++){
    const [a,b]=faces[Math.floor(rand()*faces.length)],tip=positions.length/3;
    positions.push(...[0,1,2].map(j=>positions[a*3+j]+(positions[b*3+j]-positions[a*3+j])*.5+.003*(rand()-.5)));
    faces.push([a,b,tip]);
  }
  for(let i=0;i<duplicates;i++){const [a,b,c]=faces[Math.floor(rand()*faces.length)];faces.push([b,c,a]);}
  return {vertices:Float32Array.from(positions),triangles:Uint32Array.from(faces.flat())};
}

export const MESH_FINISHING_CASES={
  // Large enough to need fast-simplification passes before cleanup.
  'simplify-route':{targetFaces:3000,build(){
    const rand=random(20261013),parts=[octasphere(6,rand,{radius:.5,center:[0,0,0],noise:.04})];
    for(let i=0;i<24;i++)parts.push(octasphere(1+Math.floor(rand()*2),rand,{radius:.004+.03*rand(),center:[0,1,2].map(()=>rand()*1.6-.8),noise:.1}));
    return assemble(parts,rand,{removeFraction:.01,flipFraction:.25,duplicates:12,fins:9});
  }},
  // Already below its target: the source cleans once, then runs final cleanup.
  'below-target':{targetFaces:20000,build(){
    const rand=random(7),parts=[];
    for(let i=0;i<14;i++)parts.push(octasphere(2+Math.floor(rand()*2),rand,{radius:.002+.04*rand(),center:[0,1,2].map(()=>rand()*.5-.25),noise:.15}));
    return assemble(parts,rand,{removeFraction:.04,flipFraction:.4,duplicates:20,fins:15});
  }},
};
