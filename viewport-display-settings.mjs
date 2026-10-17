export const DEFAULT_VIEWPORT_DISPLAY=Object.freeze({overlays:true,gizmos:true,outlines:true,bounds:false,helpers:true,bones:true,paths:false,zones:true,domains:true,emitters:true,hints:true,outlineWidth:1.5,outlineOpacity:1,domainWidth:1,domainOpacity:.82,emitterWidth:1,emitterOpacity:.55,shading:'solid',water:'full',fire:'full',quality:'full'});
export const VIEWPORT_SHADING_MODES=Object.freeze(['solid','wireframe']);
export const VIEWPORT_WATER_DISPLAYS=Object.freeze(['full','proxy']);
export const VIEWPORT_FIRE_DISPLAYS=Object.freeze(['full','proxy']);
export const VIEWPORT_QUALITY_MODES=Object.freeze(['full','preview']);
// Each viewport toolbar renders its own instance; index.html syncs pressed state.
export const VIEWPORT_WATER_TOGGLE_HTML='<div class="viewport-shading viewport-water" role="group" aria-label="Water display" title="Water: full render or surfel proxy"><button type="button" data-water="full" aria-pressed="true">Water</button><button type="button" data-water="proxy" aria-pressed="false">Proxy</button></div>';
export const VIEWPORT_FIRE_TOGGLE_HTML='<div class="viewport-shading viewport-fire" role="group" aria-label="Fire display" title="Fire: full render or splat proxy"><button type="button" data-fire="full" aria-pressed="true">Fire</button><button type="button" data-fire="proxy" aria-pressed="false">Proxy</button></div>';
export const VIEWPORT_QUALITY_TOGGLE_HTML='<div class="viewport-shading viewport-quality" role="group" aria-label="Viewport quality" title="Preview: lighter fire raymarch and scene resolution, same simulation"><button type="button" data-quality="full" aria-pressed="true">Full</button><button type="button" data-quality="preview" aria-pressed="false">Preview</button></div>';
export const VIEWPORT_SHADING_TOGGLE_HTML='<div class="viewport-shading" role="group" aria-label="Viewport shading" title="Toggle wireframe (Shift Z)"><button type="button" data-shading="solid" aria-pressed="true">Solid</button><button type="button" data-shading="wireframe" aria-pressed="false">Wire</button></div>';
export function checkedViewportDisplay(value={}) {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid viewport display');
 const result={...DEFAULT_VIEWPORT_DISPLAY,...value};
 for(const key of ['overlays','gizmos','outlines','bounds','helpers','bones','paths','zones','domains','emitters','hints'])if(typeof result[key]!=='boolean')throw Error(`Invalid viewport ${key}`);
 for(const key of ['outlineWidth','domainWidth','emitterWidth'])if(!Number.isFinite(result[key])||result[key]<=0)throw Error(`Invalid viewport line width ${key}`);
 for(const key of ['outlineOpacity','domainOpacity','emitterOpacity'])if(!Number.isFinite(result[key])||result[key]<0||result[key]>1)throw Error(`Invalid viewport opacity ${key}`);
 if(!VIEWPORT_SHADING_MODES.includes(result.shading))throw Error('Invalid viewport shading');
 if(!VIEWPORT_WATER_DISPLAYS.includes(result.water))throw Error('Invalid viewport water display');
 if(!VIEWPORT_FIRE_DISPLAYS.includes(result.fire))throw Error('Invalid viewport fire display');
 if(!VIEWPORT_QUALITY_MODES.includes(result.quality))throw Error('Invalid viewport quality');
 return result;
}
// Explicit editor helpers only: never toggle the creature, actual Bone tree,
// scene root or authored geometry. Traverse hidden nodes so re-enabling works.
export function syncSceneHelperVisibility(roots,display,suspended=false) {
 for(const root of roots)root.traverse(node=>{
  const kind=node.userData?.kaminosHelperKind;if(!['bones','paths','zones'].includes(kind))return;
  node.visible=!suspended&&display.overlays&&display.helpers&&display[kind]&&node.userData.kaminosHelperEnabled!==false;
 });
}
export function viewportShortcut(event) {
 if(event.repeat||event.defaultPrevented)return null;
 if(event.code==='KeyZ'&&event.shiftKey&&event.altKey&&!event.ctrlKey&&!event.metaKey)return 'overlays';
 if(event.code==='KeyZ'&&event.shiftKey&&!event.altKey&&!event.ctrlKey&&!event.metaKey)return 'shading';
 if(event.code==='Backquote'&&(event.ctrlKey||event.metaKey)&&!event.shiftKey&&!event.altKey)return 'gizmos';
 return null;
}
