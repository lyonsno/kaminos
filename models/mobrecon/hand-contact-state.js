import * as CANNON from '../../node_modules/cannon-es/dist/cannon-es.js';

const finitePoint = p => p?.length === 3 && Array.from(p).every(Number.isFinite);
const distance = (a,b) => Math.hypot(...a.map((v,i)=>v-b[i]));
const fingers = ['thumb','index','middle','ring','little'];
export const HAND_CONTACT_TABLE=Object.freeze({width:.65,thickness:.012,depth:.5});
const positive = (v,name) => {if(!Number.isFinite(v)||v<=0)throw Error(`invalid ${name}`);return v;};
const nonnegative=(v,name)=>{if(!Number.isFinite(v)||v<0)throw Error(`invalid ${name}`);return v;};

export function handContactProxies(joints, radius=.007) {
  if(joints?.length!==63 || !Array.from(joints).every(Number.isFinite))throw Error('invalid hand joints');
  const p=i=>Array.from(joints.slice(i*3,i*3+3)), proxies=[];
  for(let f=0;f<5;f++) {
    const chain=[0,...Array.from({length:4},(_,i)=>1+f*4+i)];
    for(let b=0;b<4;b++) {
      const a=p(chain[b]),z=p(chain[b+1]);
      // Overlapping spheres cover each articulated segment, including its tip.
      // Fixed inventory preserves momentum when articulation changes bone length.
      const count=4;
      for(let i=1;i<=count;i++)proxies.push({id:`${fingers[f]}-${b}-${i}/${count}`,finger:fingers[f],
        position:a.map((v,k)=>v+(z[k]-v)*i/count),radius});
    }
  }
  const wrist=p(0),index=p(5),little=p(17);
  const palmRadius=radius*2.5;
  for(let i=0;i<3;i++) {
    const knuckle=index.map((v,k)=>v+(little[k]-v)*i/2);
    proxies.push({id:`palm-${i}`,finger:'palm',position:wrist.map((v,k)=>v+(knuckle[k]-v)*.65),radius:palmRadius});
  }
  return proxies;
}

