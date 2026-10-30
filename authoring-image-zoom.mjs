// Image-only navigation: trackpad pinch / Ctrl-wheel zoom, drag or scroll to pan,
// and touch pinch. Never changes the selected source or prepared mesh input.
export function installImageZoom({frame,targets,resetButton,peers=[]}){
  let scale=1,x=0,y=0,gestureScale=1,drag=null;
  const pointers=new Map();
  function paint(){
    const r=frame.getBoundingClientRect();
    x=Math.max(-r.width*(scale-1)/2,Math.min(r.width*(scale-1)/2,x));
    y=Math.max(-r.height*(scale-1)/2,Math.min(r.height*(scale-1)/2,y));
    for(const t of targets)t.style.transform=`translate(${x}px,${y}px) scale(${scale})`;
    frame.dataset.zoomed=String(scale>1);resetButton.hidden=scale===1;
    resetButton.textContent=`Fit image · ${Math.round(scale*100)}%`;
  }
  function zoom(next,cx,cy,surface=frame){
    if(!Number.isFinite(next))return;
    next=Math.max(1,next);const r=surface.getBoundingClientRect(),px=cx-r.left-r.width/2,py=cy-r.top-r.height/2;
    x=px-(px-x)*next/scale;y=py-(py-y)*next/scale;scale=next;paint();
  }
  const reset=()=>{scale=1;x=y=0;paint();};resetButton.onclick=reset;
  for(const surface of [frame,...peers]){
  surface.addEventListener('wheel',e=>{
    if(e.ctrlKey||e.metaKey){e.preventDefault();e.stopPropagation();zoom(scale*Math.exp(-e.deltaY*.01),e.clientX,e.clientY,surface);}
    else if(scale>1){e.preventDefault();e.stopPropagation();x-=e.deltaX;y-=e.deltaY;paint();}
  },{passive:false});
  surface.addEventListener('gesturestart',e=>{e.preventDefault();gestureScale=scale;},{passive:false});
  surface.addEventListener('gesturechange',e=>{e.preventDefault();zoom(gestureScale*e.scale,e.clientX,e.clientY,surface);},{passive:false});
  surface.addEventListener('gestureend',e=>e.preventDefault(),{passive:false});
  const pair=()=>{const [a,b]=[...pointers.values()];return b?{distance:Math.hypot(b.x-a.x,b.y-a.y),x:(a.x+b.x)/2,y:(a.y+b.y)/2}:null;};
  surface.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    surface.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY};
    if(scale>1||e.pointerType==='touch'){e.preventDefault();e.stopPropagation();}
  });
  surface.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId))return;const before=pair();
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const after=pair();
    if(before&&after&&before.distance>0)zoom(scale*after.distance/before.distance,after.x,after.y,surface);
    else if(drag&&scale>1){x+=e.clientX-drag.x;y+=e.clientY-drag.y;paint();}
    drag={x:e.clientX,y:e.clientY};
  });
  const release=e=>{pointers.delete(e.pointerId);drag=null;};
  surface.addEventListener('pointerup',release);surface.addEventListener('pointercancel',release);surface.addEventListener('lostpointercapture',release);
  surface.addEventListener('dblclick',e=>{e.preventDefault();reset();});
  }
  for(const t of targets)t.draggable=false;
  frame.title='Pinch to zoom · drag to pan · double-click to fit';
  return {reset,read:()=>({scale,x,y})};
}
