import {ShapePath,ExtrudeGeometry} from './lib/three.core.js';

// Trace the rendered type, including counters, into a shallow solid. The thermal
// and lighting consumers see glyph geometry rather than an alpha rectangle.
export function createPromptRelief(canvas,{depth=.035}={}){
 const {width,height}=canvas;return createPromptReliefPixels({width,height,data:canvas.getContext('2d').getImageData(0,0,width,height).data},{depth});
}
export function createPromptReliefPixels({width,height,data},{depth=.035}={}){
 const ink=(x,y)=>x>=0&&y>=0&&x<width&&y<height&&data[(y*width+x)*4+3]>=128;
 const edges=new Map(),key=(x,y)=>x+','+y;
 function edge(x,y,nx,ny,direction){const k=key(x,y);if(!edges.has(k))edges.set(k,[]);edges.get(k).push({x:nx,y:ny,direction});}
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(ink(x,y)){
  if(!ink(x,y-1))edge(x,y,x+1,y,0);
  if(!ink(x+1,y))edge(x+1,y,x+1,y+1,1);
  if(!ink(x,y+1))edge(x+1,y+1,x,y+1,2);
  if(!ink(x-1,y))edge(x,y+1,x,y,3);
 }
 const path=new ShapePath(),scale=2/width;
 while(edges.size){
  const start=edges.keys().next().value,points=[],origin=start.split(',').map(Number);let [x,y]=origin,direction=null;
  do{
   points.push([x,y]);const k=key(x,y),choices=edges.get(k);if(!choices?.length)throw Error('Prompt contour is open');
   const priority=direction===null?[0,1,2,3]:[(direction+1)%4,direction,(direction+3)%4,(direction+2)%4];
   const index=priority.map(d=>choices.findIndex(e=>e.direction===d)).find(i=>i>=0),next=choices.splice(index,1)[0];
   if(!choices.length)edges.delete(k);({x,y,direction}=next);
  }while(key(x,y)!==start);
  const corners=points.filter((p,i)=>{const a=points[(i+points.length-1)%points.length],b=points[(i+1)%points.length];return (p[0]-a[0])*(b[1]-p[1])!==(p[1]-a[1])*(b[0]-p[0]);});
  if(corners.length<3)continue;
  corners.forEach(([px,py],i)=>path[i?'lineTo':'moveTo']((px-width/2)*scale,(height/2-py)*scale));
  path.currentPath.closePath();
 }
 const shapes=path.toShapes();if(!shapes.length)throw Error('Prompt has no visible glyph geometry');
 const geometry=new ExtrudeGeometry(shapes,{depth,bevelEnabled:true,bevelSize:.0015,bevelThickness:.0015,bevelSegments:1,steps:1,curveSegments:1});
 geometry.translate(0,0,-depth/2);geometry.computeBoundingBox();return geometry;
}
