import {idleFingerPacket} from './hand-live-fluid.mjs';

export default {
  id:'mls-juice',title:'MLS Finger Juice',
  async create({host,inputs,record}){
    const validFlux=value=>{if(!Number.isFinite(value)||value<0)throw Error('Invalid emission rate');return value;};
    validFlux(inputs.sourceFlux??1800);
    const jetSpeed=inputs.jetSpeed??1.955;
    if(!Number.isFinite(jetSpeed)||jetSpeed<0)throw Error('Invalid jet speed');
    const emitter=inputs.emitter??{origin:[0,1.35,0],direction:[.1,-.6,-.8]};
    if(!emitter.origin?.every(Number.isFinite)||emitter.origin.length!==3||!emitter.direction?.every(Number.isFinite)||emitter.direction.length!==3||Math.hypot(...emitter.direction)<1e-8)throw Error('Invalid nozzle pose');
    const scene=await host.scene.open();let fluid,unsubscribe;
    try{
    fluid=await host.fluid.openInlets({backend:'mls-mpm',setup:{particleCount:inputs.particleCount??12000,viscosity:inputs.viscosity??.1,gridSize:inputs.gridSize??64,goinPile:inputs.goinPile},packet:idleFingerPacket()});
    let running=false,moving=inputs.moving??true,flux=inputs.sourceFlux??1800,time=0,origin=[...emitter.origin],direction=[...emitter.direction],status;
    const read=()=>({source:'explicit_synthetic_nozzle_not_camera',running,moving,flux,jetSpeed,origin,direction,runtime:fluid.read()});
    const publish=()=>{
      fluid.setPacket({packet_id:'synthetic-nozzle-'+time,route_identity:'mls-juice-synthetic-nozzle',timestamp_ms:Date.now(),
        authority:{simulation_safe:running,reason:running?null:'paused'},emitters:[{id:'nozzle',active:running,
          origin_world:origin,aim_world:direction,radius:.0704,strength:jetSpeed,lifetime_seconds:6,source_flux_particles_per_second:flux}]});
      fluid.setPaused(!running);
    };
    const frame=()=>scene.setView(inputs.sceneLayout==='runway'?{position:[5,4,8],target:[0,.65,-1.2]}:{position:[3,2.7,4],target:[0,.65,0]});frame();publish();
    unsubscribe=scene.onFrame(({deltaSeconds})=>{
      if(running){time+=deltaSeconds;if(moving){origin=[Math.sin(time*1.7)*.6,1.35,Math.cos(time*1.1)*.25];direction=[Math.sin(time)*.35,-.6,-.8];}publish();}
      if(status){const s=fluid.read();status.textContent=`${s.effectiveRoute??s.requestedRoute} | ${s.solver.liveInlets.activePlanned} particles | ${s.solver.clock.simulatedSeconds.toFixed(2)} s simulated${s.failure?' | '+s.failure:''}`;}
    });
    const event=kind=>record({kind,phase:'applied',effective:read()});
    return {read,operations:{
      setRunning(value){running=Boolean(value);publish();event('mls-juice.running');return read();},
      setMoving(value){moving=Boolean(value);event('mls-juice.moving');return read();},
      setFlux(value){flux=validFlux(value);publish();event('mls-juice.flux');return read();},
      setEmitter(value){
        if(!value.origin?.every(Number.isFinite)||value.origin.length!==3||!value.direction?.every(Number.isFinite)||value.direction.length!==3||Math.hypot(...value.direction)<1e-8)throw Error('Invalid nozzle pose');
        origin=[...value.origin];direction=[...value.direction];moving=false;publish();event('mls-juice.pose');return read();
      },frame,snapshot:()=>fluid.snapshot()},
      mount({root,document,invoke}){
        for(const [text,value,operation]of [['Run',running,'setRunning'],['Sweep nozzle',moving,'setMoving']]){
          const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=value;
          input.onchange=()=>invoke(operation,input.checked);label.append(input,document.createTextNode(text));label.style.display='block';root.append(label);
        }
        const label=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent='Emission / second';
        input.type='number';input.min='0';input.step='any';input.value=flux;input.setAttribute('aria-label','Emission / second');input.className='transform-input';
        input.oninput=()=>{if(input.value.trim())invoke('setFlux',Number(input.value));};label.append(grip,input);root.append(label);
        host.controls.installNumberDrag({input,grip,step:60});status=document.createElement('output');status.style.cssText='display:block;overflow-wrap:anywhere';root.append(status);
      },
      async dispose(){unsubscribe();try{fluid.dispose();}finally{await scene.dispose();}}
    };
    }catch(error){unsubscribe?.();try{fluid?.dispose();}finally{await scene.dispose();}throw error;}
  }
};
