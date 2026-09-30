import * as THREE from './lib/three.webgpu.js';
import {cloneSceneRadianceMaterial} from './scene-radiance.mjs';
import {collectStaticSceneGeometry,staticSceneGeometryRevision} from './scene-light-geometry.mjs';
import {buildTriangleVisibility} from './scene-light-visibility.mjs';
import {createVolumeGather} from './scene-volume-gather.mjs';

export function mountDistributedSceneRadiance({renderer,scene,prototype,device,directions=24,volumeGrid=16}) {
  let gain=1,handle=null,revision=null,frame=null,external=null,disposed=false;
  const originals=new Map();
  const status={identity:'distributed-volume-direct-radiance-v0',status:'awaiting-source',directions,volumeGrid,
    source:'actual-material-emission-extinction',coordinates:'identity-world-and-volume-local',
    limitations:['vertex-surface-receivers','nearest-smoke-receivers','no-surface-bounce','independent-consumer-display']};
  function retire() {
    prototype.setSceneDistributedLightFrame(null);
    for(const [mesh,row] of originals) {
      mesh.material=row.material;mesh.geometry=row.geometry;
      for(const m of Array.isArray(row.converted)?row.converted:[row.converted])m?.dispose();
      row.clone.dispose();
    }
    originals.clear();
    if(external){delete renderer.backend.get(external).texture;external.dispose();external=null;}
    handle?.destroy();handle=null;
  }
  function build() {
    retire();status.status='building-static-visibility';
    const geometry=collectStaticSceneGeometry(scene);
    const packed=buildTriangleVisibility(geometry.triangles).packGpu();
    const receivers=[];
    const position=new THREE.Vector3(),normal=new THREE.Vector3(),normalMatrix=new THREE.Matrix3();
    scene.traverseVisible(mesh=>{
      if(!mesh.isMesh)return;
      const materialList=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      if(!materialList.every(m=>m.isMeshStandardMaterial||m.isMeshStandardNodeMaterial||m.isMeshPhysicalMaterial||m.isMeshPhysicalNodeMaterial))return;
      if(mesh.isSkinnedMesh||mesh.isInstancedMesh||Object.values(mesh.geometry.morphAttributes).some(a=>a.length))throw new Error('distributed first pass requires static surface receivers');
      const geometry=mesh.geometry,vertices=geometry.attributes.position,normals=geometry.attributes.normal;
      if(!normals)throw new Error(`distributed surface normal missing: ${mesh.name}`);
      const ids=new Float32Array(vertices.count);
      normalMatrix.getNormalMatrix(mesh.matrixWorld);
      for(let i=0;i<vertices.count;i++) {
        position.fromBufferAttribute(vertices,i).applyMatrix4(mesh.matrixWorld);
        normal.fromBufferAttribute(normals,i).applyMatrix3(normalMatrix).normalize();
        ids[i]=receivers.length;receivers.push({position:position.toArray(),normal:normal.toArray()});
      }
      const clone=geometry.clone();clone.setAttribute('sceneReceiverIndex',new THREE.BufferAttribute(ids,1));
      originals.set(mesh,{material:mesh.material,geometry,clone});mesh.geometry=clone;
    });
    handle=createVolumeGather(device,{geometry:packed,receivers,volumeGrid,directions});
    external=new THREE.ExternalTexture(handle.surface);
    external.image={width:handle.surfaceDimensions[0],height:handle.surfaceDimensions[1]};
    external.format=THREE.RGBAFormat;external.type=THREE.FloatType;external.colorSpace=THREE.NoColorSpace;
    external.minFilter=external.magFilter=THREE.NearestFilter;external.generateMipmaps=false;
    const {attribute,textureLoad,ivec2,varying}=THREE.TSL;
    const id=attribute('sceneReceiverIndex','float');
    const irradiance=varying(textureLoad(external,ivec2(id.mod(handle.surfaceDimensions[0]),id.div(handle.surfaceDimensions[0]).floor())).rgb,'distributedSurfaceIrradiance');
    for(const [mesh,row] of originals) {
      const convert=original=>{
        const material=cloneSceneRadianceMaterial(renderer.library,original);
        const setup=material.setupMaterialLightings;
        material.setupMaterialLightings=function(builder){return [...setup.call(this,builder),new THREE.IrradianceNode(irradiance)];};
        return material;
      };
      row.converted=Array.isArray(row.material)?row.material.map(convert):convert(row.material);
      mesh.material=row.converted;
    }
    // Revision includes our current attribute/material identities; a changed
    // caster or transform rebuilds distances before another lighting update.
    revision=staticSceneGeometryRevision(scene);
    status.staticTriangles=packed.triangleCount;status.surfaceReceivers=receivers.length;
  }
  function prepare(field) {
    if(disposed)throw new Error('distributed lighting disposed');
    if(!handle||staticSceneGeometryRevision(scene)!==revision)build();
    frame=handle.encode(field.source,{gain});
    prototype.setSceneDistributedLightFrame({texture:handle.smoke,...frame});
    status.status='submitted-awaiting-presentation';
  }
  prototype.setSceneMediumSource(null);
  prototype.setSceneSourceFrameConsumer(prepare);
  return {
    setGain(value){if(!Number.isFinite(value)||value<0)throw new Error('nonnegative light gain required');gain=value;},
    setDirections(value){lightingCount(value);directions=value;status.directions=value;revision=null;},
    debugState(){return {...status,gain,frame,display:'mesh and flame retain separate camera transforms'};},
    readback(){if(!handle)throw new Error('distributed receivers not built');return handle.readback();},
    canRender(){return !disposed&&handle&&frame?.generation===prototype.sceneVolumeSourceField().generation;},
    dispose(){disposed=true;prototype.setSceneSourceFrameConsumer(null);retire();},
  };
}
function lightingCount(value){if(!Number.isInteger(value)||value<2||value%2)throw new Error('even angular sample count required');}
