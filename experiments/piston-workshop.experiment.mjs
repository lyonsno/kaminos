// The experiment presents the same authored actuator service as the inspector.
export default {
 id:'piston-workshop',title:'Piston workshop',
 async create({host}){
  await host.scene.open();const api=window.kaminosActuators;if(!api)throw Error('Authored actuator service unavailable');let unmount;
  return {read:()=>({actuators:api.read(),state:api.state()}),operations:{install:r=>api.install(r),configure:(id,p)=>api.configure(id,p),play:id=>api.play(id),pause:()=>api.pause()},
   mount:({root})=>{unmount=api.mountInstaller(root);},dispose:()=>{unmount?.();api.pause();}};
 },
};
