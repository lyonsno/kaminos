// Presentation belongs to the host. The volume runtime uses a real canvas and
// plain viewport measurements; it does not own DOM mounting or CSS.
export function createBrowserVolumeSurface({viewport,identity,routeIdentity,canvasId='kaminos-volume-canvas',mount=true}) {
  const document=viewport?.ownerDocument??globalThis.document;
  const canvas=document.createElement('canvas');
  canvas.id=canvasId;
  canvas.dataset.prototype=identity;
  canvas.dataset.routeIdentity=routeIdentity;
  if(mount)viewport.appendChild(canvas);
  return {
    canvas,
    viewport(){
      const rect=viewport.getBoundingClientRect(),win=viewport.ownerDocument?.defaultView??globalThis;
      return {left:rect.left,top:rect.top,width:rect.width,height:rect.height,
        fallbackWidth:Math.max(1,Math.floor((win.innerWidth||1280)-Math.max(0,rect.left||0))),
        fallbackHeight:Math.max(1,Math.floor(win.innerHeight||720)),pixelRatio:Number.isFinite(Number(win.devicePixelRatio))&&Number(win.devicePixelRatio)>0?Number(win.devicePixelRatio):1};
    },
    bounds:()=>canvas.getBoundingClientRect(),
    resize(width,height){canvas.width=width;canvas.height=height;canvas.style.width='100%';canvas.style.height='100%';canvas.style.imageRendering='auto';},
    setActive(active){canvas.classList.toggle('active',active);},
    setTransparent(value){canvas.style.background=value?'transparent':'';},
    dispose(){canvas.remove();},
  };
}

// An OffscreenCanvas is supplied by the worker owner. Measurements and visible
// state updates come from that owner's scene facade, without a DOM imitation.
export function createOffscreenVolumeSurface({canvas,readViewport,onActive=()=>{},onTransparent=()=>{},onDispose=()=>{}}) {
  if(!canvas||typeof canvas.getContext!=='function'||typeof readViewport!=='function')throw Error('offscreen volume surface requires canvas and viewport reader');
  function viewport(){
    const value=readViewport();
    if(!value||![value.width,value.height].every(x=>Number.isFinite(x)&&x>=0)
      ||['left','top'].some(key=>value[key]!==undefined&&!Number.isFinite(value[key]))
      ||['fallbackWidth','fallbackHeight','pixelRatio'].some(key=>value[key]!==undefined&&(!Number.isFinite(value[key])||value[key]<=0)))throw Error('invalid offscreen viewport: finite dimensions and positive pixel ratio required');
    return {...value,left:value.left??0,top:value.top??0,pixelRatio:value.pixelRatio??1,
      fallbackWidth:value.fallbackWidth??Math.max(1,value.width),fallbackHeight:value.fallbackHeight??Math.max(1,value.height)};
  }
  return {
    canvas,
    viewport,
    bounds:()=>{const v=viewport();return {left:v.left,top:v.top,width:v.width,height:v.height};},
    resize(width,height){canvas.width=width;canvas.height=height;},
    setActive:onActive,
    setTransparent:onTransparent,
    dispose:onDispose,
  };
}

// Ray statistics keep their counters and display draw on the same GPU. Only
// visibility and font-canvas creation differ between page and worker hosts.
export function createBrowserRayStepDisplay({canvas,document=canvas.ownerDocument??globalThis.document}) {
  return {canvas,isVisible:()=>canvas.getClientRects().length>0,
    setActive:active=>{canvas.style.visibility=active?'visible':'hidden';},
    createFontCanvas(width,height){const bitmap=document.createElement('canvas');bitmap.width=width;bitmap.height=height;return bitmap;},
  };
}

export function createOffscreenRayStepDisplay({canvas,readVisible,onActive=()=>{},createFontCanvas=(width,height)=>new OffscreenCanvas(width,height)}) {
  if(!canvas||typeof canvas.getContext!=='function'||typeof readVisible!=='function')throw Error('offscreen ray display requires canvas and visibility reader');
  return {canvas,isVisible:readVisible,setActive:onActive,createFontCanvas};
}
