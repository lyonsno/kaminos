import {createSceneRenderer} from './scene-render-bootstrap.mjs';
import {createSceneLightingGraph} from './scene-lighting-graph.mjs';

// Retain this shell before initialization. Device acquisition belongs to the
// application; this owner releases only its renderer, PMREM and lighting graph.
export function createSceneRenderResources({THREE,scene,camera,canvas,readViewport,readSharedGpu,
 readRendererOptions=()=>({}),readLightingOptions,onConstructed=()=>{}}){
 if(typeof readViewport!=='function'||typeof readSharedGpu!=='function'||typeof readLightingOptions!=='function')throw Error('Scene render resources require live viewport/device/lighting readers');
 let renderer=null,pmremGenerator=null,rendererRuntime=null,lighting=null,previous=null,rendererReady=false;
 const retained=[];
 const current=ctx=>{if(typeof ctx?.assertCurrent!=='function')throw Error('Scene render resources require assertCurrent');ctx.assertCurrent();};
 const resources=()=>({scene,camera,renderer,pmremGenerator,lighting});
 function remember(){
  const size=renderer.getSize(new THREE.Vector2());
  previous={canvas:renderer.domElement,viewport:{width:size.x,height:size.y,pixelRatio:renderer.getPixelRatio()},
   toneMapping:renderer.toneMapping,exposure:renderer.toneMappingExposure,
   shadowEnabled:renderer.shadowMap.enabled,shadowType:renderer.shadowMap.type,outputColorSpace:renderer.outputColorSpace};
 }
 async function buildRenderer(ctx,{sharedGpu,restore=null}={}){
  current(ctx);
  const options=readRendererOptions();
  try{
   const built=await createSceneRenderer({...options,THREE,scene,camera,
    sharedGpu:sharedGpu??readSharedGpu(),canvas:restore?.canvas??canvas,
    viewport:restore?.viewport??readViewport(),...(restore?{exposure:restore.exposure,allowIndependentDevice:false}:{}),
    onConstructed(value){
     renderer=value;
     if(restore){
      value.toneMapping=restore.toneMapping;value.shadowMap.enabled=restore.shadowEnabled;
      value.shadowMap.type=restore.shadowType;value.outputColorSpace=restore.outputColorSpace;
     }
     onConstructed(value,{replacement:!!restore});
    }});
   rendererRuntime=built;renderer=built.renderer;pmremGenerator=built.pmremGenerator;rendererReady=true;
   current(ctx);return resources();
  }catch(error){
   // The bootstrap disposes its own failed constructor. Preserve a handle
   // only when its cleanup failed, or initialization completed before staleness.
   if(!rendererReady&&!error.cleanupError)renderer=null;
   throw error;
  }
 }
 async function retireRenderer(){
  if(pmremGenerator){await pmremGenerator.dispose();pmremGenerator=null;}
  if(renderer){await renderer.dispose();renderer=null;}
  rendererReady=false;rendererRuntime=null;
 }
 async function retireLighting(){
  while(retained.length){
   const resource=retained.at(-1);await resource.dispose?.();retained.pop();
  }
  lighting=null;
 }
 const shell={
  get renderer(){return renderer;},get pmremGenerator(){return pmremGenerator;},get lighting(){return lighting;},
  read:resources,
  async initializeRenderer(ctx){
   current(ctx);if(renderer||pmremGenerator||rendererRuntime)throw Error('Scene renderer resources already retained');
   return buildRenderer(ctx);
  },
  initializeLighting(ctx){
   current(ctx);if(!rendererReady)throw Error('Scene renderer must initialize before lighting');
   if(lighting||retained.length)throw Error('Scene lighting resources already retained');
   lighting=createSceneLightingGraph({...readLightingOptions(),THREE,scene,camera,renderer,
    retain(resource){if(resource&&!retained.includes(resource))retained.push(resource);}});
   current(ctx);return lighting;
  },
  async initialize(ctx){await shell.initializeRenderer(ctx);shell.initializeLighting(ctx);return resources();},
  async replaceRenderer(sharedGpu,ctx){
   current(ctx);if(!sharedGpu?.device)throw Error('Renderer replacement requires the supplied shared device');
   if(rendererReady)remember();
   if(!previous)throw Error('No initialized scene renderer to replace');
   await retireRenderer();current(ctx);
   await buildRenderer(ctx,{sharedGpu,restore:previous});current(ctx);
   lighting?.setRenderer(renderer);return resources();
  },
  resize(){if(!rendererReady)throw Error('Scene renderer resources are not initialized');const viewport=rendererRuntime.resize(readViewport());lighting?.resizeDepth();return viewport;},
  retireRenderer,
  async retire(){await retireLighting();await retireRenderer();},
 };
 return shell;
}
