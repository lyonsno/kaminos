// Rigid dual-quaternion transport. No field projection or painted-field fitting.
function multiply(a,b){return [a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3],
  a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2],a[0]*b[2]+a[2]*b[0]+a[3]*b[1]-a[1]*b[3],
  a[0]*b[3]+a[3]*b[0]+a[1]*b[2]-a[2]*b[1]];}
function rigidQuaternion(e){
  if(e.length!==16||!Array.from(e).every(Number.isFinite))throw Error('Invalid rigid matrix');
  const dot=(a,b)=>e[a]*e[b]+e[a+1]*e[b+1]+e[a+2]*e[b+2];
  if(Math.abs(dot(0,0)-1)>1e-5||Math.abs(dot(4,4)-1)>1e-5||Math.abs(dot(8,8)-1)>1e-5||
     Math.abs(dot(0,4))>1e-5||Math.abs(dot(0,8))>1e-5||Math.abs(dot(4,8))>1e-5||
     Math.abs(e[3])+Math.abs(e[7])+Math.abs(e[11])+Math.abs(e[15]-1)>1e-5)throw Error('Bone scaling/non-rigid transforms are unsupported');
  const det=e[0]*(e[5]*e[10]-e[9]*e[6])-e[4]*(e[1]*e[10]-e[9]*e[2])+e[8]*(e[1]*e[6]-e[5]*e[2]);
  if(det<0)throw Error('Reflected bone transforms are unsupported');
  const values=[1+e[0]+e[5]+e[10],1+e[0]-e[5]-e[10],1-e[0]+e[5]-e[10],1-e[0]-e[5]+e[10]];
  const i=values.indexOf(Math.max(...values)),v=Math.sqrt(Math.max(values[i],0))*.5,d=4*v;
  const q=i===0?[v,(e[6]-e[9])/d,(e[8]-e[2])/d,(e[1]-e[4])/d]:
    i===1?[(e[6]-e[9])/d,v,(e[4]+e[1])/d,(e[8]+e[2])/d]:
    i===2?[(e[8]-e[2])/d,(e[4]+e[1])/d,v,(e[9]+e[6])/d]:
    [(e[1]-e[4])/d,(e[8]+e[2])/d,(e[9]+e[6])/d,v];
  const norm=Math.hypot(...q);return q.map(x=>x/norm);
}
export function transportDualQuaternions(matrices,{rotationParents=null}={}){
 const real=matrices.map(rigidQuaternion),dual=matrices.map((e,i)=>multiply([0,e[12],e[13],e[14]],real[i]).map(x=>x*.5));
 if(rotationParents!==null){
  if(rotationParents.length!==real.length||Array.from(rotationParents).some((p,j)=>!Number.isInteger(p)||p< -1||p>=real.length||p===j))throw Error('Invalid rotation parent hierarchy');
  const visited=new Uint8Array(real.length);
  const align=j=>{
   if(visited[j]===1)throw Error('Cyclic rotation parent hierarchy');if(visited[j]===2)return;visited[j]=1;
   const p=rotationParents[j];if(p>=0){align(p);if(real[j].reduce((s,x,k)=>s+x*real[p][k],0)<0){real[j]=real[j].map(x=>-x);dual[j]=dual[j].map(x=>-x);}}
   visited[j]=2;
  };
  real.forEach((_,j)=>align(j));
 }
 return {real,dual};
}
export function skinTransport(rest,weights,matrices,{rotationParents=null}={}){
  const channels=matrices.length,n=rest.length/3;
  if(!Number.isInteger(n)||weights.length!==n*channels||!channels)throw Error('Incomplete transport arrays');
  const {real,dual}=transportDualQuaternions(matrices,{rotationParents});
  const output=new Float32Array(rest.length);
  for(let v=0;v<n;v++){
    let dominant=0,total=0;
    for(let j=0;j<channels;j++){const w=weights[v*channels+j];if(!Number.isFinite(w)||w<0)throw Error('Invalid transport influence');total+=w;if(w>weights[v*channels+dominant])dominant=j;}
    if(Math.abs(total-1)>1e-5)throw Error('Incomplete transport partition');
    const anchor=real[dominant],r=[0,0,0,0],d=[0,0,0,0];
    for(let j=0;j<channels;j++){
      let w=weights[v*channels+j];if(!w)continue;
      if(rotationParents===null&&real[j].reduce((s,x,k)=>s+x*anchor[k],0)<0)w=-w;
      for(let k=0;k<4;k++){r[k]+=w*real[j][k];d[k]+=w*dual[j][k];}
    }
    const norm=Math.hypot(...r);if(norm<1e-10)throw Error('Singular transport rotation');
    for(let k=0;k<4;k++){r[k]/=norm;d[k]/=norm;}
    const parallel=r.reduce((s,x,k)=>s+x*d[k],0);for(let k=0;k<4;k++)d[k]-=r[k]*parallel;
    const [w,x,y,z]=r,px=rest[v*3],py=rest[v*3+1],pz=rest[v*3+2];
    if(!Number.isFinite(px)||!Number.isFinite(py)||!Number.isFinite(pz))throw Error('Invalid rest geometry');
    const tx=2*(y*pz-z*py),ty=2*(z*px-x*pz),tz=2*(x*py-y*px);
    const translation=multiply(d,[w,-x,-y,-z]);
    output[v*3]=px+w*tx+y*tz-z*ty+2*translation[1];
    output[v*3+1]=py+w*ty+z*tx-x*tz+2*translation[2];
    output[v*3+2]=pz+w*tz+x*ty-y*tx+2*translation[3];
  }
  return output;
}

