import {createTrellisPatchComparison} from '../trellis-patch-comparison.mjs';
import {createChoiceButtons} from '../experiment-choice-buttons.mjs';
import {BufferGeometry,BufferAttribute,Mesh,Group,MeshStandardMaterial,LineSegments,LineBasicMaterial,EdgesGeometry,Box3,Vector3,PerspectiveCamera} from '../lib/three.core.js';
import {prepareSupportVolume,materializeFragments,supportVolumeMesh,worldPoint,supportSourceFromMesh,sampleSourceAddress} from '../trellis-local-support.mjs';
import {clipSupportVolume} from '../trellis-support-gpu.mjs';
import {traceSupportRays} from '../trellis-support-rays.mjs';
import {createSourceMaterialSampler} from '../trellis-source-material.mjs';
import {evaluateSourceRegionLighting} from '../trellis-surface-teacher.mjs';

const MODES=['partition','isolated','source','support','lod','comparison'];
const DEFAULT_COMPARISON_CATALOG='/api/read?root=image-inbox&path=trellis-patch-comparison%2Fcatalog.json';
const DEFAULT_SOURCE='/api/read?root=generated-meshes&path=barycentric-support%2Fmachined-graphite-finished.glb';
const PLATE_REGIONS={panel:{origin:[0,.112,.2],normal:[0,1,0],tangent:[1,0,0],radius:.06,depth:.04,top:.015},rim:{origin:[.12,.095,.48],normal:[0,1,1],tangent:[1,0,0],radius:.04,depth:.05,top:.03}};
function geometry(part){const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(part.positions,3));if(part.normals)g.setAttribute('normal',new BufferAttribute(part.normals,3));else g.computeVertexNormals();if(part.uvs)g.setAttribute('uv',new BufferAttribute(part.uvs,2));return g;}
const summary=c=>({originalTriangles:c.sourceTriangleCount,broadPhaseTriangles:c.candidates.length,sourcePatchTriangles:c.patch.length,sourceTriangleIds:Array.from(new Set(c.patch.map(t=>t.sourceTriangle))),retainedCutTriangles:c.retained.length,untouchedTriangles:c.untouched.length,supportTriangles:12,boundarySegments:c.boundarySegments.length,diagnostics:c.diagnostics});

