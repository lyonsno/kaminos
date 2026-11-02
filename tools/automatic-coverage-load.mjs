// Shared by the browser witness and its observed-route regression.
export function coverageSceneUrl(savedUrl, origin) {
 const url=new URL(savedUrl,origin);
 const hash=new URLSearchParams(url.hash.slice(1));
 hash.set('workspace','workbench');hash.set('experiment','material-hierarchy');
 hash.set('experiment_inputs',JSON.stringify({overlay:true}));url.hash=hash.toString();
 return url.href;
}
export function coverageSceneLoaded() {
 const entryError=document.querySelector('#status.failed');
 if(entryError)throw new Error(entryError.textContent);
 const state=window.__kaminosVolumePrototype?.debugState();
 if(state?.error)throw new Error(state.error);
 return state?.simStepCount>=15&&window.kaminosWorkbenchExperiments?.state().id==='material-hierarchy';
}
