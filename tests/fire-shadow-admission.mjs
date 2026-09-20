import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../lib/three.webgpu.js';
import {createFireLightFieldShadow} from '../fire-light-field-shadow.mjs';

// Real bundled material/scene classes and production pass logic; only GPU draw
// submission is stubbed. This tests admission, not rendered shadow fidelity.
const originalUpdate=THREE.CubeCamera.prototype.update;
THREE.CubeCamera.prototype.update=function(){};
const renderer=new Proxy({
  getClearColor:color=>color,getDrawingBufferSize(){throw new Error('diagnostic-renderer-reached');},
},{get:(object,key)=>key in object?object[key]:()=>null});
const scene=new THREE.Scene();
const caster=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());
caster.castShadow=true;scene.add(caster);
const makeShadow=()=>createFireLightFieldShadow({renderer,scene,sourceNode:THREE.TSL.vec3(0),receiverNode:THREE.TSL.vec3(0),normalNode:THREE.TSL.vec3(0,1,0),requested:true});

try {
  if(process.argv[2]==='casters') {
    const unsupported=[
      new THREE.MeshPhysicalMaterial({transmission:1}),
      Object.assign(new THREE.MeshPhysicalNodeMaterial(),{transmissionNode:THREE.TSL.float(1)}),
      Object.assign(new THREE.MeshBasicNodeMaterial(),{backdropNode:THREE.TSL.vec3(1)}),
      new THREE.MeshBasicMaterial({alphaHash:true}),
      Object.assign(new THREE.MeshBasicNodeMaterial(),{alphaTestNode:THREE.TSL.float(.5)}),
      new THREE.MeshBasicMaterial({opacity:.5}),
      Object.assign(new THREE.MeshBasicMaterial(),{visible:false}),
    ];
    for(const material of unsupported) {
      caster.material=material;
      const shadow=makeShadow();
      assert.throws(()=>shadow.render('generation-1'),/fire-shadow-unsupported-caster/,
        `must reject ${material.type}: transmission=${material.transmission}, alphaHash=${material.alphaHash}`);
      assert.equal(shadow.debugState().effective,false);
      shadow.dispose();material.dispose();
    }
    for(const side of [THREE.FrontSide,THREE.BackSide,THREE.DoubleSide]) {
      caster.material=[new THREE.MeshBasicMaterial({side}),new THREE.MeshPhysicalMaterial({side})];
      const shadow=makeShadow();shadow.render('generation-1');
      assert.equal(shadow.debugState().effective,true);
      shadow.dispose();caster.material.forEach(m=>m.dispose());
    }
    console.log('opaque caster admission follows bundled transmission and cutout semantics');
  } else {
    const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
    const body=source.slice(source.indexOf('  const passState = {\n    identity: FIRE_LIGHT_FIELD_PASS_IDENTITY'),source.indexOf('\nasync function initScene()'));
    assert.ok(body.length>0);
    const device={};
    const baseline={status:'effective',identity:'atlas',generation:1,device,atlasTexture:{},metaTexture:{},atlasWidth:32,atlasHeight:32,metaWidth:2,metaHeight:1,grid:32,tilesX:8};
    let field=baseline;
    const shadow=makeShadow();
    const uniforms=()=>({value:{copy(){},set(){}}});
    const bindings={THREE,FIRE_LIGHT_FIELD_PASS_IDENTITY:'pass',FIRE_LIGHT_FIELD_MASK_AUTHORITY:'depth',FIRE_LIGHT_FIELD_ATLAS_IDENTITY:'atlas',
      isFireLightFieldIsolateRoute:()=>false,routeParams:{},baseStrength:1,baseBounceStrength:1,outputNode:{},fireShadow:shadow,
      fireBounce:{render(){},setEnabled(){},debugState:()=>({}),dispose(){}},sceneMutationToken:1,
      bouncePatchCount:8,bounceReservedSamplerCount:8,
      camera:{updateMatrixWorld(){},position:new THREE.Vector3(),projectionMatrixInverse:{},matrixWorld:{}},
      sceneProjectionMatrixInverse:uniforms(),sceneCameraWorldMatrix:uniforms(),atlasTextureNode:uniforms(),metaTextureNode:uniforms(),
      atlasExternalTexture:{},fireLightFieldStrength:uniforms(),bounceStrength:{value:1},atlasGrid:uniforms(),atlasTilesX:uniforms(),atlasTexelSize:uniforms(),isolateMix:uniforms(),
      sharedGpu:{device},volumePrototype:{fireIrradianceLightField:()=>field},blackAtlasTexture:{}};
    const pass=new Function(...Object.keys(bindings),body.slice(0,body.lastIndexOf('}')))(...Object.values(bindings));
    const render=()=>{pass.update();pass.renderShadows();assert.equal(pass.debugState().shadow.effective,true);};
    for(const invalid of [null,{...baseline,identity:'wrong'},{...baseline,device:{}},{...baseline,atlasTexture:null},{...baseline,metaTexture:null}]) {
      field=baseline;render();field=invalid;pass.update();
      assert.equal(pass.debugState().shadow.effective,false,'parent invalidation must immediately invalidate child shadow');
      await assert.rejects(()=>pass.diagnoseShadows([{x:0,y:0}]),/shadow-not-effective/);
    }
    field=baseline;render();
    for(const replacement of [{...baseline,generation:2},{...baseline,atlasTexture:{}},{...baseline,metaTexture:{}}]) {
      field=replacement;pass.update();
      assert.equal(pass.debugState().shadow.effective,false,'source adoption must await a new cube render');
      await assert.rejects(()=>pass.diagnoseShadows([{x:0,y:0}]),/shadow-not-effective/);
      pass.renderShadows();assert.equal(pass.debugState().shadow.effective,true);
      assert.ok(pass.debugState().shadow.sourceIdentity,'render must receipt adopted source identity');
      await assert.rejects(()=>pass.diagnoseShadows([{x:0,y:0}]),/diagnostic-renderer-reached/);
    }
    pass.setShadowsEnabled(false);assert.equal(pass.debugState().shadow.effective,false);
    pass.setShadowsEnabled(true);assert.equal(pass.debugState().shadow.effective,false);
    render();field=null; // diagnose must poll the live producer, not just cached parent status
    await assert.rejects(()=>pass.diagnoseShadows([{x:0,y:0}]),/shadow-not-effective/);
    field=baseline;render();
    const pending=pass.diagnoseShadows([{x:0,y:0}]);
    field={...baseline,generation:3};
    await assert.rejects(()=>pending,/shadow-not-effective/,'adoption during async diagnostic admission invalidates the read');
    pass.dispose();
    console.log('shadow diagnostics reject invalid/replaced source until fresh cube render');
  }
} finally {THREE.CubeCamera.prototype.update=originalUpdate;caster.geometry.dispose();}
