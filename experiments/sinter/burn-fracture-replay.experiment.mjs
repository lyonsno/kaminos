import * as THREE from '../../lib/three.webgpu.js';
import {createBurnReplayField,createBurnFractureSurface,replayRegionBodies} from '../../burn-fracture-replay.mjs';
import {createSceneBurnStructure} from '../../scene-burn-structure.mjs';
import {createBurnFractureGpu} from '../../burn-fracture-gpu.mjs';
import {createBurnFracturePlayback,checkedBurnMaterial} from '../../burn-fracture-core.mjs';

const sha256=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
export default {id:'sinter-burn-fracture-replay',title:'Burned material mechanics',
 async create({host,inputs,record}){
  for(const key of ['source','sourceSha256','material','materialSha256'])if(typeof inputs[key]!=='string'||!inputs[key])throw Error('Replay input required: '+key);
  const session=await host.scene.open(),renderer=host.scene.renderer();let asset,field,structure,dynamics,surface,playback,platform,contactGeometry,unframe,disposed=false,running=false,error=null,button,status,syncSupport=()=>{},worldScale;
  const material=checkedBurnMaterial(inputs.materialModel);
  const read=()=>({identity:'kaminos.burn-fracture.replay.v1',inputs,effective:{backend:renderer.backend.isWebGPUBackend?'WebGPU':'unsupported',adapter:renderer.backend.device.adapterInfo?{vendor:renderer.backend.device.adapterInfo.vendor,description:renderer.backend.device.adapterInfo.description}:null},sourceAuthority:'retained-native-material-observation',thermal:'frozen-not-live-coupled',sceneContact:'finite-editable-support',contactGeometry,worldScale,worldMaterial:material,running,error,playback:playback?.read(),structure:structure?.read(),mechanics:dynamics?.read(),surface:surface?.read()});
  const sync=()=>{if(button)button.textContent=running?'Pause':'Run';if(status)status.textContent=error??`${dynamics?.read().regions??0} regions`;};
  const dispose=async()=>{if(disposed)return;disposed=true;running=false;unframe?.();await playback?.settled();surface?.dispose();dynamics?.dispose();structure?.dispose();field?.dispose();await session.dispose();};
  try{
   const sourceResponse=await fetch(inputs.source);if(!sourceResponse.ok)throw Error('Source load failed: '+sourceResponse.status);if(await sha256(await sourceResponse.arrayBuffer())!==inputs.sourceSha256)throw Error('Replay source hash mismatch');
   const materialResponse=await fetch(inputs.material);if(!materialResponse.ok)throw Error('Material observation load failed: '+materialResponse.status);const bytes=await materialResponse.arrayBuffer();if(await sha256(bytes)!==inputs.materialSha256)throw Error('Replay material hash mismatch');const raw=JSON.parse(new TextDecoder().decode(bytes));
   asset=await session.loadAsset({url:inputs.source,normalize:false,metadata:{label:'Burned material mechanics',source:inputs.source}});
   const meshes=[];asset.root.traverse(m=>{if(m.isMesh)meshes.push(m);});if(meshes.length!==1)throw Error('Replay currently requires the same single-mesh source as the observed burn');const source=meshes[0];
   field=createBurnReplayField({renderer,mesh:source,raw});
   structure=createSceneBurnStructure({renderer,field,parent:asset.root});await structure.configure(true);if(structure.read().status!=='resident')throw Error(structure.read().error??'Section preparation failed');
   const {prepared}=structure.resident(),world=new THREE.Matrix4().fromArray(field.input.matrix),inverse=world.clone().invert();
   const scale=new THREE.Vector3().setFromMatrixScale(world);worldScale=scale.x;
   if(world.determinant()<=0||Math.max(...scale.toArray())-Math.min(...scale.toArray())>worldScale*1e-6)throw Error('Mechanical replay requires a positive uniform source scale');
   // F_local=F_world/s and torque_local=torque_world/s^2. Preserve SI material
   // under the source-coordinate solver by scaling K/strength by s and mass by s^3.
   const localMaterial={...material,tension:material.tension*worldScale,compression:material.compression*worldScale,shear:material.shear*worldScale,density:material.density*worldScale**3};
   const bodies=replayRegionBodies(prepared,field,localMaterial.density);contactGeometry={model:bodies.contactModel,massModel:bodies.massModel,unmapped:bodies.unmapped};
   bodies.prepared={...bodies.prepared,bonds:bodies.prepared.bonds.map(b=>({...b,linearStiffness:b.linearStiffness*worldScale,rotationalStiffness:b.rotationalStiffness*worldScale}))};
   const originalBounds=new THREE.Box3();for(const c of prepared.cells)for(let corner=0;corner<8;corner++)originalBounds.expandByPoint(new THREE.Vector3(...c.position.map((v,k)=>v+((corner>>k)&1?1:-1)*c.halfExtents[k])).applyMatrix4(world));
   const extent=originalBounds.getSize(new THREE.Vector3()),supportCenter=originalBounds.getCenter(new THREE.Vector3()),thickness=extent.length()*.06;
   const supportSize=[extent.x*1.4,thickness,extent.z*1.4];
   platform=new THREE.Mesh(new THREE.BoxGeometry(...supportSize),new THREE.MeshStandardMaterial({color:0x6b7779,roughness:.8}));platform.name='Mechanical support';platform.position.set(supportCenter.x,originalBounds.min.y-thickness/2,supportCenter.z);
   const registration=await session.attach(platform,{owned:true,metadata:{label:'Mechanical support'}});
   const support=()=>{platform.updateWorldMatrix(true,false);const local=inverse.clone().multiply(platform.matrixWorld),position=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();local.decompose(position,q,s);return {position:position.toArray(),quaternion:q.toArray(),halfExtents:supportSize.map((v,k)=>v*s.getComponent(k)/2),friction:.6};};
   const gravity=new THREE.Vector3(0,-9.81,0).applyMatrix3(new THREE.Matrix3().setFromMatrix4(inverse)).toArray();
   dynamics=await createBurnFractureGpu({renderer,prepared:bodies.prepared,sections:structure.resident(),finiteSupports:[support()],regionMasses:bodies.masses,material:localMaterial,gravity});
   let supportMatrix=platform.matrixWorld.clone();syncSupport=()=>{platform.updateWorldMatrix(true,false);if(!supportMatrix.equals(platform.matrixWorld)){dynamics.setSupport(0,support());supportMatrix.copy(platform.matrixWorld);}};
   surface=createBurnFractureSurface({renderer,prepared,materials:structure.resident().sourceMaterials,field,dynamics});
   source.visible=false;
   world.decompose(asset.root.position,asset.root.quaternion,asset.root.scale);asset.root.updateMatrix();asset.root.add(surface.mesh);
   // The section overlay is diagnostic state, not the mechanical surface.
   for(const child of asset.root.children)if(child.name==='Structural connection inspection')child.visible=false;
   asset.root.updateWorldMatrix(true,true);
   const box=new THREE.Box3().setFromObject(surface.mesh),center=box.getCenter(new THREE.Vector3()),radius=box.getSize(new THREE.Vector3()).length();
   session.setView({target:center.toArray(),position:center.clone().add(new THREE.Vector3(1,.5,1.4).normalize().multiplyScalar(radius*1.3)).toArray()});
   const fail=cause=>{running=false;error=cause.message;sync();};
   playback=createBurnFracturePlayback({stepSeconds:prepared.config.timeStep,advance:seconds=>{syncSupport();dynamics.advance(seconds);session.redraw();},completed:()=>renderer.backend.device.queue.onSubmittedWorkDone(),onError:fail});
   unframe=session.onFrame(({deltaSeconds})=>{if(!running||disposed)return;try{playback.tick(deltaSeconds);sync();}catch(cause){fail(cause);}});sync();
   return {read,operations:{
    run(value=true){if(disposed)throw Error('Replay is disposed');running=value===true;sync();record({kind:'burn-fracture.run',effective:running});return read();},
    async advance(seconds){if(running)throw Error('Pause before exact mechanics advance');await playback.settled();if(disposed)throw Error('Replay is disposed');syncSupport();dynamics.advance(seconds);session.redraw();sync();return read();},
    moveSupport(position){if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))throw Error('Finite world support position required');platform.position.fromArray(position);syncSupport();host.scene.refreshPresentation(registration);record({kind:'burn-fracture.support',position:[...position]});return read();},
    snapshot:()=>dynamics.snapshot(),
    sectionSnapshot:()=>structure.snapshot(),
   },mount({root,document,invoke}){button=document.createElement('button');button.type='button';button.addEventListener('click',()=>invoke('run',!running).catch(e=>{error=e.message;sync();}));status=document.createElement('p');status.setAttribute('role','status');root.append(button,status);sync();},dispose};
  }catch(cause){await dispose();throw cause;}
 }};
