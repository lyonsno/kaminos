import {BufferGeometry,BufferAttribute,Mesh,Group,MeshStandardMaterial,LineSegments,LineBasicMaterial,EdgesGeometry,Box3,Vector3,PerspectiveCamera} from '../lib/three.core.js';
import {prepareSupportVolume,materializeFragments,supportVolumeMesh,worldPoint} from '../trellis-local-support.mjs';
import {clipSupportVolume} from '../trellis-support-gpu.mjs';

const MODES=['partition','source','support','lod'];
const DEFAULT_SOURCE='/scratch/barycentric-support/weathered-timber-beam.glb';
function geometry(part){const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(part.positions,3));if(part.normals)g.setAttribute('normal',new BufferAttribute(part.normals,3));else g.computeVertexNormals();if(part.uvs)g.setAttribute('uv',new BufferAttribute(part.uvs,2));return g;}
const summary=c=>({originalTriangles:c.sourceTriangleCount,broadPhaseTriangles:c.candidates.length,sourcePatchTriangles:c.patch.length,sourceTriangleIds:Array.from(new Set(c.patch.map(t=>t.sourceTriangle))),retainedCutTriangles:c.retained.length,untouchedTriangles:c.untouched.length,supportTriangles:12,diagnostics:c.diagnostics});

