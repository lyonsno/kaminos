const decoders=new WeakMap();
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
