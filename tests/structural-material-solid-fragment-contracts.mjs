import assert from 'node:assert/strict';
import Module from 'manifold-3d';
const imported=await import('../structural-material-solid-fragments.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;});
assert.ok(imported?.createPlaneFractureSurface,'New fragment surfaces must share an event with released material transmission');
const wasm=await Module();wasm.setup();const cube=wasm.Manifold.cube([1,1,1],true),mesh=cube.getMesh();
const geometry={numProp:mesh.numProp,properties:Array.from(mesh.vertProperties),indices:Array.from(mesh.triVerts)};cube.delete();
const surface=await imported.createPlaneFractureSurface(geometry,{sourceSha256:'test-control-cube',wasm});
const rest=[[-.5,-.5,-.5],[.5,-.5,-.5],[-.5,.5,.5],[.5,.5,.5]],pairs=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
let state=pairs.flatMap(([a,b])=>[a,b,1,0]),firstEvent;
const cut=(normal,offset)=>state.map((v,i)=>i%4===2&&v===1&&rest[state[i-2]].reduce((s,p,a)=>s+p*normal[a],-offset)*rest[state[i-1]].reduce((s,p,a)=>s+p*normal[a],-offset)<0?0:v);
const unchanged=surface.witness();
assert.throws(()=>surface.cut({id:'false-picture-cut',normal:[1,0,0],offset:0,rest,before:state,after:state,route:'kaminos.deformable-material.colored-vbd.webgpu.v0',kind:'explicit-control-plane'}),/transmission/);
assert.equal(surface.witness().epoch,unchanged.epoch);assert.equal(surface.witness().volume,unchanged.volume);assert.deepEqual(surface.witness().pieces.map(p=>p.id),unchanged.pieces.map(p=>p.id));
for(const [id,normal,offset] of [['first',[1,0,0],.1],['second',[0,1,0],-.1]]){const after=cut(normal,offset),event={id,normal,offset,rest,before:state,after,route:'kaminos.deformable-material.colored-vbd.webgpu.v0',kind:'explicit-control-plane'};if(!firstEvent)firstEvent=event;surface.cut(event);state=after;}
const result=surface.witness();assert.equal(result.pieces.length,4);assert.ok(Math.abs(result.volume-1)<1e-6);assert.equal(result.events.length,2);assert.ok(result.pieces.every(p=>p.volume>0&&p.geometry.exterior.some(v=>!v)));
assert.equal(surface.cut(firstEvent).replayed,true);assert.equal(surface.witness().epoch,2);assert.equal(surface.witness().pieces.length,4);
assert.throws(()=>surface.cut({...firstEvent,offset:.2}),/identity reused/);
surface.dispose();console.log('Real Manifold event cuts preserve volume; unchanged material cannot manufacture a visual cut (synthetic mechanical receipts, not native fracture proof)');
