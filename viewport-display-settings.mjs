export const DEFAULT_VIEWPORT_DISPLAY=Object.freeze({overlays:true,gizmos:true,outlines:true,bounds:false,helpers:true,domains:true,emitters:true,hints:true,outlineWidth:1.5,outlineOpacity:1,domainWidth:1,domainOpacity:.82,emitterWidth:1,emitterOpacity:.55,shading:'solid'});
export const VIEWPORT_SHADING_MODES=Object.freeze(['solid','wireframe']);
export function checkedViewportDisplay(value={}) {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid viewport display');
 const result={...DEFAULT_VIEWPORT_DISPLAY,...value};
 for(const key of ['overlays','gizmos','outlines','bounds','helpers','domains','emitters','hints'])if(typeof result[key]!=='boolean')throw Error(`Invalid viewport ${key}`);
 for(const key of ['outlineWidth','domainWidth','emitterWidth'])if(!Number.isFinite(result[key])||result[key]<=0)throw Error(`Invalid viewport line width ${key}`);
 for(const key of ['outlineOpacity','domainOpacity','emitterOpacity'])if(!Number.isFinite(result[key])||result[key]<0||result[key]>1)throw Error(`Invalid viewport opacity ${key}`);
 if(!VIEWPORT_SHADING_MODES.includes(result.shading))throw Error('Invalid viewport shading');
 return result;
}
export function viewportShortcut(event) {
 if(event.repeat||event.defaultPrevented)return null;
 if(event.code==='KeyZ'&&event.shiftKey&&event.altKey&&!event.ctrlKey&&!event.metaKey)return 'overlays';
 if(event.code==='KeyZ'&&event.shiftKey&&!event.altKey&&!event.ctrlKey&&!event.metaKey)return 'shading';
 if(event.code==='Backquote'&&(event.ctrlKey||event.metaKey)&&!event.shiftKey&&!event.altKey)return 'gizmos';
 return null;
}
