// The legacy page stays canonical in its inert template. Choosing the worker
// route must happen before the browser parses or imports that module graph.
export async function startScenePage({document=globalThis.document,location=globalThis.location,
 loadWorker=()=>import('./scene-worker-page-entry.mjs')}={}){
 const address=new URL(location.href);
 if(address.searchParams.get('scene_worker')==='1'){
  const entry=await loadWorker();return entry.startSceneWorkerPage();
 }
 const source=document.getElementById('kaminos-legacy-page-module')?.content?.querySelector('script[type="module"]');
 if(!source?.textContent)throw Error('The ordinary page module is unavailable');
 const script=document.createElement('script');script.type='module';script.textContent=source.textContent;
 document.body.appendChild(script);return {route:'legacy'};
}
