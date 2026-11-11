// The actual default hybrid/distributed radiance mount shared by page and worker.
// UI, accepted source state, preparation holds and GPU resources remain caller-owned.
const loadRadianceModule=route=>route==='hybrid'?import('./scene-hybrid-radiance.mjs'):
  route==='distributed'?import('./scene-distributed-radiance.mjs'):import('./scene-radiance.mjs');
export async function mountSceneRadianceResources({params,readResources,loadModule=loadRadianceModule,...resources}){
  if(params.get('volume_light_field')!=='1')throw Error('shared scene source requires ordinary fire light-field route');
  const distributed=params.get('volume_light_field_distributed')==='1';
  const hybrid=distributed&&params.get('volume_light_field_hybrid')==='1';
  const module=await loadModule(hybrid?'hybrid':distributed?'distributed':'point');
  // A module import can yield while the scene is replaced. Read its resources
  // at the same point as the original page mount, after the import settles.
  const {renderer,scene,prototype,device,surfaceLighting,shadowSettings,rebuild,
    readSourceRecords,readControls,getSourceGuide,onStatus}=readResources?readResources():resources;
  return distributed?module.mountDistributedSceneRadiance({renderer,scene,prototype,device,
    ...(hybrid?{surfaceLighting,...shadowSettings,rebuild,smokeRefinement:Number(params.get('volume_light_field_hybrid_smoke_refinement')??4)}:{}),
    getSourceRegions:(transform,domain)=>module.authoredSourceRegions(readSourceRecords(),{transform,domain,controls:readControls()}),
    getSourceGuide,onStatus}):module.mountSceneRadiance({renderer,scene,prototype});
}
