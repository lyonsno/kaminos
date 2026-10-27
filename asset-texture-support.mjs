import {DataTexture,RGBAFormat} from './lib/three.core.js';
const decoders=new WeakMap();
// KTX2's no-compression transcode still returns a CompressedTexture. The
// WebGPU backend selects upload code by texture class, so use a DataTexture
// for the decoded RGBA pixels while preserving their authored mip chain.
export function prepareKtx2Texture(texture){
  if(!texture.isCompressedTexture||texture.format!==RGBAFormat||texture.isCubeTexture||texture.isCompressedArrayTexture)return texture;
  const mipmaps=texture.mipmaps;
  const decoded=new DataTexture().copy(texture);
  decoded.image={data:mipmaps[0].data,width:mipmaps[0].width,height:mipmaps[0].height};
  decoded.mipmaps=mipmaps;
  decoded.needsUpdate=true;
  return decoded;
}
export function configureAssetTextures(loader,renderer,createCompressionLoader){
  if(!renderer)throw Error('Asset textures require an initialized renderer');
  let decoder=decoders.get(renderer);
  if(!decoder){
    decoder=createCompressionLoader().setTranscoderPath(new URL('./lib/addons/libs/basis/',import.meta.url).href);
    decoder.detectSupport(renderer);
    decoders.set(renderer,decoder);
  }
  loader.setKTX2Loader(decoder);
  return loader;
}