export default {
  id:'trellis-support',title:'TRELLIS local support and LOD',
  async create({host,inputs,record,updateInputs=()=>{}}){
    const session=await host.scene.open(),renderer=host.scene.renderer();
    if(!renderer.backend?.isWebGPUBackend){await session.dispose();throw Error('Local support construction requires WebGPU');}
    const device=renderer.backend.device;if(!device){await session.dispose();throw Error('The shared WebGPU device is unavailable');}
    let recipe={...structuredClone(PLATE_REGIONS.panel),...inputs.region};
    let draftRecipe=structuredClone(recipe),lastProjectionKey;
    let mode=inputs.mode??'partition',threshold=inputs.threshold??180,sourceUrl=inputs.sourceUrl??DEFAULT_SOURCE;
    if(!MODES.includes(mode)||!Number.isFinite(threshold)||threshold<=0){await session.dispose();throw Error('Invalid support display mode or positive LOD threshold');}
    const lod=host.controls.document.defaultView.kaminosSceneLodBudget,previousLod=lod?.read();
    if(!previousLod){await session.dispose();throw Error('Source-exact inspection requires the scene LOD service');}
    lod.setSettings({enabled:false});
    const restoreLod=()=>lod.setSettings({enabled:previousLod.enabled});
    let asset,sourceMesh,source,candidate,group,patchMesh,patchTint,retainedMeshes=[],volumeMesh,wire,boundaryWire,resources=[],status,selector,disposed=false,pending=false,error=null,generation=0,loadGeneration=0,effective='source',projectedPixels=null,loadSession;
    let probeResult=null,probeLines,probeResources=[],probePending=false,probeVersion=0,sourceMaterial,lightingResult=null,lightingVersion=0,lightingPending=false;
    const fields=new Map();let exampleSelector,comparisonChoices,checkpointChoices,outlineButton,comparison=null,comparisonVersion=0,comparisonPending=false,checkpointId=null,sourceDigest=null;
    let comparisonEntries=[],comparisonError=null,inspectionLight=null;const inspectionLights=new Set();
    const comparisonCatalog=inputs.comparisonCatalog??DEFAULT_COMPARISON_CATALOG;
    try{const response=await fetch(comparisonCatalog);if(!response.ok)throw Error(`Checkpoint catalog HTTP ${response.status}`);const catalog=await response.json();if(catalog.schema!=='kaminos.trellis-patch-comparison.v1'||!Array.isArray(catalog.checkpoints))throw Error('Unknown patch comparison catalog');comparisonEntries=catalog.checkpoints;}catch(e){comparisonError=e.message;}
    const clearProbe=(cancel=true)=>{lightingVersion++;lightingResult=null;lightingPending=false;if(cancel)probeVersion++;probeLines?.removeFromParent();for(const r of probeResources)r.dispose();probeResources=[];probeLines=null;probeResult=null;probePending=false;};
    const free=()=>{clearProbe();group?.removeFromParent();for(const r of resources)r.dispose();resources=[];group=null;};
    const read=()=>({objectId:asset?.id,sourceUrl,source:asset?.source,backend:'WebGPU',mode,effective,threshold,projectedPixels,pending,error,region:structuredClone(recipe),candidate:candidate?summary(candidate):null,probe:probeResult?structuredClone(probeResult):null,probePending,lightingPending,lighting:lightingResult?structuredClone(lightingResult):null,sourceMaterial:sourceMaterial?.read(),
      sourceRoute:{beautyLodEnabled:lod.read().enabled,previousBeautyLodEnabled:previousLod.enabled,scope:'page-local full-source inspection; restored when experiment closes'},
      inspectionLight,sceneLights:host.scene.objects().filter(o=>o.type==='light').map(o=>({id:o.id,...o.light,position:o.object.position.toArray(),rotation:o.object.rotation.toArray().slice(0,3)})),comparison:{...(comparison?.read()??{available:false}),pending:comparisonPending,error:comparisonError,checkpoints:comparisonEntries.map(e=>({id:e.id,label:e.label})),view:session.readView()},learnedMaterial:comparison?(comparison.read().learnedAvailable?'trained checkpoint on its original section':'training pending; actual raw source section only'):'absent: solid support is a geometry diagnostic',continuation:'Reopen using shareInputs; source and fitted geometry are reconstructed. Native scene transforms apply to the loaded asset.',shareInputs:{sourceUrl,region:structuredClone(recipe),mode,threshold,comparisonCatalog,checkpoint:checkpointId,comparison:comparison?.read().requested??'source',outline:comparison?.read().outline??true}});
    const publish=()=>updateInputs(read().shareInputs);
    const sync=()=>{
      if(selector)selector.value=mode;
      if(outlineButton){outlineButton.disabled=!comparison;outlineButton.setAttribute('aria-pressed',String(comparison?.read().outline??false));}
      if(comparisonChoices){comparisonChoices.value=comparison?.read().requested??'source';comparisonChoices.disabled=!comparison||comparisonPending;comparisonChoices.setUnavailable('learned',!comparison?.read().learnedAvailable);}
      if(checkpointChoices){checkpointChoices.value=checkpointId??'';checkpointChoices.disabled=comparisonPending||sourceUrl!==DEFAULT_SOURCE;}
      if(exampleSelector){exampleSelector.disabled=sourceUrl!==DEFAULT_SOURCE;exampleSelector.value=sourceUrl===DEFAULT_SOURCE?(Object.entries(PLATE_REGIONS).find(([,r])=>Object.entries(r).every(([k,v])=>JSON.stringify(recipe[k])===JSON.stringify(v)))?.[0]??'custom'):'custom';}
      for(const[k,field]of fields){const v=k.startsWith('origin')?recipe.origin[Number(k.at(-1))]:k==='threshold'?threshold:recipe[k];if(field.ownerDocument.activeElement!==field)field.value=String(v);}
      if(status){status.dataset.trellisSupportStatus=JSON.stringify({origin:recipe.origin,pending,error,probePending,probeSamples:probeResult?.samples.length??0});status.textContent=pending?'Constructing support in WebGPU…':error?`Retaining previous candidate: ${error}`:candidate?`${candidate.patch.length} source fragments from ${new Set(candidate.patch.map(t=>t.sourceTriangle)).size} original triangles; 12 support triangles; ${candidate.boundarySegments.length} addressed boundary segments. ${effective==='support'?'Solid support diagnostic — no learned material.':'Original material maps preserved.'}\nProjected support box: ${projectedPixels===null?'not measured':Math.round(projectedPixels)+' pixels across'}. LOD is a footprint routing preview; no performance crossover measured.`:'No candidate';if(probePending)status.textContent+=' Tracing source probes…';else if(probeResult){const hits=probeResult.samples.filter(s=>s.hit),range=k=>`${Math.min(...hits.map(s=>s.material[k])).toFixed(3)}–${Math.max(...hits.map(s=>s.material[k])).toFixed(3)}`;status.textContent+=` Probes: ${hits.length} source hits, ${probeResult.samples.filter(s=>!s.hit&&s.intersectsSupport).length} volume exits.`;if(hits.length)status.textContent+=` Material samples: roughness ${range('roughness')}, metalness ${range('metalness')}.`;status.textContent+=' Source-map LOD 0.';if(lightingPending)status.textContent+=' Evaluating directional lighting…';else if(lightingResult)status.textContent+=` Textured directional lighting: ${lightingResult.radiance.length} rays, ${lightingResult.bounces} bounce(s), clipped region only; no footprint integral.`;}}
      if(status){if(comparisonPending)status.textContent+=' Loading section checkpoint…';else if(comparisonError)status.textContent+=' Section comparison: '+comparisonError;else if(mode==='comparison'&&comparison){const c=comparison.read();status.textContent=c.trainingPending?`${c.checkpoint.label}: actual high-detail source section; training pending, no learned result yet. Surrounding finished PBR unchanged. Section uses direct lights only.`:`${c.checkpoint.label}: ${c.checkpoint.resolution}² fields, ${(c.checkpoint.bytes/1024).toFixed(1)} KiB, trained LOD 0. ${c.effective==='learned'?'Learned section':c.effective==='source'?'Source section':'Source shown outside the trained viewing hemisphere'}. Surrounding PBR unchanged. Section comparison uses direct lights only; no environment/indirect response. ${c.geometry}`;}}
    };
    function applyVisibility(){
      if(!candidate)return;
      effective=mode==='lod'?(projectedPixels===null||projectedPixels>threshold?'source':'support'):mode;
      sourceMesh.visible=effective==='source';group.visible=effective!=='source'&&effective!=='comparison';if(comparison){comparison.root.visible=effective==='comparison';comparison.set(comparison.read().requested,new Vector3().fromArray(session.readView().position));}
      patchMesh.visible=effective==='partition'||effective==='isolated';patchMesh.material=effective==='isolated'?sourceMesh.material:patchTint;for(const mesh of retainedMeshes)mesh.visible=effective!=='isolated';volumeMesh.visible=effective==='support';wire.visible=effective==='partition';boundaryWire.visible=effective==='partition';
      session.redraw();sync();
    }
    function measure(){
      if(!candidate||!asset)return;
      const view=session.readView();if(comparison){const before=comparison.read().effective;comparison.set(comparison.read().requested,new Vector3().fromArray(view.position));if(before!==comparison.read().effective){session.redraw();sync();}}sourceMesh.updateWorldMatrix(true,false);const projectionKey=JSON.stringify([view,sourceMesh.matrixWorld.elements,renderer.domElement.width,renderer.domElement.height,mode,threshold,recipe]);if(projectionKey===lastProjectionKey)return;lastProjectionKey=projectionKey;
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
        const boundaryGeometry=new BufferGeometry();boundaryGeometry.setAttribute('position',new BufferAttribute(Float32Array.from(c.boundarySegments.flatMap(e=>e.vertices.flatMap(v=>worldPoint(v.p,c.frame)))),3));const boundaryMaterial=new LineBasicMaterial({color:0xff66ab,depthTest:false,depthWrite:false});owned.push(boundaryGeometry,boundaryMaterial);const cutBoundary=new LineSegments(boundaryGeometry,boundaryMaterial);cutBoundary.renderOrder=2;cutBoundary.name='Source/support boundary (x-ray)';
        const untouchedMesh=new Mesh(untouched,sourceMesh.material),cutMesh=new Mesh(cut,sourceMesh.material),detail=new Mesh(patch,tint),volume=new Mesh(support,solid),outline=new LineSegments(edges,line);
        nextGroup.add(untouchedMesh,cutMesh,detail,volume,outline,cutBoundary);for(const m of [untouchedMesh,cutMesh,detail,volume]){m.castShadow=true;m.receiveShadow=true;}
        free();resources=owned;group=nextGroup;patchMesh=detail;patchTint=tint;retainedMeshes=[untouchedMesh,cutMesh];volumeMesh=volume;wire=outline;boundaryWire=cutBoundary;candidate=c;recipe=structuredClone(next);draftRecipe=structuredClone(recipe);sourceMesh.parent.add(group);pending=false;lastProjectionKey=null;measure();applyVisibility();publish();
        record({kind:'trellis-support.region',phase:'applied',target:asset.id,effective:read()});return read();
      }catch(e){if(request===generation){pending=false;error=e.message;sync();}throw e;}
    }
    const clearComparison=()=>{comparisonVersion++;comparison?.dispose();comparison=null;checkpointId=null;comparisonPending=false;if(mode==='comparison')mode='partition';};
    function frameRegion(){sourceMesh.updateWorldMatrix(true,false);const scale=mode==='comparison'&&comparison?comparison.read().tileSize/(2*recipe.radius):1,target=new Vector3().fromArray(recipe.origin).applyMatrix4(sourceMesh.matrixWorld),position=new Vector3().fromArray(worldPoint([3*scale,-3*scale,4.5*scale],candidate.frame)).applyMatrix4(sourceMesh.matrixWorld),size=recipe.radius*scale*sourceMesh.getWorldScale(new Vector3()).length();return session.setView({position:position.toArray(),target:target.toArray(),near:Math.max(size/10000,.00001)});}
    function addComparisonLight(){
      const app=host.controls.document.defaultView;if(!app.kaminosSceneAuthoring?.addLight||!app.kaminosSetSceneObjectTransform)throw Error('Native scene light editing is unavailable');
      const prior=app.kaminosSelection.read(),f=candidate.frame,target=new Vector3().fromArray(recipe.origin);sourceMesh.updateWorldMatrix(true,false);
      const position=target.clone().add(new Vector3().fromArray(f.u).multiplyScalar(-.5)).add(new Vector3().fromArray(f.v).multiplyScalar(.5)).add(new Vector3().fromArray(f.n).multiplyScalar(.8));sourceMesh.localToWorld(position);sourceMesh.localToWorld(target);
      const aim=new PerspectiveCamera();aim.position.copy(position);aim.lookAt(target);
      const id=app.kaminosSceneAuthoring.addLight();app.kaminosSceneAuthoring.setLight(id,{intensity:8,angle:65,penumbra:.3});app.kaminosSetSceneObjectTransform(id,{position:position.toArray(),rotation:[aim.rotation.x,aim.rotation.y,aim.rotation.z],scale:[1,1,1]});inspectionLight=id;inspectionLights.add(id);app.kaminosSelection.set(prior.ids,prior.activeId);record({kind:'trellis-support.light',phase:'applied',effective:{id,route:'native authored scene spot light; editable/removable/saveable'}});session.redraw();return read();
    }
    async function setCheckpoint(id){
      const entry=comparisonEntries.find(e=>e.id===id);if(!entry)throw Error('Unknown section checkpoint');
      const previousRegion=JSON.stringify(recipe),token=++comparisonVersion;comparisonPending=true;comparisonError=null;sync();let next;
      try{next=await createTrellisPatchComparison({device,source,sourceMesh,entry,contextSourceUrl:sourceUrl,contextHash:sourceDigest});if(disposed||token!==comparisonVersion){next.dispose();return read();}
        await rebuild(entry.region);if(disposed||token!==comparisonVersion){next.dispose();return read();}
        const requested=next.read().learnedAvailable?(comparison?.read().requested??inputs.comparison??'source'):'source';comparison?.dispose();comparison=next;comparison.setOutline(inputs.outline??true);checkpointId=id;comparison.set(requested,new Vector3().fromArray(session.readView().position));mode='comparison';if(previousRegion!==JSON.stringify(recipe))frameRegion();applyVisibility();publish();record({kind:'trellis-support.checkpoint',phase:'applied',effective:read().comparison});return read();
      }catch(e){next?.dispose();if(token===comparisonVersion)comparisonError=e.message;throw e;}finally{if(token===comparisonVersion){comparisonPending=false;sync();}}
    }
    async function load(url){
      if(typeof url!=='string'||!url.trim())throw Error('Source GLB URL required');
      const loadRequest=++loadGeneration,nextSession=await host.scene.open();let next,nextMaterial;
      try{
        next=await nextSession.loadAsset({url,normalize:false});const meshes=[];next.root.traverse(o=>{if(o.isMesh)meshes.push(o);});
        if(meshes.length!==1||Array.isArray(meshes[0].material)||!meshes[0].geometry.index)throw Error('First support constructor requires one indexed mesh with one material');
        if(disposed||loadRequest!==loadGeneration){await nextSession.dispose();return read();}
        const nextSource=supportSourceFromMesh(meshes[0]);
        const identityResponse=await fetch(url);if(!identityResponse.ok)throw Error('Source identity read failed');const identityBytes=await identityResponse.arrayBuffer(),identity=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',identityBytes)),x=>x.toString(16).padStart(2,'0')).join('');
        nextMaterial=createSourceMaterialSampler(renderer,meshes[0].material);
        const prepared=prepareSupportVolume(nextSource,recipe),clipped=await clipSupportVolume(device,prepared);
        if(disposed||loadRequest!==loadGeneration){nextMaterial.dispose();await nextSession.dispose();return read();}
        clearComparison();sourceDigest=identity;free();sourceMaterial?.dispose();sourceMaterial=nextMaterial;if(loadSession)await loadSession.dispose();loadSession=nextSession;asset=next;sourceMesh=meshes[0];sourceUrl=url;
        source=nextSource;await rebuild(recipe,{prepared,clipped});return read();
      }catch(e){if(loadSession!==nextSession){nextMaterial?.dispose();await nextSession.dispose();}throw e;}
    }
    async function probe(queries){
      const request=generation,token=++probeVersion,c=candidate,s=source,material=sourceMaterial;
      queries??=[-.65,0,.65].flatMap(u=>[-.65,0,.65].map(v=>({origin:worldPoint([u,v,c.hi[2]],c.frame),direction:c.frame.n.map(x=>-x)})));
      probePending=true;sync();
      try{
        const result=await traceSupportRays(device,c,queries,{twoSided:sourceMesh.material.side===2});if(disposed||request!==generation||token!==probeVersion){if(token===probeVersion)probePending=false;return read();}
        result.samples=result.samples.map(sample=>sample.hit?{...sample,...sampleSourceAddress(s,sample.sourceTriangle,sample.sourceBary)}:sample);
        const hits=result.samples.filter(s=>s.hit),labels=await material.sample(hits.map(s=>s.sourceUV));hits.forEach((s,i)=>s.material=labels[i]);
        if(disposed||request!==generation||token!==probeVersion){if(token===probeVersion){probePending=false;sync();}return read();}result.materialSampling=material.read();
        clearProbe(false);probeResult=result;const positions=[],colors=[];
        for(const sample of result.samples){if(!sample.intersectsSupport)continue;const end=sample.hit?sample.distance:sample.exit;for(const d of [sample.entry,end]){positions.push(...sample.origin.map((x,k)=>x+sample.direction[k]*d));colors.push(...(sample.hit?[.2,1,.4]:[1,.25,.25]));}}
        const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(Float32Array.from(positions),3));g.setAttribute('color',new BufferAttribute(Float32Array.from(colors),3));const m=new LineBasicMaterial({vertexColors:true,depthTest:false,depthWrite:false});probeResources=[g,m];probeLines=new LineSegments(g,m);probeLines.renderOrder=3;probeLines.name='Bounded source ray probes (x-ray)';group.add(probeLines);session.redraw();sync();record({kind:'trellis-support.probe',phase:'applied',target:asset.id,effective:probeResult});return read();
      }catch(e){if(request===generation&&token===probeVersion){probePending=false;error=e.message;sync();}throw e;}
    }
    async function probeLighting({lightDirection,bounces=1}={}){
      await probe();if(!probeResult||disposed)return read();const request=generation,token=++lightingVersion,c=candidate,s=source,m=sourceMaterial;
      const queries=probeResult.samples.map(q=>({origin:q.origin,direction:q.direction}));lightingPending=true;sync();
      try{
        const result=await evaluateSourceRegionLighting(device,{source:s,candidate:c,binding:m.binding(),queries,side:sourceMesh.material.side,lightDirection:lightDirection??c.frame.n,bounces});
        if(!disposed&&request===generation&&token===lightingVersion)lightingResult=result;
      }finally{if(token===lightingVersion){lightingPending=false;sync();}}return read();
    }
    try{await load(sourceUrl);}catch(e){sourceMaterial?.dispose();await loadSession?.dispose();await session.dispose();restoreLod();throw e;}
    if(comparisonEntries.length&&sourceUrl===DEFAULT_SOURCE){try{await setCheckpoint(inputs.checkpoint??comparisonEntries[0].id);}catch(e){comparisonError=e.message;sync();}}
    if(comparison&&inputs.inspectionLight!==false&&!host.scene.objects().some(o=>o.type==='light'))addComparisonLight();
    if(inputs.frame==='region')frameRegion();
    const stop=session.onFrame(()=>measure());
    return {
      read,
      operations:{
        setRegion:next=>{clearComparison();return rebuild({...recipe,...next});},load,probe,setCheckpoint,addComparisonLight,setOutline(value){if(!comparison)throw Error('Choose a checkpoint first');comparison.setOutline(value);session.redraw();sync();publish();return read();},
        setComparison(value){if(!comparison)throw Error('Choose a source-linked section checkpoint first');comparison.set(value,new Vector3().fromArray(session.readView().position));mode='comparison';applyVisibility();publish();record({kind:'trellis-support.comparison',phase:'applied',effective:read().comparison});return read();},
        selectExample(name){if(sourceUrl!==DEFAULT_SOURCE||!Object.hasOwn(PLATE_REGIONS,name))throw Error('Choose a named example on the finished plate source');clearComparison();return rebuild(structuredClone(PLATE_REGIONS[name]));},
        setMode(value){if(!MODES.includes(value))throw Error('Unknown support display mode');if(value==='comparison'&&!comparison)throw Error('Choose a source-linked checkpoint first');if(comparisonPending){comparisonVersion++;comparisonPending=false;}mode=value;measure();applyVisibility();publish();return read();},
        setThreshold(value){if(!Number.isFinite(value)||value<=0)throw Error('positive LOD threshold required');threshold=value;measure();applyVisibility();publish();return read();},
        frame(){const box=new Box3().setFromObject(asset.root),target=box.getCenter(new Vector3()),size=box.getSize(new Vector3()).length();return session.setView({position:target.clone().add(new Vector3(size*1.1,size*.8,size*1.25)).toArray(),target:target.toArray(),near:Math.max(size/10000,.0001)});},
        frameRegion,
        probeLighting,
        inspectCandidate(){sourceMesh.updateWorldMatrix(true,false);group.updateWorldMatrix(true,false);return {state:read(),patch:candidate.patch,retained:candidate.retained,boundarySegments:candidate.boundarySegments,untouched:Array.from(candidate.untouched),frame:candidate.frame,lo:candidate.lo,hi:candidate.hi,transforms:{sourceWorld:sourceMesh.matrixWorld.elements,partitionWorld:group.matrixWorld.elements,sourceParentVisible:sourceMesh.parent.visible,sourceVisible:sourceMesh.visible,partitionVisible:group.visible,patchVisible:patchMesh.visible,wireVisible:wire.visible,partitionParent:group.parent.name,sourceParent:sourceMesh.parent.name}};},
      },
      mount({root:panel,document,invoke}){
        panel.dataset.trellisSupportControls='true';const description=document.createElement('p');description.textContent='Compare the learned square in its original place, with surrounding PBR unchanged. Checkpoints and section appearance are direct choices. Geometry diagnostics remain below.';panel.append(description);
        const heading=text=>{const h=document.createElement('div');h.textContent=text;h.style.marginTop='10px';h.style.fontWeight='600';panel.append(h);};
        heading('Section checkpoint');checkpointChoices=createChoiceButtons(document,{label:'Section checkpoint',entries:comparisonEntries.map(e=>[e.id,e.label]),onChange:value=>invoke('setCheckpoint',value).catch(e=>{comparisonError=e.message;sync();})});panel.append(checkpointChoices);
        heading('Section appearance');comparisonChoices=createChoiceButtons(document,{label:'Section appearance',entries:[['source','Source section'],['learned','Learned section']],onChange:value=>invoke('setComparison',value).catch(e=>{comparisonError=e.message;sync();})});panel.append(comparisonChoices);outlineButton=document.createElement('button');outlineButton.textContent='Section outline';outlineButton.addEventListener('click',()=>invoke('setOutline',!comparison.read().outline).catch(e=>{comparisonError=e.message;sync();}));panel.append(outlineButton);const lightButton=document.createElement('button');lightButton.textContent='Add comparison light';lightButton.addEventListener('click',()=>invoke('addComparisonLight').catch(e=>{comparisonError=e.message;sync();}));panel.append(lightButton);
        const row=(text,node)=>{const label=document.createElement('label'),grip=document.createElement('span');grip.textContent=text+' ';label.append(grip,node);panel.append(label);return grip;};
        selector=createChoiceButtons(document,{label:'Display',entries:[['partition','Region + outline'],['isolated','Isolated source'],['source','Original source'],['support','Support diagnostic'],['lod','LOD preview'],['comparison','Section comparison']],onChange:value=>invoke('setMode',value).catch(failed)});heading('Geometry display');panel.append(selector);
        exampleSelector=createChoiceButtons(document,{label:'Plate region example',entries:[['panel','Panel patch'],['rim','Rolled edge'],['custom','Custom region',true]],onChange:value=>invoke('selectExample',value).catch(failed)});heading('Source region');panel.append(exampleSelector);
        let timer;const failed=e=>{error=e.message;draftRecipe=structuredClone(recipe);sync();};
        for(const[k,label,step]of [['origin0','Region X',.005],['origin1','Region Y',.005],['origin2','Region Z',.005],['radius','Half width',.005],['depth','Inward depth',.005],['top','Outward extent',.005],['threshold','LOD switch footprint (pixels)',10]]){
          const field=document.createElement('input');field.type='number';field.step='any';field.className='transform-input';field.setAttribute('aria-label',label);const grip=row(label,field);fields.set(k,field);host.controls.installNumberDrag({input:field,grip,step});
          field.addEventListener('input',()=>{if(!field.value.trim()||!Number.isFinite(Number(field.value)))return;const value=Number(field.value);if(k==='threshold'){invoke('setThreshold',value).catch(failed);return;}draftRecipe=k.startsWith('origin')?{...draftRecipe,origin:draftRecipe.origin.map((x,i)=>i===Number(k.at(-1))?value:x)}:{...draftRecipe,[k]:value};clearTimeout(timer);const next=structuredClone(draftRecipe);timer=setTimeout(()=>invoke('setRegion',next).catch(failed),150);});
        }
        const sourceInput=document.createElement('input');sourceInput.type='text';sourceInput.value=sourceUrl;sourceInput.setAttribute('aria-label','Source GLB URL');row('Source GLB',sourceInput);
        const loadButton=document.createElement('button');loadButton.textContent='Load source';loadButton.addEventListener('click',()=>invoke('load',sourceInput.value).catch(failed));
        const frame=document.createElement('button');frame.textContent='Frame asset';frame.addEventListener('click',()=>invoke('frame').catch(failed));const close=document.createElement('button');close.textContent='Frame region';close.addEventListener('click',()=>invoke('frameRegion').catch(failed));const probeButton=document.createElement('button');probeButton.textContent='Probe region';probeButton.addEventListener('click',()=>invoke('probe').catch(failed));status=document.createElement('p');status.setAttribute('role','status');const lightingButton=document.createElement('button');lightingButton.textContent='Probe normal lighting';lightingButton.addEventListener('click',()=>invoke('probeLighting').catch(failed));panel.append(loadButton,frame,close,probeButton,lightingButton,status);sync();
        return ()=>clearTimeout(timer);
      },
      async dispose(){disposed=true;generation++;loadGeneration++;clearComparison();stop();const app=host.controls.document.defaultView,owned=host.scene.objects().filter(o=>inspectionLights.has(o.id)).map(o=>o.id);if(owned.length){const prior=app.kaminosSelection.read();app.kaminosSelection.set(owned,owned[0]);await app.kaminosSelection.remove();const live=new Set(host.scene.objects().map(o=>o.id)),ids=prior.ids.filter(id=>live.has(id));app.kaminosSelection.set(ids,ids.includes(prior.activeId)?prior.activeId:ids[0]??null);}if(sourceMesh)sourceMesh.visible=true;free();sourceMaterial?.dispose();try{await loadSession?.dispose();await session.dispose();}finally{restoreLod();}},
    };
  },
};
