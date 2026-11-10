// Frozen explicit surfaces. Random numbers describe the source once; camera
// motion never changes strand identity or geometry.
export function createGrassTeacherSource(options={}) {
 const config={seed:31,blades:72,height:.8,width:2.4,depth:1.8,bladeWidth:.045,bend:.45,segments:7,...options};
 for(const key of ['height','width','depth','bladeWidth'])if(!Number.isFinite(config[key])||config[key]<=0)throw Error(`${key} must be positive and finite`);
 if(!Number.isSafeInteger(config.seed)||!Number.isSafeInteger(config.blades)||config.blades<1||!Number.isSafeInteger(config.segments)||config.segments<2||!Number.isFinite(config.bend))throw Error('finite seed/bend and positive integer blade/segment counts required');
 let state=config.seed>>>0;
 const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const triangles=[],blades=[];
 const triangle=(a,b,c,materialIndex,identity)=>triangles.push({a,b,c,materialIndex,identity});
 const {width:w,depth:d}=config;
 triangle([-w/2,0,-d/2],[w/2,0,d/2],[w/2,0,-d/2],0,'ground:0');
 triangle([-w/2,0,-d/2],[-w/2,0,d/2],[w/2,0,d/2],0,'ground:1');
 const columns=Math.ceil(Math.sqrt(config.blades*w/d)),rows=Math.ceil(config.blades/columns);
 for(let i=0;i<config.blades;i++){
  const x=((i%columns+.2+.6*random())/columns-.5)*w*.9;
  const z=((Math.floor(i/columns)+.2+.6*random())/rows-.5)*d*.9;
  const angle=random()*Math.PI*2,lean=(random()-.5)*2*config.bend,height=config.height*(.65+.35*random());
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
  blades.push({id:i,centres,widths});
 }
 return {schema:'kaminos.frozen-grass-source.v1',config,triangles,blades};
}
