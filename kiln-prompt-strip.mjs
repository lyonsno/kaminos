import {Plane,Vector3,ClippingGroup} from './lib/three.webgpu.js';
// A physical text strip travels through the authored editor opening. Clipping
// changes presentation only: geometry, material coordinates and glyphs survive.
export function createKilnPromptStrip({root,mesh,windowHeight=520}){
 const local=[new Plane(new Vector3(0,1,0),windowHeight/1024),new Plane(new Vector3(0,-1,0),windowHeight/1024)];
 root.clippingPlanes=local.map(p=>p.clone());root.clipShadows=true;
 let height=windowHeight,pixels=0,admitted=false;
 const position=()=>{mesh.position.y=(windowHeight-height+2*pixels)/1024;mesh.updateMatrixWorld(true);};
 return {
  attachSurface(surface){
   const parent=surface.parent;if(!parent)throw Error('Attached burn surface needs its existing world-space parent');
   // Identity wrapper preserves the debris owner's world-space transforms;
   // only still-attached char is clipped, never the detached particles.
   const aperture=new ClippingGroup();aperture.name='Prompt char aperture';aperture.clippingPlanes=root.clippingPlanes;aperture.clipShadows=true;
   parent.add(aperture);aperture.add(surface);
   return ()=>{if(surface.parent===aperture)parent.add(surface);aperture.removeFromParent();};
  },
  prepare(value,scroll=0){if(!Number.isFinite(value)||value<=0)throw Error('Prompt strip needs a finite positive raster height');height=value;pixels=scroll;admitted=false;position();},
  scroll(value){if(!admitted){pixels=value;position();}},
  admit(){if(admitted)return;admitted=true;pixels=0;position();},
  advance(progress){if(!admitted)return;if(!Number.isFinite(progress)||progress<0||progress>1)throw Error('Prompt feed progress must be between zero and one');pixels=Math.max(pixels,Math.max(0,height-windowHeight)*progress);position();},
  release(scroll=0){admitted=false;pixels=scroll;position();},
  sync(){root.updateWorldMatrix(true,false);for(let i=0;i<local.length;i++)root.clippingPlanes[i].copy(local[i]).applyMatrix4(root.matrixWorld);},
  read:()=>({height,pixels,admitted,distance:Math.max(0,height-windowHeight)}),
 };
}
