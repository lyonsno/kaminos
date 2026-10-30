// The public accessor is installed before sharedGpu/compositionHost are initialized.
export async function awaitAppGpu(getHost,tick=()=>new Promise(resolve=>requestAnimationFrame(resolve))){
 for(;;){const host=await getHost();if(host?.device){if(!host.frameOwner())throw Error('shared app frame owner unavailable');return host;}await tick();}
}
