import * as THREE from '../lib/three.webgpu.js';
import {createGrassTeacherSource} from '../surface-teacher-source.mjs';
import {SurfaceTeacher} from '../surface-teacher.mjs';

export default {
 id:'grass-surface-teacher',title:'Grass surface teacher',
 async create({host,inputs,record}){
  const session=await host.scene.open(),context=host.scene.rendering(),{renderer,scene,camera}=context;
  let source=createGrassTeacherSource(inputs.source),engine,texture,screenMaterial,screen,asset,lightAsset,stop;
  const bladeMaterial=new THREE.MeshStandardMaterial({color:0x71812c,roughness:.65,side:THREE.DoubleSide,colorWrite:false,depthWrite:false});
  const groundMaterial=new THREE.MeshStandardMaterial({color:0x62513a,roughness:.95,colorWrite:false,depthWrite:false});
  const root=new THREE.Mesh(new THREE.BufferGeometry(),[groundMaterial,bladeMaterial]);root.name='Frozen grass ribbons';root.castShadow=false;root.receiveShadow=false;
  const key=new THREE.DirectionalLight(0xffedce,3);key.name='Grass teacher key';key.position.set(-2,3,2);key.target.position.set(0,.3,0);
  let configuration={scale:inputs.scale??.5,bounces:inputs.bounces??3,environment:inputs.environment??.15,reconstruction:inputs.reconstruction??true,paused:false};
  let sceneKey='',failure=null,capturing=false,disposed=false,status,pending=null;
  const gpuFailure=event=>{failure=event.error?.message??String(event.error);showStatus();};
  const replaceGeometry=()=>{
   const positions=new Float32Array(source.triangles.flatMap(t=>[...t.a,...t.b,...t.c]));
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.addGroup(0,6,0);geometry.addGroup(6,positions.length/3-6,1);geometry.computeVertexNormals();geometry.computeBoundingSphere();const old=root.geometry;root.geometry=geometry;old.dispose();sceneKey='';
  };
  const nativeLights=()=>{
   const lights=[];scene.updateMatrixWorld(true);
   scene.traverseVisible(light=>{
    if(!light.isDirectionalLight&&!light.isPointLight)return;
    if(light.isPointLight&&light.decay!==2)return;
    const p=new THREE.Vector3();light.getWorldPosition(p);
    if(light.isDirectionalLight){const target=new THREE.Vector3();light.target.getWorldPosition(target);p.sub(target).normalize();}
    lights.push({type:light.isPointLight?'point':'directional',position:p.toArray(),color:light.color.toArray().map(v=>v*light.intensity)});
   });return lights;
  };
  const syncScene=()=>{
   const lights=nativeLights();root.updateWorldMatrix(true,false);
   const materials=[groundMaterial,bladeMaterial].map(m=>({color:m.color.toArray(),roughness:m.roughness,metalness:m.metalness}));
   const next=JSON.stringify([root.matrixWorld.elements,materials,lights,root.visible]);
   if(next!==sceneKey){
    const v=p=>new THREE.Vector3(...p).applyMatrix4(root.matrixWorld).toArray();
    const triangles=source.triangles.map(t=>({...t,a:v(t.a),b:v(t.b),c:v(t.c)}));
    if(!root.visible)throw Error('Teacher source is hidden; restore its visibility to resume');
    if(engine)engine.setScene({triangles,materials,lights});else engine=new SurfaceTeacher(renderer.backend.device,{triangles,materials,lights,...configuration});sceneKey=next;
   }
   engine.setTransport(configuration);
  };
  const read=()=>({schema:'kaminos.grass-surface-teacher.v1',objectId:asset?.id,lightId:lightAsset?.id,source:source.config,configuration:{...configuration},effective:engine?.state()??null,view:session.readView(),failure,capturing,display:'shared Kaminos scene and camera; native selection/gizmos',supportedLights:'native directional and inverse-square point; constant environment',boundary:'finite grass patch on backing; not yet a periodic teacher',deviceOwnership:'borrowed'});
  const showStatus=()=>{if(status)status.textContent=failure?`Stopped: ${failure}`:capturing?'Capturing raw reference…':`${configuration.paused?'Paused · ':''}${engine?.samples??0} samples · ${engine?.width??0} × ${engine?.height??0} · ${configuration.bounces} bounces`;};
  const render=({width,height,filter=configuration.reconstruction}={})=>{
   if(disposed)return;
   if(!camera.isPerspectiveCamera)throw Error('Grass teacher currently requires the shared perspective camera');
   const size=renderer.getDrawingBufferSize(new THREE.Vector2());
   width??=Math.max(1,Math.round(size.x*configuration.scale));height??=Math.max(1,Math.round(size.y*configuration.scale));
   syncScene();engine.render({view:session.readView(),width,height,filter});
   if(!texture||texture.image.width!==width||texture.image.height!==height){
    texture?.dispose();texture=new THREE.StorageTexture(width,height);texture.type=THREE.FloatType;texture.format=THREE.RGBAFormat;texture.minFilter=THREE.NearestFilter;texture.magFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.mipmapsAutoUpdate=false;
    const {textureLoad,screenUV,vec2,ivec2}=THREE.TSL;screenMaterial.colorNode=textureLoad(texture,ivec2(screenUV.mul(vec2(width,height)))).rgb;screenMaterial.needsUpdate=true;
   }
   engine.publish(renderer,texture);session.redraw();showStatus();
  };
  try{
   renderer.backend.device.addEventListener('uncapturederror',gpuFailure);
   replaceGeometry();asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:'procedural:frozen-grass-v1',type:'experiment'}});
   lightAsset=await session.attach(key,{owned:true,metadata:{label:key.name,type:'light',source:'procedural:grass-teacher-key'}});
   screenMaterial=new THREE.MeshBasicNodeMaterial({depthTest:false,depthWrite:false});screenMaterial.positionNode=THREE.TSL.vec4(THREE.TSL.positionGeometry.xy,0,1);
   screen=new THREE.Mesh(new THREE.PlaneGeometry(2,2),screenMaterial);screen.name='Surface teacher presentation';screen.frustumCulled=false;screen.renderOrder=-100000;screen.raycast=()=>{};screen.userData.kaminosEditorOnly=true;
   await session.attach(screen,{owned:true,presentation:true,metadata:{source:'surface-teacher-presentation'}});
   session.setView(inputs.view??{position:[2.5,1.7,3.2],target:[0,.35,0],fov:42});
   stop=session.onFrame(()=>{
    if(!root.parent||!root.visible){screen.visible=false;return;}screen.visible=true;
    if(configuration.paused||capturing||failure||document.hidden||pending)return;
    try{render();pending=engine.device.queue.onSubmittedWorkDone().catch(error=>{failure=error.message;showStatus();}).finally(()=>{pending=null;});}catch(error){failure=error.message;showStatus();}
   });
   const operations={
    frame(){return session.setView({position:[2.5,1.7,3.2],target:[0,.35,0],fov:42});},
    source(values){const next=createGrassTeacherSource({...source.config,...values});source=next;replaceGeometry();session.redraw();record({kind:'surface-teacher.source',phase:'applied',effective:source.config});return read();},
    configure(values){
     const next={...configuration,...values};if(!Number.isFinite(next.scale)||next.scale<=0||!Number.isSafeInteger(next.bounces)||next.bounces<1||!Number.isFinite(next.environment)||next.environment<0||typeof next.reconstruction!=='boolean'||typeof next.paused!=='boolean')throw Error('Invalid teacher quality or transport setting');
     configuration=next;session.redraw();record({kind:'surface-teacher.configuration',phase:'applied',effective:{...configuration}});showStatus();return read();
    },
    async capture({width,height,samples}={}){
     if(capturing)throw Error('A teacher capture is already active');if(![width,height,samples].every(v=>Number.isSafeInteger(v)&&v>0))throw Error('Explicit positive capture width, height and samples required');
     capturing=true;showStatus();const view=JSON.stringify(session.readView()),sourceIdentity=JSON.stringify(source.config);let result;
     try{
      await pending;syncScene();const capturedSceneKey=sceneKey,transport=JSON.stringify([configuration.environment,configuration.bounces]);engine.reset('raw reference capture');
      for(let i=0;i<samples;i++){
       if(disposed||JSON.stringify(session.readView())!==view||JSON.stringify(source.config)!==sourceIdentity)throw Error('Source or camera changed during raw capture');
       syncScene();if(sceneKey!==capturedSceneKey||JSON.stringify([configuration.environment,configuration.bounces])!==transport)throw Error('Geometry, lighting or transport changed during raw capture');
       render({width,height,filter:false});await engine.device.queue.onSubmittedWorkDone();
       if(failure)throw Error(failure);
       // A capture is an explicit held operation; yield so UI changes can cancel it.
       await new Promise(resolve=>setTimeout(resolve,0));
      }
      const pixels=await engine.readLinear();result={...read(),width,height,samples,pixels:Array.from(pixels)};return result;
     }finally{capturing=false;showStatus();session.redraw();}
    },
    async query({rays,sample=0}){syncScene();return engine.evaluate(rays,{sample});},
   };
   return {read,operations,mount({root:panel,document,invoke}){
    const controls=[['Blade count','source','blades',1],['Blade height','source','height',.02],['Blade width','source','bladeWidth',.002],['Blade bend','source','bend',.03],['Source seed','source','seed',1],['Path bounces','configure','bounces',1],['Environment radiance','configure','environment',.02],['Resolution scale','configure','scale',.05]];
    const drags=[];for(const [label,op,key,step]of controls){const row=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=label+' ';input.type='number';input.step=String(step);input.value=String((op==='source'?source.config:configuration)[key]);input.className='transform-input';input.setAttribute('aria-label',label);input.addEventListener('input',()=>{if(input.value.trim())invoke(op,{[key]:Number(input.value)}).catch(error=>{status.textContent=error.message;});});row.append(grip,input);panel.append(row);drags.push(host.controls.installNumberDrag({input,grip,step}));}
    for(const [label,key]of [['Reconstruction','reconstruction'],['Pause tracing','paused']]){const row=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=configuration[key];input.onchange=()=>invoke('configure',{[key]:input.checked});row.append(input,label);panel.append(row);}
    const frame=document.createElement('button');frame.textContent='Frame grass';frame.onclick=()=>invoke('frame');status=document.createElement('p');status.setAttribute('role','status');
    const note=document.createElement('p');note.textContent='Frozen ribbons with real visibility and surface bounces. Orbit in the scene. Select the grass or key light in the native inspector. Reconstruction off shows the raw accumulated estimate. This finite patch is for inspecting the source; periodic capture comes later.';
    panel.append(frame,status,note);showStatus();this.drags=drags;
   },async dispose(){disposed=true;stop?.();renderer.backend.device.removeEventListener('uncapturederror',gpuFailure);for(const drag of this.drags??[])drag?.dispose?.();engine?.dispose();texture?.dispose();await session.dispose();}};
  }catch(error){disposed=true;stop?.();renderer.backend.device.removeEventListener('uncapturederror',gpuFailure);engine?.dispose();texture?.dispose();await session.dispose();throw error;}
 }
};