export default {
  id:'trellis-support',title:'TRELLIS local support and LOD',
  async create({host,inputs,record,updateInputs=()=>{}}){
    const session=await host.scene.open(),renderer=host.scene.renderer();
    if(!renderer.backend?.isWebGPUBackend){await session.dispose();throw Error('Local support construction requires WebGPU');}
    const device=renderer.backend.device;if(!device){await session.dispose();throw Error('The shared WebGPU device is unavailable');}
    let recipe={origin:[0,.12,0],normal:[0,1,0],tangent:[1,0,0],radius:.04,depth:.09,top:.015,...inputs.region};
    let draftRecipe=structuredClone(recipe),lastProjectionKey;
    let mode=inputs.mode??'partition',threshold=inputs.threshold??180,sourceUrl=inputs.sourceUrl??DEFAULT_SOURCE;
    if(!MODES.includes(mode)||!Number.isFinite(threshold)||threshold<=0){await session.dispose();throw Error('Invalid support display mode or positive LOD threshold');}
    let asset,sourceMesh,source,candidate,group,patchMesh,volumeMesh,wire,resources=[],status,selector,disposed=false,pending=false,error=null,generation=0,loadGeneration=0,effective='source',projectedPixels=null,loadSession;
    const fields=new Map();
    const free=()=>{group?.removeFromParent();for(const r of resources)r.dispose();resources=[];group=null;};
    const read=()=>({objectId:asset?.id,sourceUrl,source:asset?.source,backend:'WebGPU',mode,effective,threshold,projectedPixels,pending,error,region:structuredClone(recipe),candidate:candidate?summary(candidate):null,
      learnedMaterial:'absent: solid support is a geometry diagnostic',continuation:'Reopen using shareInputs; source and fitted geometry are reconstructed. Native scene transforms apply to the loaded asset.',shareInputs:{sourceUrl,region:structuredClone(recipe),mode,threshold}});
    const publish=()=>updateInputs(read().shareInputs);
    const sync=()=>{
      if(selector)selector.value=mode;
      for(const[k,field]of fields){const v=k.startsWith('origin')?recipe.origin[Number(k.at(-1))]:k==='threshold'?threshold:recipe[k];if(field.ownerDocument.activeElement!==field)field.value=String(v);}
      if(status)status.textContent=pending?'Constructing support in WebGPU…':error?`Retaining previous candidate: ${error}`:candidate?`${candidate.patch.length} source fragments from ${new Set(candidate.patch.map(t=>t.sourceTriangle)).size} original triangles; 12 support triangles. ${effective==='support'?'Solid support diagnostic — no learned material.':'Original material maps preserved.'}\nProjected support box: ${projectedPixels===null?'not measured':Math.round(projectedPixels)+' pixels across'}. LOD is a footprint routing preview; no performance crossover measured.`:'No candidate';
    };
    function applyVisibility(){
      if(!candidate)return;
      effective=mode==='lod'?(projectedPixels===null||projectedPixels>threshold?'source':'support'):mode;
      sourceMesh.visible=effective==='source';group.visible=effective!=='source';
      patchMesh.visible=effective==='partition';volumeMesh.visible=effective==='support';wire.visible=effective==='partition';
      session.redraw();sync();
    }
    function measure(){
      if(!candidate||!asset)return;
      const view=session.readView();sourceMesh.updateWorldMatrix(true,false);const projectionKey=JSON.stringify([view,sourceMesh.matrixWorld.elements,renderer.domElement.width,renderer.domElement.height,mode,threshold,recipe]);if(projectionKey===lastProjectionKey)return;lastProjectionKey=projectionKey;
      const cam=new PerspectiveCamera(view.fov,renderer.domElement.width/renderer.domElement.height,view.near,view.far);cam.position.fromArray(view.position);cam.up.fromArray(view.up);cam.zoom=view.zoom;cam.lookAt(new Vector3().fromArray(view.target));cam.updateMatrixWorld();cam.updateProjectionMatrix();
      let lo=[Infinity,Infinity],hi=[-Infinity,-Infinity],near=false;
      for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++){
        const p=new Vector3().fromArray(worldPoint([x?candidate.hi[0]:candidate.lo[0],y?candidate.hi[1]:candidate.lo[1],z?candidate.hi[2]:candidate.lo[2]],candidate.frame)).applyMatrix4(sourceMesh.matrixWorld);
        const cameraPoint=p.clone().applyMatrix4(cam.matrixWorldInverse);if(cameraPoint.z>=-cam.near)near=true;p.project(cam);lo[0]=Math.min(lo[0],p.x);hi[0]=Math.max(hi[0],p.x);lo[1]=Math.min(lo[1],p.y);hi[1]=Math.max(hi[1],p.y);
      }
      projectedPixels=near?null:Math.max((hi[0]-lo[0])*renderer.domElement.width/2,(hi[1]-lo[1])*renderer.domElement.height/2);
      const next=mode==='lod'?(projectedPixels===null||projectedPixels>threshold?'source':'support'):mode;if(next!==effective)applyVisibility();else sync();
    }
    async function rebuild(next,precomputed=null){
      const request=++generation;pending=true;error=null;sync();
      try{
        const prepared=precomputed?.prepared??prepareSupportVolume(source,next),clipped=precomputed?.clipped??await clipSupportVolume(device,prepared);
        if(disposed||request!==generation)return read();
        const c={...prepared,...clipped,diagnostics:{...prepared.diagnostics,...clipped.diagnostics}};
        const nextGroup=new Group();nextGroup.name='Local source/support pairing';nextGroup.matrixAutoUpdate=false;sourceMesh.updateMatrix();nextGroup.matrix.copy(sourceMesh.matrix);
        const owned=[];
        const untouched=sourceMesh.geometry.clone();untouched.setIndex(new BufferAttribute(Uint32Array.from(Array.from(c.untouched).flatMap(t=>[source.indices[t*3],source.indices[t*3+1],source.indices[t*3+2]])),1));owned.push(untouched);
        const cut=geometry(materializeFragments(source,c.retained,c.frame)),patch=geometry(materializeFragments(source,c.patch,c.frame)),support=geometry(supportVolumeMesh(c));owned.push(cut,patch,support);
        const tint=sourceMesh.material.clone();tint.color.setHex(0x62c6bf);const solid=new MeshStandardMaterial({color:0xe99c31,roughness:.65}),line=new LineBasicMaterial({color:0xffb629});owned.push(tint,solid,line);
        const edges=new EdgesGeometry(support);owned.push(edges);
        const untouchedMesh=new Mesh(untouched,sourceMesh.material),cutMesh=new Mesh(cut,sourceMesh.material),detail=new Mesh(patch,tint),volume=new Mesh(support,solid),outline=new LineSegments(edges,line);
        nextGroup.add(untouchedMesh,cutMesh,detail,volume,outline);for(const m of [untouchedMesh,cutMesh,detail,volume]){m.castShadow=true;m.receiveShadow=true;}
        free();resources=owned;group=nextGroup;patchMesh=detail;volumeMesh=volume;wire=outline;candidate=c;recipe=structuredClone(next);draftRecipe=structuredClone(recipe);sourceMesh.parent.add(group);pending=false;lastProjectionKey=null;measure();applyVisibility();publish();
        record({kind:'trellis-support.region',phase:'applied',target:asset.id,effective:read()});return read();
      }catch(e){if(request===generation){pending=false;error=e.message;sync();}throw e;}
    }
    async function load(url){
      if(typeof url!=='string'||!url.trim())throw Error('Source GLB URL required');
      const loadRequest=++loadGeneration,nextSession=await host.scene.open();let next;
      try{
        next=await nextSession.loadAsset({url,normalize:false});const meshes=[];next.root.traverse(o=>{if(o.isMesh)meshes.push(o);});
        if(meshes.length!==1||Array.isArray(meshes[0].material)||!meshes[0].geometry.index)throw Error('First support constructor requires one indexed mesh with one material');
        if(disposed||loadRequest!==loadGeneration){await nextSession.dispose();return read();}
        const g=meshes[0].geometry;if(g.attributes.position.isInterleavedBufferAttribute||g.attributes.normal?.isInterleavedBufferAttribute||g.attributes.uv?.isInterleavedBufferAttribute)throw Error('First support constructor requires packed vertex attributes');
        const nextSource={positions:Float32Array.from(g.attributes.position.array),indices:Uint32Array.from(g.index.array),normals:g.attributes.normal?Float32Array.from(g.attributes.normal.array):null,uvs:g.attributes.uv?Float32Array.from(g.attributes.uv.array):null};
        const prepared=prepareSupportVolume(nextSource,recipe),clipped=await clipSupportVolume(device,prepared);
        if(disposed||loadRequest!==loadGeneration){await nextSession.dispose();return read();}
        free();if(loadSession)await loadSession.dispose();loadSession=nextSession;asset=next;sourceMesh=meshes[0];sourceUrl=url;
        source=nextSource;await rebuild(recipe,{prepared,clipped});return read();
      }catch(e){if(loadSession!==nextSession)await nextSession.dispose();throw e;}
    }
    try{await load(sourceUrl);}catch(e){await loadSession?.dispose();await session.dispose();throw e;}
    const stop=session.onFrame(()=>measure());
    return {
      read,
      operations:{
        setRegion:next=>rebuild({...recipe,...next}),load,
        setMode(value){if(!MODES.includes(value))throw Error('Unknown support display mode');mode=value;measure();applyVisibility();publish();return read();},
        setThreshold(value){if(!Number.isFinite(value)||value<=0)throw Error('positive LOD threshold required');threshold=value;measure();applyVisibility();publish();return read();},
        frame(){const box=new Box3().setFromObject(asset.root),target=box.getCenter(new Vector3()),size=box.getSize(new Vector3()).length();return session.setView({position:target.clone().add(new Vector3(size*1.1,size*.8,size*1.25)).toArray(),target:target.toArray(),near:Math.max(size/10000,.0001)});},
        frameRegion(){sourceMesh.updateWorldMatrix(true,false);const target=new Vector3().fromArray(recipe.origin).applyMatrix4(sourceMesh.matrixWorld),size=recipe.radius*sourceMesh.getWorldScale(new Vector3()).length();return session.setView({position:target.clone().add(new Vector3(size*2,size*3,size*2)).toArray(),target:target.toArray(),near:Math.max(size/10000,.00001)});},
        inspectCandidate(){return {state:read(),patch:candidate.patch,retained:candidate.retained,untouched:Array.from(candidate.untouched),frame:candidate.frame,lo:candidate.lo,hi:candidate.hi};},
      },
      mount({root:panel,document,invoke}){
        const description=document.createElement('p');description.textContent='Local geometry partition on the original TRELLIS asset. Teal marks the exact source region; orange is its closed support. No neural material has been trained.';panel.append(description);
        const row=(text,node)=>{const label=document.createElement('label'),grip=document.createElement('span');grip.textContent=text+' ';label.append(grip,node);panel.append(label);return grip;};
        selector=document.createElement('select');for(const[value,label]of [['partition','Source region + support outline'],['source','Original source'],['support','Solid support diagnostic'],['lod','LOD routing preview']]){const opt=document.createElement('option');opt.value=value;opt.textContent=label;selector.append(opt);}row('Display',selector);selector.addEventListener('change',()=>invoke('setMode',selector.value).catch(failed));
        let timer;const failed=e=>{error=e.message;draftRecipe=structuredClone(recipe);sync();};
        for(const[k,label,step]of [['origin0','Region X',.005],['origin1','Region Y',.005],['origin2','Region Z',.005],['radius','Half width',.005],['depth','Inward depth',.005],['top','Outward extent',.005],['threshold','LOD switch footprint (pixels)',10]]){
          const field=document.createElement('input');field.type='number';field.step='any';field.className='transform-input';field.setAttribute('aria-label',label);const grip=row(label,field);fields.set(k,field);host.controls.installNumberDrag({input:field,grip,step});
          field.addEventListener('input',()=>{if(!field.value.trim()||!Number.isFinite(Number(field.value)))return;const value=Number(field.value);if(k==='threshold'){invoke('setThreshold',value).catch(failed);return;}draftRecipe=k.startsWith('origin')?{...draftRecipe,origin:draftRecipe.origin.map((x,i)=>i===Number(k.at(-1))?value:x)}:{...draftRecipe,[k]:value};clearTimeout(timer);const next=structuredClone(draftRecipe);timer=setTimeout(()=>invoke('setRegion',next).catch(failed),150);});
        }
        const sourceInput=document.createElement('input');sourceInput.type='text';sourceInput.value=sourceUrl;sourceInput.setAttribute('aria-label','Source GLB URL');row('Source GLB',sourceInput);
        const loadButton=document.createElement('button');loadButton.textContent='Load source';loadButton.addEventListener('click',()=>invoke('load',sourceInput.value).catch(failed));
        const frame=document.createElement('button');frame.textContent='Frame asset';frame.addEventListener('click',()=>invoke('frame').catch(failed));const close=document.createElement('button');close.textContent='Frame region';close.addEventListener('click',()=>invoke('frameRegion').catch(failed));status=document.createElement('p');status.setAttribute('role','status');panel.append(loadButton,frame,close,status);sync();
        return ()=>clearTimeout(timer);
      },
      async dispose(){disposed=true;generation++;loadGeneration++;stop();if(sourceMesh)sourceMesh.visible=true;free();await loadSession?.dispose();await session.dispose();},
    };
  },
};