// The measured hand supplies motor targets. Dynamic proxies have finite force,
// collide with the cube/table, and never collide with one another. Their solved
// positions remain separate from the measured mesh; no grasp attachment exists.
export function createHandContactState({target={position:[-.04,.28,-.1],radius:.018},
  cube={position:[.05,.23,0],size:.045},tableHeight=.16,motorForce=.6,friction=.8,fingerRadius=.007}={}) {
  if(!Number.isFinite(tableHeight))throw Error('invalid table height');
  positive(motorForce,'motor force');nonnegative(friction,'friction');positive(fingerRadius,'finger radius');
  const initial=structuredClone({target,cube});
  const world=new CANNON.World({gravity:new CANNON.Vec3(0,-9.81,0),allowSleep:true});
  // The thin table's enclosing sphere otherwise admits distant hand segments.
  world.broadphase.useBoundingBoxes=true;
  world.solver.iterations=30;world.solver.tolerance=1e-8;
  const handMaterial=new CANNON.Material('hand'),cubeMaterial=new CANNON.Material('cube'),tableMaterial=new CANNON.Material('table');
  const handContact=new CANNON.ContactMaterial(handMaterial,cubeMaterial,{friction,restitution:0});
  world.addContactMaterial(handContact);
  world.addContactMaterial(new CANNON.ContactMaterial(tableMaterial,cubeMaterial,{friction:.55,restitution:0}));
  world.addContactMaterial(new CANNON.ContactMaterial(tableMaterial,handMaterial,{friction:.15,restitution:0}));
  const table=new CANNON.Body({mass:0,material:tableMaterial,collisionFilterGroup:2,collisionFilterMask:1|4});
  table.addShape(new CANNON.Box(new CANNON.Vec3(HAND_CONTACT_TABLE.width/2,HAND_CONTACT_TABLE.thickness/2,HAND_CONTACT_TABLE.depth/2)));
  table.position.y=tableHeight-HAND_CONTACT_TABLE.thickness/2;world.addBody(table);
  const box=new CANNON.Body({mass:.04,material:cubeMaterial,collisionFilterGroup:1,collisionFilterMask:2|4,
    linearDamping:.05,angularDamping:.08,allowSleep:true});world.addBody(box);
  const bodies=new Map(),fingerImpulses=new Map();
  let targetState,cubeSize,tracking=false,indexTip=null,thumbTip=null,pinchPoint=null,pinchDistance=null,
    disposed=false,contacts=[],steps=0,simulationSeconds=0,contactEvents=0,maximumMotorForce=0,maximumProxyError=0;
  const assertOpen=()=>{if(disposed)throw Error('hand contact disposed');};
  function setTarget(value) {
    assertOpen();if(!finitePoint(value.position)||!(value.radius>0)||!Number.isFinite(value.radius))throw Error('invalid target');
    targetState=structuredClone(value);return read();
  }
  function setCube(value) {
    assertOpen();if(!finitePoint(value.position)||!(value.size>0)||!Number.isFinite(value.size))throw Error('invalid cube');
    cubeSize=value.size;
    for(const shape of [...box.shapes])box.removeShape(shape);
    box.addShape(new CANNON.Box(new CANNON.Vec3(cubeSize/2,cubeSize/2,cubeSize/2)));
    box.position.set(...value.position);box.quaternion.set(0,0,0,1);box.velocity.set(0,0,0);box.angularVelocity.set(0,0,0);
    box.force.set(0,0,0);box.torque.set(0,0,0);box.updateMassProperties();box.aabbNeedsUpdate=true;box.wakeUp();contacts=[];
    return read();
  }
  function read() {
    return {backend:'cannon-es-cpu',engineVersion:'0.20.0',interaction:'physical-contact',tracking,
      contact:Boolean(tracking&&indexTip&&distance(indexTip,targetState.position)<=targetState.radius),
      targetProximity:indexTip?Math.max(0,1-distance(indexTip,targetState.position)/(targetState.radius*5)):0,
      grabbed:false,pinching:pinchDistance!==null&&pinchDistance<.025,indexTip:indexTip?.slice()??null,
      thumbTip:thumbTip?.slice()??null,pinchPoint:pinchPoint?.slice()??null,pinchDistance,
      target:structuredClone(targetState),cubePosition:box.position.toArray(),cubeQuaternion:box.quaternion.toArray(),
      cubeVelocity:box.velocity.toArray(),cubeAngularVelocity:box.angularVelocity.toArray(),cubeSize,tableHeight,
      motorForce,friction,fingerRadius,maximumMotorForce,maximumProxyError,steps,simulationSeconds,contactEvents,
      fingerContactNormalImpulse:[...fingerImpulses.values()].reduce((n,r)=>n+r.normalImpulse,0),
      fingerContactImpulses:structuredClone([...fingerImpulses.values()]),
      contacts:structuredClone(contacts),proxies:[...bodies].map(([id,{body,goal,finger,radius}])=>({id,finger,radius,
        position:body.position.toArray(),velocity:body.velocity.toArray(),target:goal.toArray(),error:body.position.distanceTo(goal)}))};
  }
  function lose() {
    assertOpen();for(const {body}of bodies.values())world.removeBody(body);bodies.clear();
    tracking=false;indexTip=null;thumbTip=null;pinchPoint=null;pinchDistance=null;contacts=[];return read();
  }
  function setProxies(proxies) {
    assertOpen();
    const ids=new Set();
    for(const p of proxies) {
      if(typeof p.id!=='string'||!p.id||ids.has(p.id)||![...fingers,'palm'].includes(p.finger)||!finitePoint(p.position)||!Number.isFinite(p.radius)||p.radius<=0)throw Error('invalid contact proxy');
      ids.add(p.id);
    }
    if(!proxies.length)return lose();
    for(const [id,{body}]of bodies)if(!ids.has(id)){world.removeBody(body);bodies.delete(id);}
    for(const p of proxies) {
      let entry=bodies.get(p.id);
      if(entry&&entry.radius!==p.radius){world.removeBody(entry.body);bodies.delete(p.id);entry=null;}
      if(!entry) {
        const body=new CANNON.Body({mass:.025,material:handMaterial,shape:new CANNON.Sphere(p.radius),
          collisionFilterGroup:4,collisionFilterMask:1|2,linearDamping:0,angularDamping:1,allowSleep:false});
        body.position.set(...p.position);body.handProxy={id:p.id,finger:p.finger};world.addBody(body);
        entry={body,goal:new CANNON.Vec3(),finger:p.finger,radius:p.radius};bodies.set(p.id,entry);
      }
      entry.goal.set(...p.position);
    }
    tracking=proxies.length>0;return read();
  }
  function update({valid,joints}) {
    if(!valid||joints?.length!==63||!Array.from(joints).every(Number.isFinite))return lose();
    indexTip=Array.from(joints.slice(24,27));thumbTip=Array.from(joints.slice(12,15));
    pinchPoint=indexTip.map((v,i)=>(v+thumbTip[i])/2);pinchDistance=distance(indexTip,thumbTip);
    return setProxies(handContactProxies(joints,fingerRadius));
  }
  function advance(seconds) {
    assertOpen();if(!Number.isFinite(seconds)||seconds<0)throw Error('invalid physical time');
    let remaining=seconds;
    while(remaining>1e-12) {
      let h=Math.min(remaining,1/120);
      // Resolve fast travel rather than skipping elapsed time or tunnelling.
      for(const {body,radius}of bodies.values())h=Math.min(h,radius*.4/(body.velocity.length()+Math.sqrt(motorForce/body.mass*radius)));
      h=Math.min(h,cubeSize*.2/(box.velocity.length()+box.angularVelocity.length()*cubeSize+1e-9));
      const omega=80;
      for(const {body,goal}of bodies.values()) {
        const delta=goal.vsub(body.position),den=1+2*omega*h+omega*omega*h*h;
        const force=delta.scale(body.mass*omega*omega/den).vsub(body.velocity.scale(body.mass*2*omega/den));
        const magnitude=force.length();if(magnitude>motorForce)force.scale(motorForce/magnitude,force);
        maximumMotorForce=Math.max(maximumMotorForce,force.length());
        body.force.copy(force);body.force.y-=body.mass*world.gravity.y;
        maximumProxyError=Math.max(maximumProxyError,delta.length());
      }
      world.step(h);remaining=Math.max(0,remaining-h);steps++;simulationSeconds+=h;
      contacts=world.contacts.filter(c=>c.bi===box||c.bj===box).map(c=>{
        const a=c.bi.position.vadd(c.ri),b=c.bj.position.vadd(c.rj),other=c.bi===box?c.bj:c.bi;
        return {object:'cube',other:other===table?'table':other.handProxy?.id??'unknown',finger:other.handProxy?.finger??null,
          point:(c.bi===box?a:b).toArray(),normal:c.ni.scale(c.bj===box?1:-1).toArray(),
          separation:c.ni.dot(b.vsub(a)),force:c.multiplier,normalImpulse:Math.max(0,c.multiplier)*h,
          step:steps,simulationSeconds,authority:'simulated-not-measured-force'};
      });
      for(const c of contacts)if(c.finger){
        if(!Number.isFinite(c.normalImpulse))throw Error('non-finite finger contact impulse');
        let row=fingerImpulses.get(c.other);
        if(!row){row={proxy:c.other,finger:c.finger,object:'cube',normalImpulse:0,contactEquations:0,firstAt:simulationSeconds,lastAt:simulationSeconds};fingerImpulses.set(c.other,row);}
        row.normalImpulse+=c.normalImpulse;row.contactEquations++;row.lastAt=simulationSeconds;
      }
      contactEvents+=contacts.filter(c=>c.finger).length;
      if(!box.position.toArray().every(Number.isFinite))throw Error('non-finite cube dynamics');
    }
    return read();
  }
  function configure(values) {
    assertOpen();
    const next={motorForce:values.motorForce??motorForce,friction:values.friction??friction,fingerRadius:values.fingerRadius??fingerRadius};
    for(const [k,v]of Object.entries(next))(k==='friction'?nonnegative:positive)(v,k);
    ({motorForce,friction,fingerRadius}=next);handContact.friction=friction;return read();
  }
  function reset(){lose();setTarget(initial.target);setCube(initial.cube);fingerImpulses.clear();steps=0;simulationSeconds=0;contactEvents=0;maximumMotorForce=0;maximumProxyError=0;return read();}
  targetState=structuredClone(target);setTarget(target);setCube(cube);
  return {read,setTarget,setCube,setProxies,update,advance,configure,lose,reset,
    dispose(){if(disposed)return;lose();world.removeBody(box);world.removeBody(table);disposed=true;}};
}
