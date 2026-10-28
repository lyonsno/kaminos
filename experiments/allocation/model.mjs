// Conservative finite-stencil support; activity is prescribed, not detected from fire.
export function supportBoxes(c, step) {
  return c.boxes.map(b=>({lo:b.lo.map((v,i)=>Math.max(0,v+step*Math.floor(c.velocity[i]))),hi:b.hi.map((v,i)=>Math.min(c.size,v+step*Math.ceil(c.velocity[i])))}));
}
export function activeBricks(c,step) {
 const out=[], q=c.size/c.brick, boxes=supportBoxes(c,step);
 for(let z=0;z<q;z++)for(let y=0;y<q;y++)for(let x=0;x<q;x++) {
  const p=[x,y,z].map(v=>v*c.brick);
  if(boxes.some(b=>p.every((v,i)=>v<b.hi[i]&&v+c.brick>b.lo[i])))out.push(x+q*(y+q*z));
 }
 return out;
}
export function compareFields(a,b) {
 if(a.length!==b.length||!a.length)throw Error('field length mismatch');
 let maxError=0,l1=0,mass=0;
 for(let i=0;i<a.length;i++) {
  if(!Number.isFinite(a[i])||!Number.isFinite(b[i]))throw Error('nonfinite field');
  const e=Math.abs(a[i]-b[i]);maxError=Math.max(maxError,e);l1+=e;mass+=Math.abs(a[i]);
 }
 return {maxError,relativeL1:l1/Math.max(mass,Number.MIN_VALUE),referenceMass:mass};
}
export function fixtures(size=96) {
 const box=(lo,hi)=>({lo,hi}), base={size,steps:12,velocity:[1.25,.25,.25],repeats:5};
 return [
  {...base,name:'thin-column',boxes:[box([32,8,32],[40,64,40])]},
  {...base,name:'separated-hotspots',boxes:[16,48].flatMap(x=>[16,48].flatMap(y=>[16,48].map(z=>box([x,y,z],[x+8,y+8,z+8]))))},
  {...base,name:'broad-fire',boxes:[box([8,8,8],[72,72,72])]},
  {...base,name:'full-volume',boxes:[box([0,0,0],[size,size,size])]}
 ];
}
export function validateSignal(r, configs) {
 if(r.adapter?.vendor!=='apple'||r.adapter.fallback||r.errors?.length||(Array.isArray(r.validation)?r.validation.length:r.validation))throw Error('GPU route or validation failure');
 if(r.rows?.length!==configs.length)throw Error('partial configurations');
 r.rows.forEach((row,i)=>{
  if(JSON.stringify(row.config)!==JSON.stringify(configs[i]))throw Error('effective configuration mismatch');
  if(row.samples?.length!==configs[i].repeats)throw Error('partial repeats');
  for(const s of row.samples) {
   if(!Number.isFinite(s.parity?.maxError)||s.parity.maxError>1e-6||!(s.parity.referenceMass>0))throw Error('field parity failure');
   if(s.active!==activeBricks(configs[i],configs[i].steps).length||s.overflow)throw Error('allocation count or overflow failure');
   for(const k of ['denseMs','allocationMs','sparseUpdateMs'])if(s[k]?.length!==configs[i].steps||!s[k].every(v=>Number.isFinite(v)&&v>0))throw Error('missing timestamps');
  }
 });
 return true;
}
export function appendSignal(signal,result) {
 if(signal.adapter && JSON.stringify(signal.adapter)!==JSON.stringify(result.adapter)) signal.errors=[...(signal.errors??[]),"adapter changed across configurations"];
 signal.adapter=result.adapter;
 signal.errors=[...(signal.errors??[]),...result.errors];
 signal.validation=[...(signal.validation??[]),...(result.validation?[{configurations:result.rows.map(r=>r.config),error:result.validation}]:[])];
 signal.rows.push(...result.rows);
}
