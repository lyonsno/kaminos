// Runtime presentation belongs to an authored object, without entering its
// serialization or changing transform/history ownership.
const surfaces=new WeakMap();
export const presentedSurface=source=>surfaces.get(source)??null;
export function registerPresentedSurface(source,surface){
 if(!source?.isObject3D||!surface?.mesh?.isMesh||typeof surface.pick!=='function')throw Error('Presented surface requires an authored object, mesh and picker');
 surfaces.set(source,surface);
 return ()=>{if(surfaces.get(source)===surface)surfaces.delete(source);};
}
