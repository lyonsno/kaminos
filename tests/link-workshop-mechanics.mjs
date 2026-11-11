// kaminos-test: node
import assert from 'node:assert/strict';
import * as mechanism from '../experiments/link-workshop/model.mjs';
import {constructBodies,createBodyView} from '../experiments/link-workshop/bodies.mjs';
import * as T from '../lib/three.core.js';

assert.equal(typeof mechanism.createMechanicalSystem,'function','Mechanisms need an actual coupled mechanical response to the hand');
const {createMechanicalSystem,freezeMechanicalHardware,pistonDifferential,frames,pistonMountPoint,checkedMechanism}=mechanism;
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const hardware=(restLength,stiffness=400)=>({barrelLength:1,rodLength:.95,minLength:1,maxLength:1.9,restLength,stiffness,damping:25,mode:'hold',stopStiffness:1e6});
function fixture(){return {schema:'kaminos.links.v1',period:3,nodes:[{parent:null,point:[0,0]},{parent:0,length:1,angles:[0,.4],inertia:1},{parent:null,point:[0,1]},{parent:null,point:[0,-1]}],pistons:[{a:2,b:1,mechanics:hardware(1.2)},{a:3,b:1,mechanics:hardware(1.7,200)}],mechanics:{enabled:true,handStiffness:200,handDamping:20,jointDamping:.5}};}
const target=[.8,.4],hand={joint:1,target};
// An independently differentiated one-hinge energy has a unique root here.
function balance(theta){const x=Math.cos(theta),y=Math.sin(theta);let g=200*((x-target[0])*-y+(y-target[1])*x);for(const [ay,k,r]of [[1,400,1.2],[-1,200,1.7]]){const d=Math.hypot(x,y-ay);g+=k*(d-r)*(-ay*x/d);}return g;}
let lo=-.6,hi=.6;assert.ok(balance(lo)*balance(hi)<0);for(let i=0;i<60;i++){const mid=(lo+hi)/2;if(balance(lo)*balance(mid)<=0)hi=mid;else lo=mid;}const reference=(lo+hi)/2;
const original=fixture(),solver=createMechanicalSystem(original);
for(let i=0;i<600;i++)solver.step(1/120,{grab:hand});
const state=solver.read();near(state.angles[1],reference,3e-5);assert.ok(state.hand.residual>.01,'A resisting assembly must not teleport the joint to the hand target');
assert.deepEqual(original,fixture(),'Solving cannot mutate the authored recipe');
assert.ok(state.actuators.every(a=>Number.isFinite(a.force)));assert.ok(state.converged);
const reverse=fixture();reverse.pistons.reverse();const other=createMechanicalSystem(reverse);for(let i=0;i<600;i++)other.step(1/120,{grab:hand});near(other.read().angles[1],state.angles[1],1e-8);
const free=fixture();for(const p of free.pistons)p.mechanics.mode='free';const yielding=createMechanicalSystem(free);for(let i=0;i<600;i++)yielding.step(1/120,{grab:hand});assert.ok(yielding.read().hand.residual<state.hand.residual,'Free cylinders yield more than holding cylinders');

// A spanning cylinder must differentiate and load every intervening hinge.
const chain={schema:'kaminos.links.v1',period:3,nodes:[{parent:null,point:[0,0]},{parent:0,length:1,angles:[.3,.4]},{parent:1,length:.8,angles:[-.6,-.2]},{parent:2,length:.6,angles:[.5,.6]},{parent:null,point:[-.4,1]}],pistons:[{a:4,b:3,bOffset:[.3,.1],mechanics:{...hardware(2,500),barrelLength:1.8,rodLength:1.7,minLength:1.8,maxLength:3.5}}],mechanics:{enabled:true}};
const angles=chain.nodes.map(n=>n.angles?.[0]??0),row=pistonDifferential(chain,angles,chain.pistons[0]);
for(const [joint,value]of row.entries){const eps=1e-6,length=sign=>{const m=structuredClone(chain);m.nodes.forEach((n,i)=>{if(n.parent!==null)n.angles=[angles[i]+(i===joint?eps*sign:0),0];});const f=frames(m),p=chain.pistons[0],a=pistonMountPoint(m,f,p.a,p.aOffset),b=pistonMountPoint(m,f,p.b,p.bOffset);return Math.hypot(b[0]-a[0],b[1]-a[1]);};near(value,(length(1)-length(-1))/(2*eps),1e-8);}
assert.equal(row.entries.length,3);const coupled=createMechanicalSystem(chain);coupled.step(1/120);assert.ok(coupled.read().velocities.slice(1,4).every(v=>Math.abs(v)>1e-7),'One spanning actuator transmits response across all three hinges');

// Compliant end stops oppose overtravel even when the cylinder is released.
const stop=fixture();stop.pistons=stop.pistons.slice(0,1);Object.assign(stop.pistons[0].mechanics,{mode:'free',minLength:1.35,maxLength:1.5,restLength:1.4});const stopped=createMechanicalSystem(stop);for(let i=0;i<600;i++)stopped.step(1/120,{grab:{joint:1,target:[0,1]}});assert.ok(stopped.read().actuators[0].length>=1.35-1e-3);assert.ok(stopped.read().actuators[0].stopCompression<1e-3);
// Drives and dissipation affect the mechanical state rather than mesh sizing.
const drive=fixture();drive.pistons=drive.pistons.slice(0,1);Object.assign(drive.pistons[0].mechanics,{mode:'drive',targetLength:1.1});const driven=createMechanicalSystem(drive);for(let i=0;i<600;i++)driven.step(1/120);near(driven.read().actuators[0].length,1.1,1e-4);
const held=createMechanicalSystem(fixture(),{velocities:[0,2,0,0]});for(let i=0;i<600;i++)held.step(1/120);assert.ok(Math.abs(held.read().velocities[1])<1e-5,'Damping dissipates the initial motion');

// Freeze once from observed construction, then posing cannot resize hardware.
const unbound=fixture();delete unbound.mechanics;for(const p of unbound.pistons)delete p.mechanics;
const construction=constructBodies(unbound),frozen=freezeMechanicalHardware(unbound,construction.travels),view=createBodyView(new T.Group());
try{view.update(frozen,0);const packet=view.exportBodies();view.importBodies(packet);const keys=new Map(view.manifest().bodies.map(b=>[b.id,b.geometryKey])),posed=structuredClone(frozen);posed.nodes[1].angles=[.25,.5];view.update(posed,0);assert.equal(view.manifest().replacements,packet.bodies.length);for(const b of view.manifest().bodies)assert.equal(b.geometryKey,keys.get(b.id));assert.deepEqual(view.manifest().travel.map(p=>[p.barrel,p.rod]),construction.travels.map(p=>[p.barrel,p.rod]));}finally{view.dispose();}
assert.throws(()=>checkedMechanism({...fixture(),mechanics:{enabled:true,handStiffness:NaN}}),/mechanical/i);
assert.throws(()=>createMechanicalSystem(fixture()).step(-1),/positive/i);
assert.throws(()=>createMechanicalSystem(fixture()).step(1/120,{grab:{joint:0,target:[1,1]}}),/fixed|anchor/i);
const impossible=fixture();impossible.pistons[0].mechanics.maxLength=10;assert.throws(()=>checkedMechanism(impossible),/hardware|stroke/i,'A declared stroke cannot exceed its physical barrel and rod');
console.log('Coupled actuator response, independent equilibrium, spanning Jacobians, resistance, damping, drive, stops and immutable hardware');
