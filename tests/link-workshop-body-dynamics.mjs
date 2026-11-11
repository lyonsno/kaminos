// kaminos-test: node
import assert from 'node:assert/strict';
import * as API from '../experiments/link-workshop/model.mjs';
import {constructBodies,createBodyView} from '../experiments/link-workshop/bodies.mjs';
import * as T from '../lib/three.core.js';
assert.equal(typeof API.createBodyDynamics,'function','Dragging needs connected body inertia and pressure response, not only independent hinge inertias');
const {createBodyDynamics,createBodyInertia}=API;
assert.throws(()=>API.checkedMechanism({...({schema:'kaminos.links.v1',period:3,nodes:[{parent:null,point:[0,0]},{parent:0,length:1,angles:[0,0],bodyDynamics:{mass:-1}}],pistons:[]})}),/body.*mass/i,'Negative body mass must be rejected before native history mutation');
const near=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
const rod=(parent,length,angle,mass=1)=>({parent,length,angles:[angle,angle],bodyDynamics:{mass,center:[length/2,0],inertia:mass*length*length/12}});
const recipe=()=>({schema:'kaminos.links.v1',period:3,nodes:[{parent:null,point:[0,0]},rod(0,1,.4,2),rod(1,1,-.5,3)],pistons:[],mechanics:{enabled:true,model:'bodies',gravity:[0,0],jointDamping:.05,hydraulicsEnabled:false,cylinderDrag:0}});
// Independent double-rod inertia in relative joint coordinates.
const m=recipe(),q=[0,.4,-.5],inertia=createBodyInertia(m,q),a=2/3+3*(1+1/3+Math.cos(q[2])),b=3*(1/3+Math.cos(q[2])/2),d=1;
const x=inertia.multiply([0,2,-1]);near(x[1],2*a-b);near(x[2],2*b-d);
const recovered=inertia.solve(x);near(recovered[1],2);near(recovered[2],-1);
assert.ok(Math.abs(b)>1,'The moving child contributes an off-diagonal reaction');
// The single-rod gravity torque is independently -m*g*L/2.
const falling=recipe();falling.nodes=falling.nodes.slice(0,2);falling.nodes[1].angles=[0,0];falling.mechanics.gravity=[0,-9.81];falling.mechanics.jointDamping=0;const fall=createBodyDynamics(falling,{joint:1});const fs=fall.step(1e-4);near(fs.velocities[1],-14.715e-4,1e-10);
// Pull an upstream endpoint: its unconstrained child must react inertially.
const dynamics=createBodyDynamics(m,{joint:1}),before=dynamics.read();
const desired=[Math.cos(.5),Math.sin(.5)];let state;
for(let i=1;i<=30;i++){const angle=.4+.1*i/30;state=dynamics.step(1/120,{grab:{joint:1,target:[Math.cos(angle),Math.sin(angle)]}});}
near(state.points[1][0],desired[0],2e-4);near(state.points[1][1],desired[1],2e-4);
assert.ok(Math.abs(state.angles[2]-before.angles[2])>.01,'The child must accommodate a carried parent instead of retaining its relative hinge angle');
const atStop=state.angles[2];for(let i=0;i<20;i++)state=dynamics.step(1/120,{grab:{joint:1,target:desired}});
assert.ok(Math.abs(state.angles[2]-atStop)>.001,'The child keeps moving when the hand stops while held');
assert.deepEqual(m,recipe());
// Sharing a stationary anchor does not wake an unrelated branch.
const branched=recipe();branched.nodes.push(rod(0,.8,-.8),rod(3,.6,.3));const island=createBodyDynamics(branched,{joint:1});
assert.deepEqual(island.read().activeJoints,[1,2]);island.step(1/60,{grab:{joint:1,target:desired}});near(island.read().angles[3],-.8);near(island.read().angles[4],.3);
// Two pressure chambers respond to motion; the same trace is retained for A/B.
const hardware={barrelLength:.9,rodLength:.9,minLength:.9,maxLength:1.8,restLength:Math.SQRT2,stiffness:600,damping:35,stopStiffness:1e6,mode:'hold'};
const hydraulic=recipe();hydraulic.nodes=[{parent:null,point:[0,0]},rod(0,1,0),{parent:null,point:[0,1]}];hydraulic.pistons=[{a:2,b:1,mechanics:hardware}];hydraulic.mechanics.hydraulicsEnabled=true;
const wet=createBodyDynamics(hydraulic,{joint:1}),dryRecipe=structuredClone(hydraulic);dryRecipe.mechanics.hydraulicsEnabled=false;const dry=createBodyDynamics(dryRecipe,{joint:1});
let ws,ds;for(let i=1;i<=30;i++){const g={joint:1,target:[Math.cos(i*.003),Math.sin(i*.003)]};ws=wet.step(1/120,{grab:g});ds=dry.step(1/120,{grab:g});}
assert.ok(ws.actuators[0].pressures.some(p=>Math.abs(p)>1));assert.ok(ws.actuators[0].hydraulicForce!==0);assert.equal(ds.actuators[0].hydraulicForce,0);assert.ok(ws.hand.residual<2e-4);assert.ok(ds.hand.residual<2e-4);
assert.ok(ws.actuators[0].pressures.every(Number.isFinite));
const changedRest=structuredClone(hydraulic);changedRest.pistons[0].mechanics.restLength=1.7;const noOldPose=createBodyDynamics(changedRest,{joint:1}),originalRest=createBodyDynamics(hydraulic,{joint:1});const restGrab={joint:1,target:[Math.cos(.02),Math.sin(.02)]};assert.deepEqual(noOldPose.step(1/120,{grab:restGrab}).angles,originalRest.step(1/120,{grab:restGrab}).angles,'Body hydraulics must not spring to the old authored rest length');
const skinRecipe=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./fixtures/link-workshop-operator-kiln.json',import.meta.url)));const construction=constructBodies(skinRecipe),frozen=API.freezeMechanicalHardware(skinRecipe,construction.travels,{fraction:1}),view=createBodyView(new T.Group());try{view.update(frozen,1);const packet=view.exportBodies();view.importBodies(packet);const changed=structuredClone(frozen);changed.pistons.forEach(p=>p.hydraulics={valve:'closed'});view.update(changed,1);assert.equal(view.manifest().replacements,packet.bodies.length,'Changing a hydraulic response must preserve every returned body');}finally{view.dispose();}
console.log('Connected body inertia, close grab, passive follow-through, active islands and optional chamber pressure');
