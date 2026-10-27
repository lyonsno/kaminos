import {KTX2Loader} from './lib/addons/loaders/KTX2Loader.js';
import {prepareKtx2Texture} from './asset-texture-support.mjs';

export class AssetKTX2Loader extends KTX2Loader{
  _createTextureFrom(result,container){
    return prepareKtx2Texture(super._createTextureFrom(result,container));
  }
}
