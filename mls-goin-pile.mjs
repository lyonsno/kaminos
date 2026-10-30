import * as CANNON from './node_modules/cannon-es/dist/cannon-es.js';

export const GOIN_BODY_FLOATS=28;
export const GOIN_IMPULSE_SCALE=1048576;

// Same cylinder engine and dimensions convention as Horde's goin-physics.mjs.
export function createMlsGoinPile(config){
  const p=config.goinPile;if(!p)throw Error('Goin pile configuration required');
  const world=new CANNON.World({gravity:new CANNON.Vec3(0,-9.81,0),allowSleep:true});
  world.solver.iterations=30;world.solver.tolerance=1e-8;
  world.defaultContactMaterial.friction=.45;world.defaultContactMaterial.restitution=.02;
  const ground=new CANNON.Body({mass:0,shape:new CANNON.Plane()});
  ground.quaternion.setFromEuler(-Math.PI/2,0,0);world.addBody(ground);
  const bodies=[];let steps=0,totalContacts=0,totalImpulse=[0,0,0],disposed=false;
  for(let i=0;i<p.count;i++){
    const column=i%4,level=Math.floor(i/4);
    const body=new CANNON.Body({mass:p.mass,shape:new CANNON.Cylinder(p.radius,p.radius,p.thickness,32),linearDamping:.03,angularDamping:.03,
      position:new CANNON.Vec3((column-1.5)*p.radius*2.3,p.thickness/2+.002+level*(p.thickness+.003),-1.65+(column%2)*.08)});
    body.sleepSpeedLimit=.03;body.sleepTimeLimit=.5;world.addBody(body);bodies.push(body);
  }
  const alive=()=>{if(disposed)throw Error('Goin pile disposed');};
  function read(){return {route:'mls-particle-contact/cannon-es-0.20.0',steps,timeSeconds:steps*config.dt,
    particleMass:p.particleMass,bodyMass:p.mass,contacts:totalContacts,impulse:[...totalImpulse],
    bodies:bodies.map((b,i)=>({id:`goin-${i}`,position:b.position.toArray(),quaternion:b.quaternion.toArray(),velocity:b.velocity.toArray(),
      angularVelocity:b.angularVelocity.toArray(),radius:p.radius,thickness:p.thickness,mass:b.mass,sleeping:b.sleepState===CANNON.Body.SLEEPING}))};}
  return {read,
    pack(){alive();const data=new Float32Array(bodies.length*GOIN_BODY_FLOATS);
      for(const [i,b]of bodies.entries()){
        b.updateInertiaWorld(true);
        const o=i*GOIN_BODY_FLOATS;data.set([...b.position.toArray(),p.radius,...b.quaternion.toArray(),
          ...b.velocity.toArray(),p.thickness/2,...b.angularVelocity.toArray(),b.invMass],o);
        const m=b.invInertiaWorld.elements;
        for(let row=0;row<3;row++)data.set([m[row*3],m[row*3+1],m[row*3+2],0],o+16+row*4);
      }return data;
    },
    complete(impulses){alive();
      if(!(impulses instanceof Int32Array)||impulses.length!==bodies.length*8)throw Error('Incomplete goin impulse return');
      for(const [i,b]of bodies.entries()){
        const j=Array.from(impulses.subarray(i*8,i*8+3),v=>v/GOIN_IMPULSE_SCALE);
        const torque=new CANNON.Vec3(...Array.from(impulses.subarray(i*8+4,i*8+7),v=>v/GOIN_IMPULSE_SCALE));
        if(impulses[i*8+7])throw Error('Goin impulse overflow');
        const contactCount=impulses[i*8+3];totalContacts+=contactCount;
        if(j.some(v=>v!==0)||torque.lengthSquared()>0){
          b.wakeUp();b.velocity.vadd(new CANNON.Vec3(...j).scale(b.invMass),b.velocity);
          b.invInertiaWorld.vmult(torque,torque);b.angularVelocity.vadd(torque,b.angularVelocity);
        }
        for(let axis=0;axis<3;axis++)totalImpulse[axis]+=j[axis];
      }
      world.step(config.dt);steps++;
      for(const b of bodies)if(![...b.position.toArray(),...b.velocity.toArray(),...b.angularVelocity.toArray(),...b.quaternion.toArray()].every(Number.isFinite))throw Error('Nonfinite goin body state');
      return read();
    },
    dispose(){disposed=true;for(const b of [...world.bodies])world.removeBody(b);}
  };
}
