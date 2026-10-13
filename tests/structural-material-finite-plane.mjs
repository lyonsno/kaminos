import assert from 'node:assert/strict';
import {buildFixedCellShell,applyFixedCellShell} from '../structural-material-bounded-fragments.mjs';
const contact=await import('../structural-material-finite-plane.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;});
assert.ok(contact?.projectFinitePlane,'Finite drawn-cell plane projection is required, not point-floor clamping');
const rest=[[0,1,0],[1,1,0],[0,2,0],[0,1,1]],edges=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]],bonds=mask=>edges.flatMap(([a,b],i)=>[a,b,Number(!(mask&(1<<i))),0]);
const shell=buildFixedCellShell({positions:rest,tetrahedra:[[0,1,2,3]],bonds:bonds(0)});
const near=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-9,`${message}: ${a} vs ${b}`);
for(const normal of [[0,1,0],[0,Math.SQRT1_2,Math.SQRT1_2]])for(let mask=0;mask<64;mask++){
 const positions=rest.map((p,i)=>p.map((v,k)=>v-normal[k]*(2+i/10))),velocities=rest.map(()=>normal.map(v=>-v*2));
 const result=contact.projectFinitePlane(shell.binding,bonds(mask),{positions,velocities,pinned:rest.map(()=>false)},{normal,offset:.2,friction:.6,restitution:.1});
 const drawn=applyFixedCellShell(shell.binding,result.positions,bonds(mask));
 assert.ok(drawn.every(p=>p.reduce((s,v,k)=>s+v*normal[k],0)>=.2-1e-9),`No finite vertex penetration for mask ${mask}`);
 assert.ok(result.velocities.every(v=>v.reduce((s,x,k)=>s+x*normal[k],0)>=0),'Incoming normal velocity removed');
 if(mask===63)for(let node=0;node<4;node++)near(Math.min(...drawn.filter((_,i)=>shell.binding.entries[i].anchor===node).map(p=>p.reduce((s,v,k)=>s+v*normal[k],0))),.2,'Released cell touches rather than hovering');
}
const falling=rest.map(p=>[p[0],p[1]-3,p[2]]),state={positions:falling,velocities:rest.map(()=>[2,-.05,0]),pinned:[true,false,false,false]};
const landed=contact.projectFinitePlane(shell.binding,bonds(63),state,{normal:[0,1,0],offset:0,friction:.6,restitution:.5});
assert.deepEqual(landed.positions[0],falling[0],'Contact never moves a support pin');
assert.deepEqual(landed.velocities[0],state.velocities[0],'Contact leaves pinned state to material authority');
assert.equal(landed.velocities[1][1],0,'Low-speed impact does not produce perpetual micro-bounce');
assert.ok(landed.velocities[1][0]<2,'Contact friction dissipates tangential motion');
const free={positions:rest,velocities:rest.map(()=>[1,1,1]),pinned:rest.map(()=>false)};
assert.deepEqual(contact.projectFinitePlane(shell.binding,bonds(63),free,{normal:[0,1,0],offset:0,friction:.6,restitution:.1}),free,'Airborne material unaffected');
assert.throws(()=>contact.projectFinitePlane(shell.binding,bonds(0),free,{normal:[0,2,0],offset:0,friction:.6,restitution:.1}),/unit/i);
assert.throws(()=>contact.projectFinitePlane(shell.binding,bonds(0),free,{normal:[0,1,0],offset:0,friction:-1,restitution:.1}),/friction/i);
console.log('All64 damage patterns, inclined floor, exact released-cell contact, pins, friction and low-speed settlement pass');
