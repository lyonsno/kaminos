import * as THREE from './lib/three.webgpu.js';
import {cloneSceneRadianceMaterial} from './scene-radiance.mjs';
import {collectStaticSceneGeometry,staticSceneGeometryRevision} from './scene-light-geometry.mjs';
import {buildTriangleVisibility} from './scene-light-visibility.mjs';
import {createVolumeGather} from './scene-volume-gather.mjs';
import {validateSourceSoftness} from './scene-source-softening.mjs';
import {validateSurfaceReconstruction} from './scene-surface-reconstruction.mjs';
import {validateSceneSourceTransform,sceneSourceLocalPoint} from './scene-volume-source.mjs';
import {surfaceReceiverLayout,validateReceiverSpacing} from './scene-surface-receivers.mjs';

export function mountDistributedSceneRadiance({renderer,scene,prototype,device,directions=24,volumeGrid=16,onStatus=()=>{}}) {
  let gain=1,smokeMode='distributed',sourceSoftness=0,handle=null,revision=null,frame=null,external=null,externalBack=null,disposed=false;
  const originals=new Map();
  const editing=new Set();let editCommitted=false,rebuildAnnounced=false,retainComparisons=false;
  let angularPattern='fixed',angularRotation=0;
  let surfaceReconstruction=0;
  let surfaceScattering=false;
  let receiverSpacing=0,builtReceiverSpacing=null,packedCache=null;
  const surfaceGain=THREE.TSL.uniform(1);
  let sourceTransform=validateSceneSourceTransform();
  const attributeIds=new WeakMap();let nextAttributeId=0;
  const attributeId=a=>{if(!a)return null;if(!attributeIds.has(a))attributeIds.set(a,++nextAttributeId);return attributeIds.get(a);};
  const status={identity:'distributed-volume-direct-radiance-v0',status:'awaiting-source',directions,volumeGrid,
    source:'actual-material-emission-extinction',coordinates:'volume-local-length-with-source-world-translation-and-uniform-scale',
    previewStale:false,geometryBuilds:0,visibilityBuilds:0,lastGeometryBuildMs:null,
    limitations:['vertex-surface-receivers','prepared-smoke-zero-at-solid-cells','static-geometry-rebuild-on-committed-edit','no-surface-bounce','independent-consumer-display']};
  function retire() {
    prototype.setSceneDistributedLightFrame(null);
    const uses=new Map();
    for(const row of originals.values())for(const resource of [row.geometry,...(Array.isArray(row.material)?row.material:[row.material])])uses.set(resource,(uses.get(resource)||0)+1);
    for(const [mesh,row] of originals) {
      // Restore only our installed substitutions, carrying intervening edits
      // back to their authored inputs. Never overwrite an external replacement.
      if(mesh.geometry===row.clone) {
        // Divergent per-mesh edits cannot be restored into one shared input.
        const authored=uses.get(row.geometry)>1?row.geometry.clone():row.geometry;
        authored.copy(row.clone);
        if(row.receiverAttribute)authored.setAttribute('sceneReceiverIndex',row.receiverAttribute);
        else authored.deleteAttribute('sceneReceiverIndex');
        if(row.receiverWeightAttribute)authored.setAttribute('sceneReceiverWeight',row.receiverWeightAttribute);
        else authored.deleteAttribute('sceneReceiverWeight');
        mesh.geometry=authored;
      }
      if(mesh.material===row.converted) {
        const authored=Array.isArray(row.material)?[...row.material]:[row.material];
        const installed=Array.isArray(row.converted)?row.converted:[row.converted];
        for(let i=0;i<authored.length;i++) {
          if(installed[i]!==row.ownedMaterials[i]){authored[i]=installed[i];continue;}
          if(uses.get(authored[i])>1)authored[i]=authored[i].clone();
          authored[i].copy(installed[i]);
          const Type=authored[i].isMeshPhysicalMaterial||authored[i].isMeshPhysicalNodeMaterial?THREE.MeshPhysicalMaterial:THREE.MeshStandardMaterial;
          Type.prototype.copy.call(authored[i],installed[i]);
          authored[i].needsUpdate=true;
        }
        mesh.material=Array.isArray(row.material)?authored:authored[0];
      }
      for(const m of row.ownedMaterials||[])m.dispose();
      row.clone.dispose();
    }
    originals.clear();
    if(external){delete renderer.backend.get(external).texture;external.dispose();external=null;}
    if(externalBack){delete renderer.backend.get(externalBack).texture;externalBack.dispose();externalBack=null;}
    handle?.destroy();handle=null;
  }
  function build(rebuildGeometry=true) {
    const started=performance.now();
    retire();status.status='building-static-visibility';
    if(rebuildGeometry||!packedCache){
      const geometry=collectStaticSceneGeometry(scene);
      for(const triangle of geometry.triangles)for(const key of ['a','b','c'])triangle[key]=sceneSourceLocalPoint(triangle[key],sourceTransform);
      packedCache=buildTriangleVisibility(geometry.triangles).packGpu();status.visibilityBuilds++;
    }
    const packed=packedCache;
    const receivers=[],surfaceTriangles=[];
    let renderVertices=0;
    const position=new THREE.Vector3(),normal=new THREE.Vector3(),normalMatrix=new THREE.Matrix3();
    scene.traverseVisible(mesh=>{
      if(!mesh.isMesh)return;
      const materialList=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      if(!materialList.every(m=>m.isMeshStandardMaterial||m.isMeshStandardNodeMaterial||m.isMeshPhysicalMaterial||m.isMeshPhysicalNodeMaterial))return;
      if(mesh.isSkinnedMesh||mesh.isInstancedMesh||Object.values(mesh.geometry.morphAttributes).some(a=>a.length))throw new Error('distributed first pass requires static surface receivers');
      const geometry=mesh.geometry,vertices=geometry.attributes.position,normals=geometry.attributes.normal;
      if(!normals)throw new Error(`distributed surface normal missing: ${mesh.name}`);
      const offset=receivers.length;
      const input=[];
      normalMatrix.getNormalMatrix(mesh.matrixWorld);
      for(let i=0;i<vertices.count;i++) {
        position.fromBufferAttribute(vertices,i).applyMatrix4(mesh.matrixWorld);
        normal.fromBufferAttribute(normals,i).applyMatrix3(normalMatrix).normalize();
        input.push({position:sceneSourceLocalPoint(position.toArray(),sourceTransform),normal:normal.toArray(),twoSided:materialList.some(m=>m.side!==THREE.FrontSide)});
      }
      const index=geometry.index;
      const triangles=new Uint32Array(index?index.count:vertices.count);
      for(let i=0;i<triangles.length;i++)triangles[i]=index?index.getX(i):i;
      let regions=[];
      if(materialList.length>1){
        const membership=Array.from({length:vertices.count},()=>new Set());
        for(const g of geometry.groups)for(let i=g.start;i<g.start+g.count;i++)membership[triangles[i]].add(g.materialIndex);
        regions=membership.map(s=>[...s].sort((a,b)=>a-b).join(','));
      }
      const layout=surfaceReceiverLayout(input,triangles,{spacing:receiverSpacing,regions});
      for(const receiver of layout.receivers)receivers.push(receiver);renderVertices+=vertices.count;
      for(const id of layout.triangles)surfaceTriangles.push(offset+id);
      const clone=geometry.clone();
      const ids=receiverSpacing?Float32Array.from(layout.indices,id=>id+offset):Float32Array.from(input,(_,i)=>offset+i);
      clone.setAttribute('sceneReceiverIndex',new THREE.BufferAttribute(ids,receiverSpacing?4:1));
      if(receiverSpacing)clone.setAttribute('sceneReceiverWeight',new THREE.BufferAttribute(layout.weights,4));
      originals.set(mesh,{material:mesh.material,geometry,clone,layout,receiverOffset:offset,receiverAttribute:geometry.getAttribute('sceneReceiverIndex'),receiverWeightAttribute:geometry.getAttribute('sceneReceiverWeight')});mesh.geometry=clone;
    });
    handle=createVolumeGather(device,{geometry:packed,receivers,surfaceTriangles:new Uint32Array(surfaceTriangles),volumeGrid,directions,angularPattern,angularRotation});
    handle.setRetainComparisons(retainComparisons);
    external=new THREE.ExternalTexture(handle.surface);
    external.image={width:handle.surfaceDimensions[0],height:handle.surfaceDimensions[1]};
    external.format=THREE.RGBAFormat;external.type=THREE.FloatType;external.colorSpace=THREE.NoColorSpace;
    external.minFilter=external.magFilter=THREE.NearestFilter;external.generateMipmaps=false;
    externalBack=new THREE.ExternalTexture(handle.surfaceBack);
    externalBack.image={...external.image};externalBack.format=external.format;externalBack.type=external.type;externalBack.colorSpace=external.colorSpace;
    externalBack.minFilter=externalBack.magFilter=THREE.NearestFilter;externalBack.generateMipmaps=false;
    const {attribute,textureLoad,ivec2,varying,transformNormalToView,positionViewDirection}=THREE.TSL;
    const at=(t,id)=>textureLoad(t,ivec2(id.mod(handle.surfaceDimensions[0]),id.div(handle.surfaceDimensions[0]).floor())).rgb;
    const lookup=t=>{
      if(!receiverSpacing)return at(t,attribute('sceneReceiverIndex','float'));
      const ids=attribute('sceneReceiverIndex','vec4'),w=attribute('sceneReceiverWeight','vec4');
      return at(t,ids.x).mul(w.x).add(at(t,ids.y).mul(w.y)).add(at(t,ids.z).mul(w.z)).add(at(t,ids.w).mul(w.w));
    };
    const irradiance=varying(lookup(external),'distributedSurfaceIrradiance');
    const backIrradiance=varying(lookup(externalBack),'distributedBackSurfaceIrradiance');
    // Choose the camera-facing normal hemisphere, independently of winding.
    // This retains two opaque sides even for inconsistent generated winding;
    // front/back radiance is never added together. Normal maps remain material
    // detail rather than changing the cached receiving hemisphere.
    const receivingNormal=varying(transformNormalToView(attribute('normal','vec3')),'distributedReceivingNormal');
    const visibleIrradiance=receivingNormal.dot(positionViewDirection).greaterThanEqual(0).select(irradiance,backIrradiance);
    for(const [mesh,row] of originals) {
      const convert=original=>{
        const material=cloneSceneRadianceMaterial(renderer.library,original);
        const setup=material.setupMaterialLightings;
        const received=original.side===THREE.DoubleSide?visibleIrradiance:original.side===THREE.BackSide?backIrradiance:irradiance;
        material.setupMaterialLightings=function(builder){return [...setup.call(this,builder),new THREE.IrradianceNode(received.mul(surfaceGain))];};
        return material;
      };
      row.converted=Array.isArray(row.material)?row.material.map(convert):convert(row.material);
      row.ownedMaterials=Array.isArray(row.converted)?[...row.converted]:[row.converted];
      mesh.material=row.converted;
    }
    revision=receiverRevision();
    status.staticTriangles=packed.triangleCount;status.surfaceReceivers=receivers.length;
    status.renderVertices=renderVertices;status.receiverSampling={identity:receiverSpacing?'connected-cell-normal-band-v1':'vertex-reference-v1',spacing:receiverSpacing,renderVertices,receivers:receivers.length,stencilWidth:receiverSpacing?4:1};
    builtReceiverSpacing=receiverSpacing;
    status.geometryBuilds++;status.lastGeometryBuildMs=performance.now()-started;
  }
  function receiverRevision() {
    const solid=staticSceneGeometryRevision(scene);
    const rows=[];
    scene.traverseVisible(mesh=>{
      if(!mesh.isMesh)return;
      const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      if(!materials.every(m=>m?.isMeshStandardMaterial||m?.isMeshStandardNodeMaterial||m?.isMeshPhysicalMaterial||m?.isMeshPhysicalNodeMaterial))return;
      const g=mesh.geometry,p=g.attributes.position,n=g.attributes.normal;
      rows.push([mesh.uuid,mesh.matrixWorld.elements,g.uuid,attributeId(p),p?.version,p?.count,attributeId(n),n?.version,n?.count,
        attributeId(g.index),g.index?.version,materials.map(m=>[m.uuid,m.version,m.side])]);
    });
    return JSON.stringify([sourceTransform,solid,rows]);
  }
  function prepare(field) {
    if(disposed)throw new Error('distributed lighting disposed');
    sourceTransform=validateSceneSourceTransform(field.source.worldTransform);
    const geometryChanged=!handle||receiverRevision()!==revision;
    const changed=geometryChanged||receiverSpacing!==builtReceiverSpacing;
    status.previewStale=changed;
    if(changed&&editing.size) {
      status.status='editing-stale-preview';
    } else if(changed&&editCommitted&&!rebuildAnnounced) {
      // Let the browser present status before the synchronous CPU preparation.
      status.status='rebuild-pending';rebuildAnnounced=true;
    } else if(changed) {
      status.status='building-static-visibility';onStatus({...status});
      try{build(geometryChanged);}catch(error){status.status='rebuild-failed';status.error=String(error.message);onStatus({...status});throw error;}
      status.previewStale=false;delete status.error;editCommitted=false;rebuildAnnounced=false;
    } else {editCommitted=false;rebuildAnnounced=false;}
    if(!handle){onStatus({...status});return;}
    try {
      handle.setDirections(directions);
      handle.setAngularPattern(angularPattern,angularRotation);
      frame=handle.encode(field.source,{gain,smokeEnabled:smokeMode==='distributed',sourceSoftness,surfaceReconstruction,surfaceScattering});
    } catch(error) {
      status.status='preparation-failed';status.error=String(error.message);
      onStatus({...status});throw error;
    }
    delete status.error;
    frame.previewStale=status.previewStale;
    frame.receiverSampling={...status.receiverSampling};
    prototype.setSceneDistributedLightFrame(smokeMode==='distributed'?{texture:handle.smoke,...frame}:null);
    if(!status.previewStale)status.status='submitted-awaiting-presentation';
    onStatus({...status});
  }
  prototype.setSceneMediumSource(null);
  prototype.setSceneSourceFrameConsumer(prepare);
  return {
    setGain(value){if(!Number.isFinite(value)||value<0)throw new Error('nonnegative light gain required');gain=value;},
    setSurfaceGain(value){if(!Number.isFinite(value)||value<0)throw new Error('nonnegative surface gain required');surfaceGain.value=value;},
    setSurfaceScattering(value){surfaceScattering=!!value;},
    setSmokeMode(value){if(!['distributed','legacy'].includes(value))throw new Error('unknown smoke illumination mode');smokeMode=value;},
    setSourceSoftness(value){sourceSoftness=validateSourceSoftness(value);},
    setSurfaceReconstruction(value){surfaceReconstruction=validateSurfaceReconstruction(value);},
    setReceiverSpacing(value){value=validateReceiverSpacing(value);if(value!==receiverSpacing){receiverSpacing=value;editCommitted=true;rebuildAnnounced=false;}},
    setDirections(value){lightingCount(value);directions=value;status.directions=value;},
    setAngularPattern(pattern,rotation=0){if(!['fixed','spatial','source'].includes(pattern)||!Number.isFinite(rotation))throw new Error('valid angular pattern and finite rotation required');angularPattern=pattern;angularRotation=rotation;},
    setRetainComparisons(value){retainComparisons=!!value;handle?.setRetainComparisons(retainComparisons);},
    setEditing(key,active){if(active){editing.add(key);rebuildAnnounced=false;}else if(editing.delete(key)&&!editing.size)editCommitted=true;},
    debugState(){return {...status,gain,receiverSpacingRequested:receiverSpacing,sourceTransform:validateSceneSourceTransform(sourceTransform),surfaceGain:surfaceGain.value,surfaceScattering,smokeMode,sourceSoftness,surfaceReconstruction,frame,display:'mesh and flame retain separate camera transforms'};},
    readback(){if(!handle)throw new Error('distributed receivers not built');return handle.readback();},
    canRender(){return !disposed&&!status.error&&handle&&frame?.generation===prototype.sceneVolumeSourceField().generation;},
    dispose(){disposed=true;prototype.setSceneSourceFrameConsumer(null);retire();},
  };
}
function lightingCount(value){if(!Number.isInteger(value)||value<2||value%2)throw new Error('even angular sample count required');}
