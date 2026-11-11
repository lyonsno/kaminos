import {periodicSurfaceTriangles} from './periodic-surface-source.mjs';
// Frozen explicit surfaces. Random numbers describe the source once; camera
// motion never changes strand identity or geometry.
export function createGrassTeacherSource(options={}) {
 const config={periodic:false,seed:31,blades:72,height:.8,width:2.4,depth:1.8,bladeWidth:.045,bend:.45,segments:7,...options};
 if(config.lengthLogSigma!==undefined&&(!Number.isFinite(config.lengthLogSigma)||config.lengthLogSigma<0))throw Error('lengthLogSigma must be nonnegative and finite');
 if(typeof config.periodic!=='boolean')throw Error('periodic must be a boolean');
 for(const key of ['height','width','depth','bladeWidth'])if(!Number.isFinite(config[key])||config[key]<=0)throw Error(`${key} must be positive and finite`);
 if(!Number.isSafeInteger(config.seed)||!Number.isSafeInteger(config.blades)||config.blades<1||!Number.isSafeInteger(config.segments)||config.segments<2||!Number.isFinite(config.bend))throw Error('finite seed/bend and positive integer blade/segment counts required');
 const tufts=config.tufts;
 if(tufts!==undefined){
  const pair=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
  if(!tufts||!Array.isArray(tufts.centres)||!tufts.centres.length||!tufts.centres.every(pair)||!Number.isFinite(tufts.radius)||tufts.radius<=0||!['uniform','radial'].includes(tufts.grading)||!Number.isFinite(tufts.rimFraction)||tufts.rimFraction<=0||tufts.rimFraction>1||!Array.isArray(tufts.cuts)||!tufts.cuts.every(c=>c&&pair(c.min)&&pair(c.max)&&c.min.every((v,i)=>v<c.max[i])&&Number.isFinite(c.height)&&c.height>0))throw Error('Invalid tuft centres, radius, grading, rimFraction or cut patches');
 }
 let state=config.seed>>>0;
 const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 // A separate stream supplies the Gaussian phase without moving any root,
 // width or orientation draws in the existing source sequence.
 let lengthState=(config.seed^0x9e3779b9)>>>0;
 const normalFrom=u=>{lengthState=(Math.imul(lengthState,1664525)+1013904223)>>>0;return Math.sqrt(-2*Math.log(u+1/8589934592))*Math.cos(2*Math.PI*(lengthState+.5)/4294967296);};
 const triangles=[],blades=[];
 let cutHeight=Infinity;
 const triangle=(a,b,c,materialIndex,identity)=>{
  if(materialIndex===0||[a,b,c].every(p=>p[1]<=cutHeight)){triangles.push({a,b,c,materialIndex,identity});return;}
  if([a,b,c].every(p=>p[1]>=cutHeight))return;
  // Clip in the already-built stalk's space: a cut preserves its lower shape.
  const polygon=[];
  for(const [p,q]of [[a,b],[b,c],[c,a]]){
   const inside=p[1]<=cutHeight,nextInside=q[1]<=cutHeight;
   if(inside)polygon.push(p);
   if(inside!==nextInside){const t=(cutHeight-p[1])/(q[1]-p[1]);polygon.push([p[0]+t*(q[0]-p[0]),cutHeight,p[2]+t*(q[2]-p[2])]);}
  }
  for(let j=1;j+1<polygon.length;j++){
   const A=polygon[0],B=polygon[j],C=polygon[j+1],u=B.map((v,i)=>v-A[i]),v=C.map((v,i)=>v-A[i]);
   if(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])===0)continue;
   triangles.push({a:A,b:B,c:C,materialIndex,identity:`${identity}:cut:${j-1}`});
  }
 };
 const {width:w,depth:d}=config;
 triangle([-w/2,0,-d/2],[w/2,0,d/2],[w/2,0,-d/2],0,'ground:0');
 triangle([-w/2,0,-d/2],[-w/2,0,d/2],[w/2,0,d/2],0,'ground:1');
 const columns=Math.ceil(Math.sqrt(config.blades*w/d)),rows=Math.ceil(config.blades/columns);
 for(let i=0;i<config.blades;i++){
  const r0=random(),r1=random(),radiusFraction=tufts?Math.sqrt(r0):0,tuft=tufts?.centres[i%tufts.centres.length];
  const x=tufts?tuft[0]+tufts.radius*radiusFraction*Math.cos(2*Math.PI*r1):((i%columns+.2+.6*r0)/columns-.5)*w*(config.periodic?1:.9);
  const z=tufts?tuft[1]+tufts.radius*radiusFraction*Math.sin(2*Math.PI*r1):((Math.floor(i/columns)+.2+.6*r1)/rows-.5)*d*(config.periodic?1:.9);
  const heightFactor=tufts?.grading==='radial'?tufts.rimFraction+(1-tufts.rimFraction)*(1-radiusFraction**2):1;
  const angle=random()*Math.PI*2,lean=(random()-.5)*2*config.bend,lengthDraw=random();
  const lengthFactor=config.lengthLogSigma===undefined?.65+.35*lengthDraw:Math.exp(config.lengthLogSigma*normalFrom(lengthDraw));
  const height=config.height*lengthFactor*heightFactor;
  if(!Number.isFinite(height)||height<=0)throw Error('lengthLogSigma produces an unrepresentable stalk height');
  cutHeight=Infinity;
  for(const cut of tufts?.cuts??[])if(x>=cut.min[0]&&x<cut.max[0]&&z>=cut.min[1]&&z<cut.max[1])cutHeight=Math.min(cutHeight,cut.height);
  const width=config.bladeWidth*(.75+.5*random()),centres=[],widths=[],left=[],right=[];
  for(let j=0;j<=config.segments;j++){
   const t=j/config.segments,drift=lean*height*t*t;
   const centre=[x+Math.sin(angle)*drift,height*t,z+Math.cos(angle)*drift];
   const half=width*.5*Math.max(.015,Math.pow(1-t,.75));
   centres.push(centre);widths.push(half*2);
   left.push([centre[0]-Math.cos(angle)*half,centre[1],centre[2]+Math.sin(angle)*half]);
   right.push([centre[0]+Math.cos(angle)*half,centre[1],centre[2]-Math.sin(angle)*half]);
   if(j){triangle(left[j-1],right[j-1],left[j],1,`blade:${i}:${j}:0`);triangle(right[j-1],right[j],left[j],1,`blade:${i}:${j}:1`);}
  }
  if(height>cutHeight){
   const firstAbove=centres.findIndex(p=>p[1]>cutHeight),a=centres[firstAbove-1],b=centres[firstAbove],t=(cutHeight-a[1])/(b[1]-a[1]);
   const tip=[a[0]+t*(b[0]-a[0]),cutHeight,a[2]+t*(b[2]-a[2])],tipWidth=widths[firstAbove-1]+t*(widths[firstAbove]-widths[firstAbove-1]);
   if(a[1]===cutHeight){centres.splice(firstAbove);widths.splice(firstAbove);}
   else {centres.splice(firstAbove,centres.length-firstAbove,tip);widths.splice(firstAbove,widths.length-firstAbove,tipWidth);}
  }
  blades.push({id:i,centres,widths});
 }
 const surface=config.periodic?periodicSurfaceTriangles(triangles,w,d):triangles;
 const maxY=triangles.reduce((m,t)=>Math.max(m,t.a[1],t.b[1],t.c[1]),0);
 return {schema:'kaminos.frozen-grass-source.v1',config,triangles:surface,blades,boundary:config.periodic?'Periodic source cell and full repeated ray transport.':'Finite grass patch and finite ray transport.',...(config.periodic?{periodic:{width:w,depth:d,minY:0,maxY}}:{})};
}
