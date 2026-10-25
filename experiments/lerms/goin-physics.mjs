import * as CANNON from '../../node_modules/cannon-es/dist/cannon-es.js';

const vector=(value,n=3)=>Array.isArray(value)&&value.length===n&&value.every(Number.isFinite);
const v=value=>new CANNON.Vec3(...value);
const timestep=1/120;

// One dynamic goin and one authored box support. The caller owns the clock and pose.
export function createGoinPhysics({support,radius=.35,thickness=.16}={}){
 if(typeof support!=='function'||!Number.isFinite(radius)||radius<=0||!Number.isFinite(thickness)||thickness<=0)throw Error('Goin physics requires support and positive dimensions');
 const world=new CANNON.World({gravity:new CANNON.Vec3(0,-9.81,0),allowSleep:true});
 world.defaultContactMaterial.friction=.45;world.defaultContactMaterial.restitution=.2;
 const ground=new CANNON.Body({mass:0});world.addBody(ground);
 const body=new CANNON.Body({mass:1,shape:new CANNON.Cylinder(radius,radius,thickness,32),linearDamping:.05,angularDamping:.05});
 let scale=[1,1,1];
 let time=0,remainder=0,steps=0,active=false,disposed=false,supportKey=null,contactCount=0,contactSteps=0;
 let effectiveSupport=null,lastPose=null,velocity=[0,0,0];
 const alive=()=>{if(disposed)throw Error('Goin physics is disposed');};
 function setScale(value){
  alive();if(!vector(value)||value.some(x=>x<=0)||Math.abs(value[0]-value[2])>1e-6*Math.max(...value))throw Error('Goin physics requires positive axial and equal radial scale');
  if(value.some((x,i)=>Math.abs(x-scale[i])>1e-9)){
   for(const shape of [...body.shapes])body.removeShape(shape);
   body.addShape(new CANNON.Cylinder(radius*value[0],radius*value[0],thickness*value[1],32));
   body.aabbNeedsUpdate=true;world.broadphase.dirty=true;body.wakeUp();contactCount=0;scale=[...value];
  }
 }
 function syncSupport(){
  const row=support();
  if(!row||!row.id||!vector(row.position)||!vector(row.quaternion,4)||Math.abs(Math.hypot(...row.quaternion)-1)>1e-6||!vector(row.size)||row.size.some(x=>x<=0))throw Error('Goin support must be a mounted visible box with finite world pose and positive size');
  const key=JSON.stringify(row);
  if(key!==supportKey){
   for(const shape of [...ground.shapes])ground.removeShape(shape);
   ground.addShape(new CANNON.Box(v(row.size.map(x=>x/2))));
   ground.position.copy(v(row.position));ground.quaternion.set(...row.quaternion);ground.aabbNeedsUpdate=true;world.broadphase.dirty=true;
   effectiveSupport=structuredClone(row);supportKey=key;contactCount=0;body.wakeUp();
  }
 }
 function advance(next){
  alive();if(!Number.isFinite(next)||next<time)throw Error('Goin physics requires monotonic owner time');syncSupport();
  if(active){
   remainder+=next-time;
   // Direct fixed steps avoid the engine's elapsed-time catch-up cap.
   while(remainder+1e-12>=timestep){
    world.step(timestep);remainder=Math.max(0,remainder-timestep);steps++;
    contactCount=world.contacts.filter(c=>c.bi===body||c.bj===body).length;if(contactCount)contactSteps++;
   }
  }
  time=next;return read();
 }
 function carried({time:next,position,quaternion,scale:currentScale=scale}){
  alive();if(!vector(position)||!vector(quaternion,4))throw Error('Carried goin requires a finite world pose');
  setScale(currentScale);
  if(active){world.removeBody(body);active=false;remainder=0;contactCount=0;lastPose=null;velocity=[0,0,0];}
  advance(next);
  if(lastPose&&next>lastPose.time)velocity=position.map((x,i)=>(x-lastPose.position[i])/(next-lastPose.time));
  lastPose={time:next,position:[...position],quaternion:[...quaternion]};
 }
 function release({time:next,position,quaternion,scale:currentScale=scale}){
  alive();if(active)throw Error('Goin already has dynamic custody');
  if(!vector(position)||!vector(quaternion,4))throw Error('Release requires a finite world pose');setScale(currentScale);advance(next);
  body.position.copy(v(position));body.quaternion.set(...quaternion);body.velocity.copy(v(velocity));body.angularVelocity.set(0,0,0);
  body.force.set(0,0,0);body.torque.set(0,0,0);body.aabbNeedsUpdate=true;body.wakeUp();
  world.addBody(body);active=true;contactCount=0;contactSteps=0;remainder=0;lastPose=null;return read();
 }
 const read=()=>({route:'lerms.goin-rigid-body.v1',backend:'cannon-es-cpu',engineVersion:'0.20.0',time,timestep,steps,remainder,active,scale:[...scale],radius:radius*scale[0],thickness:thickness*scale[1],
  support:structuredClone(effectiveSupport),contactCount,contactSteps,phase:!active?'carried-or-authored':body.sleepState===CANNON.Body.SLEEPING?'settled':contactCount?'contact':'airborne',
  position:body.position.toArray(),quaternion:body.quaternion.toArray(),velocity:body.velocity.toArray(),angularVelocity:body.angularVelocity.toArray()});
 syncSupport();
 return {read,advance,carried,release,setScale,reset(next){alive();if(active)world.removeBody(body);active=false;lastPose=null;velocity=[0,0,0];remainder=0;contactCount=0;advance(next);},dispose(){if(disposed)return;disposed=true;for(const b of [...world.bodies])world.removeBody(b);}};
}
