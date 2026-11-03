import assert from 'node:assert/strict';
export function validateFineGridWitness(r){
 assert.ok(r.adapter?.vendor);assert.doesNotMatch(JSON.stringify(r.adapter),/swiftshader|software/i);
 assert.deepEqual(r.errors,[]);assert.deepEqual(r.dims,[8,16,8]);assert.deepEqual(r.velocityDims,[4,8,4]);
 const close=(a,b)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<1e-5,`${a} != ${b}`);
 for(const name of ['seed','preserved','injected']){
  assert.equal(r[name]?.length,4*8*4*16);
  for(let i=0;i<4*8*4;i++){
   for(let a=0;a<3;a++)close(r[name][i*16+a],(name==='injected'?[4,7,10]:[2,4,6])[a]);
   close(r[name][i*16+4],1);
  }
 }
 assert.equal(r.prolonged?.length,8*16*8*16);
 for(let z=0;z<8;z++)for(let y=0;y<16;y++)for(let x=0;x<8;x++){
  const i=(x+8*(y+16*z))*16;
  close(r.prolonged[i+4],3);
  // Lower boundary faces are independently stored, so inspect interior here.
  if(x>1&&y>1&&z>1)for(let a=0;a<3;a++)close(r.prolonged[i+a],[8,14,20][a]);
 }
}
