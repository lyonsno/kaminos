export function airbornePixelDelta(a,b){
 if(a.width!==b.width||a.height!==b.height||a.data.length!==a.width*a.height*4||b.data.length!==b.width*b.height*4)throw Error('Canvas pixel shape differs');
 let changedPixels=0,excludedPixelsChanged=0;const endY=Math.floor(a.height*.85);
 for(let i=0;i<a.data.length;i+=4)if(Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2])>20){if(Math.floor(i/4/a.width)<endY)changedPixels++;else excludedPixelsChanged++;}
 return {changedPixels,excludedPixelsChanged,roi:{x:0,y:0,width:a.width,height:endY}};
}
export function coveredSurfaceDelta(a,b){
 airbornePixelDelta(a,b); // shared exact shape validation
 const width=a.width,height=Math.floor(a.height*.85),mask=new Uint8Array(width*height),queue=new Uint32Array(mask.length);let changedPixels=0,largestComponent=0;
 for(let i=0;i<mask.length;i++){const j=i*4;if(Math.max(...[0,1,2].map(k=>Math.abs(a.data[j+k]-b.data[j+k])))>12){mask[i]=1;changedPixels++;}}
 for(let i=0;i<mask.length;i++)if(mask[i]){
  let read=0,end=1;queue[0]=i;mask[i]=0;
  while(read<end){const cell=queue[read++],x=cell%width,y=Math.floor(cell/width);for(const next of [x>0?cell-1:-1,x+1<width?cell+1:-1,y>0?cell-width:-1,y+1<height?cell+width:-1])if(next>=0&&mask[next]){mask[next]=0;queue[end++]=next;}}
  largestComponent=Math.max(largestComponent,end);
 }
 const minimumComponent=Math.max(1000,Math.floor(width*height*.002));
 return {changedPixels,largestComponent,minimumComponent,visible:largestComponent>=minimumComponent,roi:{x:0,y:0,width,height}};
}
