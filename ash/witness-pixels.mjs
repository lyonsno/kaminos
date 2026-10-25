export function airbornePixelDelta(a,b){
 if(a.width!==b.width||a.height!==b.height||a.data.length!==a.width*a.height*4||b.data.length!==b.width*b.height*4)throw Error('Canvas pixel shape differs');
 let changedPixels=0,excludedPixelsChanged=0;const endY=Math.floor(a.height*.85);
 for(let i=0;i<a.data.length;i+=4)if(Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2])>20){if(Math.floor(i/4/a.width)<endY)changedPixels++;else excludedPixelsChanged++;}
 return {changedPixels,excludedPixelsChanged,roi:{x:0,y:0,width:a.width,height:endY}};
}
