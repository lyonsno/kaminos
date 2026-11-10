import * as THREE from '../lib/three.webgpu.js';
import {createGrassTeacherSource} from '../surface-teacher-source.mjs';
import {SurfaceTeacher} from '../surface-teacher.mjs';
import {prepareNavigationGeometry} from '../scene-navigation.mjs';

function checkedConfiguration(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!Number.isFinite(value.scale)||value.scale<=0||!Number.isSafeInteger(value.bounces)||value.bounces<1||!Number.isFinite(value.environment)||value.environment<0||typeof value.reconstruction!=='boolean'||typeof value.paused!=='boolean')throw Error('Invalid teacher quality or transport setting');
 return value;
}

export default {
 id:'grass-surface-teacher',title:'Grass surface teacher',
 async create({host,inputs={},record,updateInputs=()=>{}}){
  if(!inputs||typeof inputs!=='object'||Array.isArray(inputs))throw Error('Teacher inputs must be an object');
  let configuration=checkedConfiguration({scale:inputs.scale??.5,bounces:inputs.bounces??3,environment:inputs.environment??.15,reconstruction:inputs.reconstruction??true,paused:inputs.paused??false});
  let source=createGrassTeacherSource(inputs.source),engine,texture,screenMaterial,screen,asset,stop;
  const session=await host.scene.open();let context;
  try{context=host.scene.rendering();const size=context.renderer.getDrawingBufferSize(new THREE.Vector2()),limit=context.renderer.backend.device.limits.maxTextureDimension2D;if(Math.round(size.x*configuration.scale)>limit||Math.round(size.y*configuration.scale)>limit)throw Error('Image scale exceeds active device capacity');}catch(error){await session.dispose();throw error;}
  const {renderer,scene,camera}=context;
  const bladeMaterial=new THREE.MeshStandardMaterial({color:0x71812c,roughness:.65,side:THREE.DoubleSide,colorWrite:false,depthWrite:false});
  const groundMaterial=new THREE.MeshStandardMaterial({color:0x62513a,roughness:.95,colorWrite:false,depthWrite:false});
  const root=new THREE.Mesh(new THREE.BufferGeometry(),[groundMaterial,bladeMaterial]);root.name='Frozen grass ribbons';root.castShadow=false;root.receiveShadow=false;
  let sceneKey='',failure=null,capturing=false,disposed=false,status,pending=null,fieldDocument;
  const fields=[];
  const syncControls=()=>{for(const {input,group,key}of fields){if(fieldDocument.activeElement===input)continue;const value=group==='source'?source.config[key]:configuration[key];if(input.type==='checkbox')input.checked=value;else input.value=String(value);}};
  const cameraFrame=()=>{camera.updateMatrixWorld(true);return {viewProjection:new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).elements,position:camera.getWorldPosition(new THREE.Vector3()).toArray()};};
  const gpuFailure=event=>{failure=event.error?.message??String(event.error);showStatus();};
  const replaceGeometry=()=>{
   const positions=new Float32Array(source.triangles.flatMap(t=>[...t.a,...t.b,...t.c]));
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.addGroup(0,6,0);geometry.addGroup(6,positions.length/3-6,1);geometry.computeVertexNormals();geometry.computeBoundingSphere();const old=root.geometry;root.geometry=geometry;old.dispose();sceneKey='';if(asset){host.scene.refreshPresentation(asset);void prepareNavigationGeometry(root);}
  };
  const nativeLights=()=>{
   const lights=[];scene.updateMatrixWorld(true);
   scene.traverseVisible(light=>{
    if(!light.isDirectionalLight&&!light.isPointLight&&!light.isSpotLight)return;
    if((light.isPointLight||light.isSpotLight)&&light.decay!==2)return;
    const p=new THREE.Vector3();light.getWorldPosition(p);
    if(light.isDirectionalLight){const target=new THREE.Vector3();light.target.getWorldPosition(target);p.sub(target).normalize();}
    let spot={};if(light.isSpotLight){const target=new THREE.Vector3();light.target.getWorldPosition(target);spot={direction:target.sub(p).normalize().toArray(),angle:light.angle,penumbra:light.penumbra};}
    lights.push({type:light.isSpotLight?'spot':light.isPointLight?'point':'directional',position:p.toArray(),color:light.color.toArray().map(v=>v*light.intensity),...spot});
   });return lights;
  };
  const syncScene=()=>{
   const lights=nativeLights();root.updateWorldMatrix(true,false);
   const materials=[groundMaterial,bladeMaterial].map(m=>({color:m.color.toArray(),roughness:m.roughness,metalness:m.metalness}));
   const next=JSON.stringify([root.matrixWorld.elements,materials,lights,root.visible]);
   if(next!==sceneKey){
    const v=p=>new THREE.Vector3(...p).applyMatrix4(root.matrixWorld).toArray();
    const triangles=source.triangles.map(t=>({...t,a:v(t.a),b:v(t.b),c:v(t.c)}));
    if(!root.visible||!host.scene.isVisible(asset.id))throw Error('Teacher source is hidden; restore its visibility to capture');
    if(engine)engine.setScene({triangles,materials,lights});else engine=new SurfaceTeacher(renderer.backend.device,{triangles,materials,lights,...configuration});sceneKey=next;
   }
   engine.setTransport(configuration);
  };
  const read=()=>({schema:'kaminos.grass-surface-teacher.v1',objectId:asset?.id,source:source.config,configuration:{...configuration},effective:engine?.state()??null,view:session.readView(),cameraFrame:cameraFrame(),failure,capturing,display:'shared Kaminos scene and camera; native selection/gizmos',displaySourceVisible:!!root.parent&&host.scene.isVisible(asset?.id),presentationLighting:screenMaterial?.lights===false?'lighting bypassed':'unverified',navigationIndexReady:!!root.geometry.boundsTree,supportedLights:'native directional, inverse-square point and spot; constant environment',boundary:'finite grass patch on backing; not yet a periodic teacher',deviceOwnership:'borrowed'});
  const showStatus=()=>{if(status)status.textContent=failure?`Stopped: ${failure}`:capturing?'Capturing raw reference…':`${configuration.paused?'Paused · ':''}${engine?.samples??0} samples · ${engine?.width??0} × ${engine?.height??0} · ${configuration.bounces} bounces`;};
  const render=({width,height,filter=configuration.reconstruction}={})=>{
   if(disposed)return;
   if(!camera.isPerspectiveCamera)throw Error('Grass teacher currently requires the shared perspective camera');
   const size=renderer.getDrawingBufferSize(new THREE.Vector2());
   width??=Math.max(1,Math.round(size.x*configuration.scale));height??=Math.max(1,Math.round(size.y*configuration.scale));
   syncScene();engine.render({view:session.readView(),cameraFrame:cameraFrame(),width,height,filter});
   if(!texture||texture.image.width!==width||texture.image.height!==height){
    texture?.dispose();texture=new THREE.StorageTexture(width,height);texture.type=THREE.FloatType;texture.format=THREE.RGBAFormat;texture.minFilter=THREE.NearestFilter;texture.magFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.mipmapsAutoUpdate=false;
    const {textureLoad,screenUV,vec2,ivec2}=THREE.TSL;screenMaterial.colorNode=textureLoad(texture,ivec2(screenUV.mul(vec2(width,height)))).rgb;screenMaterial.needsUpdate=true;
   }
   engine.publish(renderer,texture);session.redraw();showStatus();
  };
  try{
   renderer.backend.device.addEventListener('uncapturederror',gpuFailure);
   replaceGeometry();asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:'procedural:frozen-grass-v1',type:'experiment'}});
   screenMaterial=new THREE.MeshBasicNodeMaterial({depthTest:false,depthWrite:false});screenMaterial.lights=false;screenMaterial.vertexNode=THREE.TSL.vec4(THREE.TSL.positionGeometry.xy,0,1);
   screen=new THREE.Mesh(new THREE.PlaneGeometry(2,2),screenMaterial);screen.name='Surface teacher presentation';screen.frustumCulled=false;screen.renderOrder=900;screen.raycast=()=>{};screen.userData.kaminosSurfaceTeacherPresentation=true;
   await session.attach(screen,{owned:true,presentation:true,metadata:{source:'surface-teacher-presentation'}});
   session.setView(inputs.view??{position:[2.5,1.7,3.2],target:[0,.35,0],fov:42});
   stop=session.onFrame(()=>{
    if(!root.parent||!root.visible||!host.scene.isVisible(asset.id)||!camera.isPerspectiveCamera){screen.visible=false;return;}screen.visible=true;
    if(configuration.paused||capturing||failure||document.hidden||pending)return;
    try{render();pending=engine.device.queue.onSubmittedWorkDone().catch(error=>{failure=error.message;showStatus();}).finally(()=>{pending=null;});}catch(error){failure=error.message;showStatus();}
   });
   const operations={
    frame(){return session.setView({position:[2.5,1.7,3.2],target:[0,.35,0],fov:42});},
    async source(values){const next=createGrassTeacherSource({...source.config,...values});await pending;source=next;replaceGeometry();syncScene();failure=null;syncControls();updateInputs({source:source.config,view:session.readView(),...configuration});session.redraw();record({kind:'surface-teacher.source',phase:'applied',effective:source.config});return read();},
    async configure(values){
     const next=checkedConfiguration({...configuration,...values}),size=renderer.getDrawingBufferSize(new THREE.Vector2());if(Math.round(size.x*next.scale)>renderer.backend.device.limits.maxTextureDimension2D||Math.round(size.y*next.scale)>renderer.backend.device.limits.maxTextureDimension2D)throw Error('Image scale exceeds active device capacity');
     await pending;configuration=next;syncScene();failure=null;syncControls();updateInputs({source:source.config,view:session.readView(),...configuration});session.redraw();record({kind:'surface-teacher.configuration',phase:'applied',effective:{...configuration}});showStatus();return read();
    },
    async capture({width,height,samples}={}){
     if(capturing)throw Error('A teacher capture is already active');if(![width,height,samples].every(v=>Number.isSafeInteger(v)&&v>0))throw Error('Explicit positive capture width, height and samples required');
     capturing=true;showStatus();const view=JSON.stringify([session.readView(),cameraFrame()]),sourceIdentity=JSON.stringify(source.config);let result;
     try{
      await pending;syncScene();const capturedSceneKey=sceneKey,transport=JSON.stringify([configuration.environment,configuration.bounces]);engine.resize(width,height);engine.reset('raw reference capture');
      for(let i=0;i<samples;i++){
       if(disposed||JSON.stringify([session.readView(),cameraFrame()])!==view||JSON.stringify(source.config)!==sourceIdentity)throw Error('Source or camera changed during raw capture');
       syncScene();if(sceneKey!==capturedSceneKey||JSON.stringify([configuration.environment,configuration.bounces])!==transport)throw Error('Geometry, lighting or transport changed during raw capture');
       render({width,height,filter:false});await engine.device.queue.onSubmittedWorkDone();
       if(failure)throw Error(failure);
       // A capture is an explicit held operation; yield so UI changes can cancel it.
       await new Promise(resolve=>setTimeout(resolve,0));
      }
      const pixels=await engine.readLinear();result={...read(),width,height,samples,pixels:Array.from(pixels)};return result;
     }finally{capturing=false;if(!disposed&&!failure&&root.parent&&host.scene.isVisible(asset.id)){try{render();}catch(error){failure=error.message;}}showStatus();session.redraw();}
    },
    async query({rays,sample=0}){syncScene();return engine.evaluate(rays,{sample});},
   };
   return {read,operations,mount({root:panel,document,invoke}){fieldDocument=document;
    const controls=[['Blade count','source','blades',1],['Blade height','source','height',.02],['Blade width','source','bladeWidth',.002],['Blade bend','source','bend',.03],['Source seed','source','seed',1],['Path bounces','configure','bounces',1],['Environment radiance','configure','environment',.02],['Resolution scale','configure','scale',.05]];
    const drags=[];for(const [label,op,key,step]of controls){const row=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=label+' ';input.type='number';input.step=String(step);input.value=String((op==='source'?source.config:configuration)[key]);input.className='transform-input';input.setAttribute('aria-label',label);input.addEventListener('input',()=>{if(input.value.trim())invoke(op,{[key]:Number(input.value)}).catch(error=>{status.textContent=error.message;});});input.addEventListener('blur',syncControls);fields.push({input,group:op==='source'?'source':'configuration',key});row.append(grip,input);panel.append(row);drags.push(host.controls.installNumberDrag({input,grip,step}));}
    for(const [label,key]of [['Reconstruction','reconstruction'],['Pause tracing','paused']]){const row=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=configuration[key];input.onchange=()=>invoke('configure',{[key]:input.checked}).catch(error=>{status.textContent=error.message;syncControls();});fields.push({input,group:'configuration',key});row.append(input,label);panel.append(row);}
    const frame=document.createElement('button');frame.textContent='Frame grass';frame.onclick=()=>invoke('frame').catch(error=>{status.textContent=error.message;});status=document.createElement('p');status.setAttribute('role','status');
    const note=document.createElement('p');note.textContent='Frozen ribbons with real visibility and surface bounces. Orbit in the scene. Select grass or ordinary scene lights in the native inspector; Add → Light creates another. Reconstruction off shows the raw accumulated estimate. This finite patch is for inspecting the source; periodic capture comes later.';
    panel.append(frame,status,note);showStatus();this.drags=drags;
   },async dispose(){disposed=true;stop?.();renderer.backend.device.removeEventListener('uncapturederror',gpuFailure);for(const drag of this.drags??[])drag?.dispose?.();engine?.dispose();texture?.dispose();await session.dispose();}};
  }catch(error){disposed=true;stop?.();renderer.backend.device.removeEventListener('uncapturederror',gpuFailure);engine?.dispose();texture?.dispose();try{await session.dispose();}catch(cleanup){throw new AggregateError([error,cleanup],`Grass setup: ${error.message}; cleanup: ${cleanup.message}`);}throw error;}
 }
};
