// Rate-form reference for the volume specimen. Compression is positive.
export function soilStress({pressure=0,deviator=Array(9).fill(0)},gradient,dt,{bulk=12000,shear=5000,friction=.65}={}){
 if(gradient.length!==9||deviator.length!==9||![pressure,dt,bulk,shear,friction,...gradient,...deviator].every(Number.isFinite)||dt<0||bulk<=0||shear<=0||friction<0)throw Error('Invalid soil material state');
 const trace=gradient[0]+gradient[4]+gradient[8],nextPressure=Math.max(0,pressure-bulk*trace*dt);
 const spin=gradient.map((v,i)=>(v-gradient[(i%3)*3+Math.floor(i/3)])*.5);
 const next=deviator.map((s,i)=>{
  const row=i%3,col=Math.floor(i/3);let objective=0;
  for(let k=0;k<3;k++)objective+=spin[k*3+row]*deviator[col*3+k]-deviator[k*3+row]*spin[col*3+k];
  const strain=(gradient[i]+gradient[row*3+col])*.5-(row===col?trace/3:0);
  return s+dt*(2*shear*strain+objective);
 });
 const q=Math.hypot(...next),scale=q>0?Math.min(1,friction*nextPressure/q):0;
 return {pressure:nextPressure,deviator:next.map(v=>v*scale)};
}

// Production WGSL; the browser numerical witness invokes this exact function.
export const SOIL_MATERIAL_WGSL=`
struct SoilStress { pressure:f32, deviator:mat3x3f }
fn soil_stress(pressure:f32,s:mat3x3f,L:mat3x3f,dt:f32,bulk:f32,shear:f32,friction:f32)->SoilStress{
 let tr=L[0].x+L[1].y+L[2].z;
 let p=max(0.,pressure-bulk*tr*dt);
 let I=mat3x3f(1.,0.,0.,0.,1.,0.,0.,0.,1.);
 let D=(L+transpose(L))*.5-I*(tr/3.);
 let W=(L-transpose(L))*.5;
 let trial=s+dt*(2.*shear*D+W*s-s*W);
 let q=sqrt(dot(trial[0],trial[0])+dot(trial[1],trial[1])+dot(trial[2],trial[2]));
 let scale=min(1.,friction*p/max(q,1e-20));
 return SoilStress(p,trial*scale);
}`;
