// Initial lattice only: no simulation readback, particle history or frame loop.
export function initialSupportSlice(sampling,selected=null) {
 const {blockSamples:n,spacing:s,supportRadius:h}=sampling;
 if(!Number.isSafeInteger(n)||n<1||!Number.isFinite(s)||s<=0||!Number.isFinite(h)||h<=0)throw Error('Initial sampling unavailable');
 const center=selected??[Math.floor((n-1)/2),Math.floor((n-1)/2)];
 if(center.length!==2||center.some(v=>!Number.isInteger(v)||v<0||v>=n))throw Error('Selected initial particle outside block');
 const z=Math.floor((n-1)/2),radius=Math.ceil(h/s);let neighbors=0;
 for(let dz=-radius;dz<=radius;dz++)for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
  if(dx===0&&dy===0&&dz===0)continue;
  if(center[0]+dx<0||center[0]+dx>=n||center[1]+dy<0||center[1]+dy>=n||z+dz<0||z+dz>=n)continue;
  if((dx*dx+dy*dy+dz*dz)*s*s<h*h)neighbors++;
 }
 return {center,z,neighbors,weight:(x,y)=>Math.max(0,1-((x-center[0])**2+(y-center[1])**2)*s*s/(h*h))**3};
}
export function mountInitialSamplingPreview({document,root}) {
 const node=document.createElement('figure');node.style.cssText='margin:12px 0';
 const canvas=document.createElement('canvas');canvas.width=640;canvas.height=500;canvas.style.cssText='width:100%;height:auto;display:block;border:1px solid #435963;border-radius:4px';canvas.setAttribute('aria-label','Initial block cross-section with selectable particle and density support radius');
 const caption=document.createElement('figcaption');caption.style.cssText='font:11px/1.5 system-ui;color:#adc3cd';node.append(canvas,caption);root.append(node);
 let current=null,selected=null,projection=null;
 const draw=sampling=>{
  if(current?.blockSamples!==sampling.blockSamples)selected=null;
  current=sampling;const slice=initialSupportSlice(sampling,selected),ctx=canvas.getContext('2d');if(!ctx)throw Error('Sampling preview canvas unavailable');
  const width=sampling.blockSamples*sampling.spacing,extent=width+2*sampling.supportRadius,scale=450/extent,offset=(640-width*scale)/2,top=(500-width*scale)/2;
  projection={offset,top,scale};ctx.clearRect(0,0,640,500);ctx.fillStyle='#101b24';ctx.fillRect(0,0,640,500);ctx.strokeStyle='#546b79';ctx.strokeRect(offset,top,width*scale,width*scale);
  for(let y=0;y<sampling.blockSamples;y++)for(let x=0;x<sampling.blockSamples;x++){
   const w=slice.weight(x,y);ctx.fillStyle=w>0?`rgba(${Math.round(40+215*w)},${Math.round(170-40*w)},${Math.round(220-170*w)},${.30+.65*w})`:'rgba(120,169,190,.30)';
   ctx.beginPath();ctx.arc(offset+(x+.5)*sampling.spacing*scale,top+(y+.5)*sampling.spacing*scale,sampling.collisionRadius*scale,0,2*Math.PI);ctx.fill();
  }
  const px=offset+(slice.center[0]+.5)*sampling.spacing*scale,py=top+(slice.center[1]+.5)*sampling.spacing*scale;
  ctx.strokeStyle='#ffdb74';ctx.lineWidth=3;ctx.beginPath();ctx.arc(px,py,sampling.supportRadius*scale,0,2*Math.PI);ctx.stroke();ctx.fillStyle='#fff7df';ctx.beginPath();ctx.arc(px,py,Math.max(3,sampling.collisionRadius*scale*.4),0,2*Math.PI);ctx.fill();
  caption.textContent=`Initial center slice: ${sampling.blockSamples} × ${sampling.blockSamples} dots; ${sampling.particleCount.toLocaleString()} particles total. Click a dot to inspect. Gold circle: density support h=${sampling.supportRadius.toPrecision(4)}; ${slice.neighbors} other block particles inside its 3D support (puddle excluded). Warm colors show relative poly6 weight in this slice, blue is outside support. Dot size represents collision radius; this is not the evolving water or its reconstructed surface.`;
 };
 canvas.onclick=event=>{if(!current||!projection)return;const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)*640/rect.width,y=(event.clientY-rect.top)*500/rect.height;const p=[Math.floor((x-projection.offset)/(current.spacing*projection.scale)),Math.floor((y-projection.top)/(current.spacing*projection.scale))];if(p.every(v=>v>=0&&v<current.blockSamples)){selected=p;draw(current);}};
 return {draw,invalid(message){current=null;projection=null;canvas.getContext('2d')?.clearRect(0,0,640,500);caption.textContent='Proposed geometry unavailable: '+message;},dispose(){canvas.onclick=null;node.remove();}};
}
