// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {raymarchDomainBox} from '../volume-grid-shape.mjs';
import {composeVolumePresentationTransform} from '../volume-presentation-frame.mjs';
import * as sourceModule from '../scene-volume-source.mjs';
const core=fs.readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const page=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('inactive point medium and atlas cannot advertise retained textures as live',()=>{
 const start=core.indexOf('  function fireIrradianceLightField()'),end=core.indexOf('\n  async function ',start);
 const context={state:{active:false,fireLightFieldEffective:true},fireLightFieldRequested:()=>true,
  irradianceGridSize:4,FIRE_IRRADIANCE_ATLAS_TILES_X:8,gridSize:32,gridHeight:64,raymarchDomainBox,
  presentationWorldTransform:()=>({translate:[0,0,0],scale:1}),gridHeightForSize:g=>2*g,
  FIRE_IRRADIANCE_ATLAS_IDENTITY:'atlas',FIRE_IRRADIANCE_LATTICE_IDENTITY:'lattice',FIRE_IRRADIANCE_PROPAGATION_IDENTITY:'propagation',
  gpuInitialized:true,device:{},configuredSharedGpuContext:null,irradianceAtlasGeneration:1,irradianceAtlasTexture:{cached:true},irradianceMetaTexture:{cached:true}};
 vm.createContext(context);vm.runInContext(core.slice(start,end),context);
 assert.equal(vm.runInContext('fireIrradianceLightField().status',context),'inactive');
 const method=core.slice(core.indexOf('    sceneMediumOpticalDepthField()'),core.indexOf('    async sampleSceneMediumOpticalDepth()'));
 context.sceneVolumeSource={opticalDepthField:()=>({status:'encoded',texture:{cached:true},generation:2})};
 const runtime=vm.runInContext(`({${method}})`,context);
 assert.equal(runtime.sceneMediumOpticalDepthField().status,'inactive');
 context.state.active=true;
 assert.equal(vm.runInContext('fireIrradianceLightField().status',context),'effective');
 assert.equal(runtime.sceneMediumOpticalDepthField().status,'encoded');
});
test('receiver updates world bounds even when the same atlas allocation is retained',()=>{
 const start=page.indexOf('    update() {',page.indexOf('function createFireLightFieldReceiverPass'));
 const body=page.slice(start,page.indexOf('\n    setWitnessMute(',start));
 const device={},field={status:'effective',identity:'atlas',device,atlasTexture:{},generation:1,atlasWidth:16,atlasHeight:32,grid:4,worldMin:[2,3,4],worldMax:[4,7,6]};
 const vector=()=>({value:{values:null,set(...v){this.values=v;},copy(){}}});
 const context={camera:{updateMatrixWorld(){},projectionMatrixInverse:{},matrixWorld:{}},sceneProjectionMatrixInverse:vector(),sceneCameraWorldMatrix:vector(),
  volumePrototype:{fireIrradianceLightField:()=>field},passState:{adoptionKey:'1:16x32',baseStrength:1},sharedGpu:{device},FIRE_LIGHT_FIELD_ATLAS_IDENTITY:'atlas',
  fireLightFieldStrength:{value:0},fieldWorldMin:vector(),fieldWorldMax:vector(),fieldCellPitch:{value:0},bindBlackAtlas(){throw Error('unexpected unavailable atlas');}};
 const receiver=vm.runInNewContext(`({${body}})`,context);
 assert.equal(receiver.update(),true);
 assert.deepEqual(context.fieldWorldMin.value.values,[2,3,4]);
 assert.deepEqual(context.fieldWorldMax.value.values,[4,7,6]);
 assert.equal(context.fieldCellPitch.value,.5);
 field.worldMin=[-1,-2,-3];field.worldMax=[0,0,-2];receiver.update();
 assert.deepEqual(context.fieldWorldMin.value.values,[-1,-2,-3]);assert.equal(context.fieldCellPitch.value,.25);
});
test('outer and intermediate collider calls compose the same presentation parent',()=>{
 const presentation={translate:[3,-2,7],scale:.0494},anchor={translate:[.4,-.3,.2],scale:2};
 for(const [name,factor] of [['worldSolidProducer',3],['intermediateSolidProducer',1.5]]){
  const start=core.indexOf(`const produced=${name}.update(`),call=core.slice(start,core.indexOf(';',start)+1);
  let observed;const context={source:{objects:[{id:'box'}]},a:anchor,p:{min:[-1.5],flowDims:[8,16]},plan:{flowDims:[8,16]},controlsSnapshot:{worldSmokeExtent:3},gpuThermalConsumer:null,
   presentationTransform:presentation,composeVolumePresentationTransform,[name]:{update(_objects,frame){observed=frame;return {};}}};
  vm.runInNewContext(call,context);
  assert.deepEqual(structuredClone(observed),composeVolumePresentationTransform({translate:anchor.translate,scale:anchor.scale*factor},presentation));
 }
});
test('authored source quadrature retains physical rather than displayed-world coordinates',()=>{
 assert.equal(typeof sourceModule.sceneSourceAuthoringTransform,'function','source field must name its independent authoring frame');
 const physical={translate:[.4,-.3,.2],scale:2},world={translate:[3,-2,7],scale:.0494};
 assert.deepEqual(sourceModule.sceneSourceAuthoringTransform({physicalTransform:physical,worldTransform:world}),physical);
 assert.deepEqual(sourceModule.sceneSourceAuthoringTransform({worldTransform:world}),world,'older producers retain their existing coordinates');
 assert.throws(()=>sourceModule.sceneSourceAuthoringTransform({physicalTransform:{translate:[0,0,0],scale:0},worldTransform:world}),/positive/);
});
