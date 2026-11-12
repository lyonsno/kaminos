import {GLTFLoader as ThreeGLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {AssetKTX2Loader} from './asset-ktx2-loader.mjs';
import {configureAssetTextures} from './asset-texture-support.mjs';
import {surfaceFieldMaterialsGLTFPlugin} from './surface-field-material.mjs';
import {surfaceSplatsGLTFPlugin} from './surface-splat-object.mjs';
import {trellisSurfelsGLTFPlugin} from './trellis-surfels.mjs';

// Same ordinary asset parser on the page and inside the scene worker. A live
// reader uses the current renderer after recovery, preserving its decoder pool.
export function createSceneGltfLoaderClass({THREE,readRenderer}){
 if(!THREE||typeof readRenderer!=='function')throw Error('Scene GLTF loader requires its Three namespace and live renderer reader');
 return class SceneGLTFLoader extends ThreeGLTFLoader{
  constructor(manager){
   super(manager);
   this.register(trellisSurfelsGLTFPlugin(THREE));
   this.register(surfaceFieldMaterialsGLTFPlugin);this.register(surfaceSplatsGLTFPlugin);
   configureAssetTextures(this,readRenderer(),()=>new AssetKTX2Loader(manager));
  }
 };
}
