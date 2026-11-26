export const MIXING_RECIPE = Object.freeze({
  gravel: 48,
  sand: 224,
  crumb: 960,
  bed: 1152,
  depth: .00235,
});

const BODY_WORDS = 24;

// A finite charge of three loose ingredients above a damp, continuous bed.
// Mass and inertia follow the actual collider geometry at each ingredient scale.
export function placeMixingIngredients({floats, grainCount, massScale, matrixMass, random}) {
  const {gravel, sand, crumb, depth} = MIXING_RECIPE;
  const layout = [
    {id:'gravel', name:'Gravel', count:gravel, x:.0024, z:-.0055, nx:7, nz:10, spacing:.00112, y:depth+.00076},
    {id:'sand', name:'Coarse sand', count:sand, x:.0017, z:-.0059, nx:16, nz:22, spacing:.00052, y:depth+.00195},
    {id:'crumb', name:'Dry crumbs', count:crumb, x:-.011, z:-.0058, nx:18, nz:18, spacing:.00068, y:depth+.00056},
  ];
  const ingredients=[];
  let start=0;
  for(const {id,name,count,x,y,z,nx,nz,spacing} of layout) {
    let mass=0;
    for(let i=0;i<count;i++) {
      const offset=(start+i)*BODY_WORDS;
      const center=[
        x+(i%nx+(random()-.5)*.24)*spacing,
        y+(Math.floor(i/(nx*nz))+(random()-.5)*.24)*spacing,
        z+(Math.floor(i/nx)%nz+(random()-.5)*.24)*spacing,
      ];
      if(id==='crumb') {
        const r=.00031+random()*.00007;
        const m=1250*4/3*Math.PI*r**3;
        const inv=massScale/m, inertia=inv/(.4*r*r);
        floats.set([...center,inv,0,0,0,1,0,0,0,r,0,0,0,r,0,0,2,random(),inertia,inertia,inertia,m],offset);
      } else {
        const scale=id==='sand'?.44:.91;
        const volumeScale=scale**3, inertiaScale=scale**5;
        floats.set(center,offset);
        floats[offset+3]/=volumeScale;
        for(const k of [11,15,16,17])floats[offset+k]*=scale;
        for(const k of [20,21,22])floats[offset+k]/=inertiaScale;
        floats[offset+23]*=volumeScale;
      }
      mass+=floats[offset+23];
    }
    ingredients.push({id,name,start,count,mass});
    start+=count;
  }
  ingredients.push({id:'bed',name:'Damp matrix',start,count:grainCount-start,mass:matrixMass});
  return ingredients;
}

// Grain contact visits adjacent buckets. One cell must cover the sum
// of the two largest possible body-to-lobe reaches, in any orientation.
export function mixingContactCell(floats, grainCount) {
  let reach=0;
  for(let i=0;i<grainCount;i++) {
    const o=i*BODY_WORDS;
    reach=Math.max(reach,Math.abs(floats[o+16])+floats[o+11],Math.abs(floats[o+17])+floats[o+15]);
  }
  return reach*2;
}
