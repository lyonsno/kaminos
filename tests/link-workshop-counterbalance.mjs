// kaminos-test: node
import assert from 'node:assert/strict';
import * as API from '../experiments/link-workshop/body-dynamics.mjs';
assert.equal(typeof API.captureCounterbalance,'function','Body posing needs an explicit elastic reference and gravity counterbalance');
const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const rod={schema:'kaminos.links.v1',period:3,nodes:[{parent:null,point:[0,0]},{parent:0,length:1,angles:[.2,.2],bodyDynamics:{mass:2}}],pistons:[],mechanics:{enabled:true,model:'bodies',gravity:[0,-9.81],jointDamping:0,hydraulicsEnabled:false,cylinderDrag:0}};
const original=structuredClone(rod),balanced=API.captureCounterbalance(rod,{fraction:1,period:1.2,dampingRatio:.15}),spring=balanced.nodes[1].counterbalance,I=2/3;
assert.deepEqual(rod,original);near(spring.referenceAngle,.2);near(spring.preload,9.81*Math.cos(.2));near(spring.stiffness,I*(2*Math.PI/1.2)**2);near(spring.damping,2*.15*Math.sqrt(I*spring.stiffness));
const resting=API.createBodyDynamics(balanced,{fraction:1,joint:1});for(let i=0;i<60;i++)resting.step(1/120);near(resting.read().angles[1],.2,1e-12);
const moved=structuredClone(balanced);moved.nodes[1].angles=[.28,.28];const h=1e-4,dynamics=API.createBodyDynamics(moved,{joint:1,fraction:1}),first=dynamics.step(h),force=-9.81*Math.cos(.28)+spring.preload-spring.stiffness*.08;
near(first.velocities[1],h*force/(I+h*spring.damping+h*h*spring.stiffness),1e-11);
const energy=s=>.5*I*s.velocities[1]**2+9.81*Math.sin(s.angles[1])+.5*spring.stiffness*(s.angles[1]-.2)**2-spring.preload*(s.angles[1]-.2);
const initialEnergy=energy(dynamics.read());let crossings=0,previous=first.angles[1]-.2,state;
for(let i=0;i<1200;i++){state=dynamics.step(1/240);const x=state.angles[1]-.2;if(x*previous<0)crossings++;previous=x;}
assert.ok(crossings>=2,'Stored elastic energy produces actual return and follow-through under gravity');assert.ok(energy(state)<initialEnergy);near(state.angles[1],.2,.005);
const heavier=structuredClone(balanced);heavier.nodes[1].bodyDynamics.mass=4;const sag=API.createBodyDynamics(heavier,{joint:1,fraction:1}).step(1/120);assert.ok(sag.velocities[1]<0,'Adding mass must load the captured counterbalance and sag, rather than silently rebalance it');assert.deepEqual(heavier.nodes[1].counterbalance,spring);
const two=structuredClone(rod);two.nodes.push({parent:1,length:1,angles:[-.5,-.5],bodyDynamics:{mass:3}});const pair=API.captureCounterbalance(two,{fraction:1,period:1.2});near(pair.nodes[1].counterbalance.preload,9.81*(Math.cos(.2)+3*(Math.cos(.2)+.5*Math.cos(-.3))));near(pair.nodes[2].counterbalance.preload,9.81*3*.5*Math.cos(-.3));near(pair.nodes[1].counterbalance.stiffness,(2/3+3*(1+1/3+Math.cos(-.5)))*(2*Math.PI/1.2)**2);near(pair.nodes[2].counterbalance.stiffness,(2*Math.PI/1.2)**2);
assert.throws(()=>API.captureCounterbalance(rod,{period:0}),/positive/i);
console.log('Explicit counterbalance: independent gravity equilibrium, implicit spring force, energy return, loaded sag and tree inertia');