export function validateLiveManifest(m){
  if(!['kaminos.live-transport.v1','kaminos.live-transport.v2','kaminos.live-transport.v3'].includes(m?.schema)||m.status!=='completed'||m.candidatePaintedWeights!==false)throw Error('Invalid or incomplete live transport case');
  const paired=m.schema==='kaminos.live-transport.v1';
  const whole=m.schema==='kaminos.live-transport.v3';
  if(!/^[a-f0-9]{64}$/.test(m.sourceSha256)||!Number.isSafeInteger(m.vertices)||m.vertices<=0||!Number.isSafeInteger(m.triangles)||m.triangles<=0||!m.sourceCast||
     (paired&&(m.vertices!==50501||m.triangles!==86392||m.sourceCast!=='CAT_CAST_MANNEQUIN_80413_STRONG')))throw Error('Wrong or partial source cast');
  if(!paired){
    if(m.reference?.kind!=='none'||!m.reference.reason||m.assets?.['painted-weights.bin']||m.assets?.['blender-reference.bin'])throw Error('Unsupported or fabricated painted reference');
    if(['packageSha256','rigSourceSha256','frameChainSha256'].some(name=>!/^[a-f0-9]{64}$/.test(m.provenance?.[name])))throw Error('Missing frame/source provenance');
  }
  const expected=whole?['fixed',...(m.bones??[]).map(b=>b.name)]:['fixed','pelvis',...['left','right'].flatMap(side=>['hip','stifle','hock'].map(joint=>`hindlimb-${side}-${joint}`))];
  if(JSON.stringify(m.channels)!==JSON.stringify(expected)||!m.bones?.length||(!whole&&m.bones.length!==7)||new Set(m.bones.map(b=>b.name)).size!==m.bones.length)throw Error('Wrong given control inventory');
  const boneNames=new Set(m.bones.map(b=>b.name));
  if(m.bones.some(b=>!expected.includes(b.name)||b.parent&&!boneNames.has(b.parent)))throw Error('Unresolved bone hierarchy');
  for(const b of m.bones){const seen=new Set();let n=b.name;while(n){if(seen.has(n))throw Error('Cyclic bone hierarchy');seen.add(n);n=m.bones.find(x=>x.name===n)?.parent;}}
  if(!Array.isArray(m.presets)||!m.presets.length)throw Error('Missing source poses');
  const required=[['rest.bin',[m.vertices,3],'<f4'],['triangles.bin',[m.triangles,3],'<u4'],
    ['automatic-weights.bin',[m.vertices,expected.length],'<f4'],['automatic-presets.bin',[m.presets.length,m.vertices,3],'<f4']];
  if(paired)required.push(['painted-weights.bin',[m.vertices,8],'<f4'],['blender-reference.bin',[m.presets.length,m.vertices,3],'<f4']);
  for(const [name,shape,dtype]of required){
    const asset=m.assets?.[name];
    if(!asset||asset.dtype!==dtype||JSON.stringify(asset.shape)!==JSON.stringify(shape)||asset.bytes!==shape.reduce((a,b)=>a*b,4)||!/^[a-f0-9]{64}$/.test(asset.sha256))throw Error('Invalid or incomplete live asset '+name);
  }
  return m;
}
