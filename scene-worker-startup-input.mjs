import {checkedPreferences,resolveStartupSceneDefaults} from './user-preferences.mjs';

// Choosing an execution owner is not an authored scene input. Use the same
// preference precedence on either route; this prepares data, it applies nothing.
export function resolveSceneWorkerStartupInput({preferences=null,location,admission=null}={}){
 const href=typeof location==='string'?location:location?.href;
 if(typeof href!=='string'||!href)throw Error('Scene worker startup requires its page location');
 const url=new URL(href,'http://localhost');
 if(url.searchParams.getAll('scene_worker').some(value=>value!=='1'))throw Error('Scene worker selector must select the worker route');
 url.searchParams.delete('scene_worker');
 const accepted=preferences===null?null:checkedPreferences(preferences);
 const startupDefaults=resolveStartupSceneDefaults(accepted,url.href);
 const camera=admission?.data!=null?admission.data.camera??null:startupDefaults.defaults?.camera??null;
 return {preferences:accepted,startupDefaults,camera:structuredClone(camera)};
}
