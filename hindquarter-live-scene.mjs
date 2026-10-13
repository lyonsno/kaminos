import * as THREE from 'three';
import {skinTransport,validateLiveManifest} from './hindquarter-live-core.mjs';

const sha=async buffer=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),x=>x.toString(16).padStart(2,'0')).join('');
export async function mountLiveTransport({casePath,expected,scene,camera,renderer,controls,gizmo,register,setInfo}){
  let phase='case-authentication';
  const state={schema:'kaminos.live-transport-browser.v1',status:'loading',requestedCase:casePath,requestedSha256:expected,events:[]};
  window.kaminosLiveTransport={snapshot:()=>structuredClone(state)};
  try{
    if(!/^scratch\/[a-z0-9_-]+$/.test(casePath)||!/^[a-f0-9]{64}$/.test(expected??''))throw Error('Explicit case path and digest required');
    async function bytes(name,digest,size){const response=await fetch(`./${casePath}/${name}`,{cache:'no-store'});if(!response.ok)throw Error(`${name}: HTTP ${response.status}`);const buffer=await response.arrayBuffer();if(size!==undefined&&buffer.byteLength!==size)throw Error(`${name}: incomplete bytes`);if(await sha(buffer)!==digest)throw Error(`${name}: digest mismatch`);return buffer;}
    const manifest=validateLiveManifest(JSON.parse(new TextDecoder().decode(await bytes('manifest.json',expected))));
    phase='asset-authentication';
    const paired=manifest.schema==='kaminos.live-transport.v1';
    const assetNames=['rest.bin','triangles.bin','automatic-weights.bin','automatic-presets.bin'];
    if(paired)assetNames.push('painted-weights.bin','blender-reference.bin');
    const arrays={};for(const name of assetNames){
      const asset=manifest.assets[name];if(!asset)throw Error('Missing live asset '+name);const buffer=await bytes(name,asset.sha256,asset.bytes);
      arrays[name]=name==='triangles.bin'?new Uint32Array(buffer):new Float32Array(buffer);
    }
    const rest=arrays['rest.bin'],triangles=arrays['triangles.bin'],automatic=arrays['automatic-weights.bin'],painted=arrays['painted-weights.bin'];
    for(const [name,array]of Object.entries(arrays))if(name!=='triangles.bin'&&array.some(v=>!Number.isFinite(v)))throw Error('Non-finite live asset '+name);
    if(rest.length!==manifest.vertices*3||triangles.length!==manifest.triangles*3||automatic.length!==manifest.vertices*8||(paired&&painted.length!==automatic.length)||triangles.some(i=>i>=manifest.vertices))throw Error('Incomplete live geometry');
    phase='scene-mount';
    const group=new THREE.Group();group.name='Automatic transport creature';scene.add(group);
    const referenceGroup=paired?new THREE.Group():null;
    if(referenceGroup){referenceGroup.name='Painted comparison';referenceGroup.position.x=2.2;scene.add(referenceGroup);}
    function mesh(parent,color){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(rest,3));geometry.setIndex(new THREE.BufferAttribute(triangles,1));geometry.computeVertexNormals();const object=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,roughness:.72,side:THREE.DoubleSide}));parent.add(object);return object;}
    const gold=mesh(group,0xd6b17c),gray=paired?mesh(referenceGroup,0xbfc3ca):null;
    const skins=[gold,...(gray?[gray]:[])];
    for(const skin of skins)skin.userData.kaminosDynamicGeometry=true;
    const bones=new Map(),inverseRest=new Map(),saved=new Map(),helpers=[];
    for(const spec of manifest.bones){
      const bone=new THREE.Bone();bone.name=spec.name;bones.set(spec.name,bone);
      inverseRest.set(spec.name,new THREE.Matrix4().set(...spec.restMatrix.flat()).invert());
    }
    for(const spec of manifest.bones){
      const bone=bones.get(spec.name),matrix=new THREE.Matrix4().set(...spec.restMatrix.flat());
      if(spec.parent){matrix.premultiply(inverseRest.get(spec.parent));bones.get(spec.parent).add(bone);}else group.add(bone);
      matrix.decompose(bone.position,bone.quaternion,bone.scale);
      saved.set(spec.name,{position:bone.position.clone(),quaternion:bone.quaternion.clone(),scale:bone.scale.clone()});
      if(spec.name==='pelvis')continue;
      const head=new THREE.Mesh(new THREE.SphereGeometry(.035,12,8),new THREE.MeshBasicMaterial({color:0x37d7eb,depthTest:false}));head.renderOrder=100;head.userData.transportBone=bone;bone.add(head);
      const localTail=new THREE.Vector3(...spec.tail).applyMatrix4(inverseRest.get(spec.name));
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),localTail]),new THREE.LineBasicMaterial({color:0x37d7eb,depthTest:false}));line.renderOrder=100;line.userData.transportBone=bone;bone.add(line);helpers.push(head,line);
    }
    group.updateMatrixWorld(true);
    const id='live-transport-creature',referenceId='live-transport-painted';
    register(group,{id,type:'mesh',fileName:'Automatic transport creature',source:null,label:'Gold · automatic transport · temporary live rig'});
    if(referenceGroup)register(referenceGroup,{id:referenceId,type:'mesh',fileName:'Painted reference',source:null,label:'Gray · original painted weights · same live pose'});
    const records=[];
    for(const [name,bone]of bones){if(name==='pelvis')continue;const boneId='live-bone:'+name;register(bone,{id:boneId,type:'rig-bone',source:null,fileName:name,label:name});records.push({id:boneId,name,uuid:bone.uuid});}
    let cached='',lastGood=new Map();
    function poseState(){return [...bones].map(([name,b])=>({name,position:b.position.toArray(),quaternion:b.quaternion.toArray(),scale:b.scale.toArray()}));}
    function update(){
      group.updateMatrixWorld(true);const inverseGroup=group.matrixWorld.clone().invert();
      const matrices=[new THREE.Matrix4().elements,...manifest.channels.slice(1).map(name=>new THREE.Matrix4().multiplyMatrices(inverseGroup,bones.get(name).matrixWorld).multiply(inverseRest.get(name)).elements)];
      const key=matrices.flat().join(',');if(key===cached)return;
      const start=performance.now();
      try{
        const goldResult=skinTransport(rest,automatic,matrices);
        gold.geometry.attributes.position.array.set(goldResult);
        if(gray)gray.geometry.attributes.position.array.set(skinTransport(rest,painted,matrices));
        for(const object of skins){object.geometry.attributes.position.needsUpdate=true;object.geometry.computeVertexNormals();object.geometry.computeBoundingSphere();object.geometry.computeBoundingBox();}
        cached=key;lastGood=new Map([...bones].map(([name,b])=>[name,{position:b.position.clone(),quaternion:b.quaternion.clone(),scale:b.scale.clone()}]));
        state.pose=poseState();state.lastUpdateMs=performance.now()-start;state.updateCount=(state.updateCount??0)+1;
        state.events.push({type:'deformation',pose:state.pose,at:performance.now(),updateMs:state.lastUpdateMs});
      }catch(error){for(const [name,s]of lastGood){const b=bones.get(name);b.position.copy(s.position);b.quaternion.copy(s.quaternion);b.scale.copy(s.scale);}group.updateMatrixWorld(true);state.events.push({type:'rejected-pose',reason:error.message,at:performance.now()});throw error;}
    }
    function restore(){for(const [name,s]of saved){const b=bones.get(name);b.position.copy(s.position);b.quaternion.copy(s.quaternion);b.scale.copy(s.scale);}update();window._kaminosDirty?.();}
    function preset(name){const frame=manifest.presets.find(p=>p.name===name);if(!frame)throw Error('Unknown source pose');for(const [boneName,s]of saved){const b=bones.get(boneName);b.position.copy(s.position);b.quaternion.copy(s.quaternion);b.scale.copy(s.scale);const q=frame.poseWxyz[boneName];if(q)b.quaternion.multiply(new THREE.Quaternion(q[1],q[2],q[3],q[0]));}update();state.events.push({type:'source-preset',name,at:performance.now()});window._kaminosDirty?.();return snapshot();}
    function snapshot(){return {...structuredClone(state),gizmo:{objectUuid:gizmo.object?.uuid??null,bone:gizmo.object?.isBone?gizmo.object.name:null,mode:gizmo.mode,visible:gizmo.visible},
      controls:records.map(r=>({...r,quaternion:bones.get(r.name).quaternion.toArray()})),goldBounds:gold.geometry.boundingBox?{min:gold.geometry.boundingBox.min.toArray(),max:gold.geometry.boundingBox.max.toArray()}:null};}
    function point(name){const bone=bones.get(name);if(!bone)throw Error('Unknown bone');const p=bone.getWorldPosition(new THREE.Vector3()).project(camera),rect=renderer.domElement.getBoundingClientRect();return {x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2};}
    function gizmoPoints(){
      gizmo.getHelper().updateMatrixWorld(true);
      const visible=gizmo._gizmo.gizmo.rotate.children.find(child=>child.name==='E');
      const ring=gizmo._gizmo.picker.rotate.children.find(child=>child.name==='E');
      if(!ring||!visible?.visible)throw Error('Visible standard screen-rotation ring is missing');
      const rect=renderer.domElement.getBoundingClientRect();
      const projected=angle=>{const p=new THREE.Vector3(.75*Math.cos(angle),.75*Math.sin(angle),0).applyMatrix4(ring.matrixWorld).project(camera);return {x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2};};
      return {axis:'E',from:projected(Math.PI/4),to:projected(Math.PI/4+.25)};
    }
    function pick(raycaster){const before=raycaster.params.Line.threshold;raycaster.params.Line.threshold=.025;try{const hits=raycaster.intersectObjects(helpers,false);const marker=hits.find(hit=>hit.object.isMesh);return (marker??hits[0])?.object.userData.transportBone??null;}finally{raycaster.params.Line.threshold=before;}}
    update();
    state.status='loaded';state.effectiveSha256=expected;state.sourceSha256=manifest.sourceSha256;
    state.candidatePaintedWeights=false;state.vertices=manifest.vertices;state.triangles=manifest.triangles;
    state.effectiveRoute='index-scene-live-rear-transport';state.rendererBackend=renderer.backend.constructor.name;
    state.registeredIds=[id,...(paired?[referenceId]:[]),...records.map(r=>r.id)];state.bindingRule=manifest.bindingRule;
    state.referenceAvailable=paired;state.sourceCast=manifest.sourceCast;state.provenance=manifest.provenance??null;
    state.referenceConformance=manifest.referenceConformance;state.acceptedBaseline=manifest.acceptedBaseline;
    state.persistence='temporary registered scene objects; reload/persistent rig authoring not implemented';
    function conformance(){
      const result=[];
      for(let i=0;i<manifest.presets.length;i++){
        preset(manifest.presets[i].name);const goldArray=gold.geometry.attributes.position.array,grayArray=gray?.geometry.attributes.position.array;
        let automaticError=0,paintedError=paired?0:null;const offset=i*rest.length;
        for(let k=0;k<rest.length;k++){automaticError=Math.max(automaticError,Math.abs(goldArray[k]-arrays['automatic-presets.bin'][offset+k]));if(paired)paintedError=Math.max(paintedError,Math.abs(grayArray[k]-arrays['blender-reference.bin'][offset+k]));}
        result.push({name:manifest.presets[i].name,automaticMaxError:automaticError,paintedMaxError:paintedError});
      }
      restore();return result;
    }
    const digests=async()=>({gold:await sha(gold.geometry.attributes.position.array.buffer),painted:gray?await sha(gray.geometry.attributes.position.array.buffer):null});
    window.kaminosLiveTransport={snapshot,preset,restore,point,gizmoPoints,update,conformance,digests,positions:()=>({gold:Array.from(gold.geometry.attributes.position.array),painted:gray?Array.from(gray.geometry.attributes.position.array):null}),manifest};
    camera.position.set(-3.0,1.4,6.5);controls.target.set(paired?.9:.18,-.6,-1.1);controls.update();
    setInfo(`Gold: automatic transport · ${paired?'Gray: painted reference':manifest.sourceCast+' · no painted reference'} · click cyan joint/bone, rotate with the scene gizmo. Temporary rig; source untouched.`);
    return {update,pick,group,bones,restore};
  }catch(error){state.status='failed';state.failurePhase=phase;state.error=error.message;throw error;}
}
