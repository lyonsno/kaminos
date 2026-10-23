import {LatheGeometry,Vector2,Mesh,FrontSide} from './lib/three.core.js';
import {MeshPhysicalNodeMaterial} from './lib/three.webgpu.js';

// One continuous, smooth shell: outside -> lip -> inside -> raised inner floor.
// Known geometry is an optical control, not a claim that screen-space shading traces both walls.
export function createReferenceBottle(){
 const profile=[[0,0],[.16,0],[.19,.025],[.2,.08],[.2,.4],[.19,.5],[.13,.62],[.065,.7],[.06,.9],[.075,.92],[.075,.96],[.04,.96],[.04,.72],[.11,.63],[.17,.5],[.18,.4],[.18,.08],[.15,.02],[0,.02]];
 const geometry=new LatheGeometry(profile.map(p=>new Vector2(...p)),64);
 const material=new MeshPhysicalNodeMaterial({color:0xdca777,metalness:0,roughness:.15,transmission:1,ior:1.45,thickness:.06,side:FrontSide});
 const root=new Mesh(geometry,material);root.name='Smooth hollow bottle — optical reference';
 return {root,read:()=>({route:'smooth-hollow-lathe',radialSegments:64,wallAtBody:.02,ior:material.ior,thickness:material.thickness}),
  set({ior,thickness,mode}={}){if(ior!==undefined)material.ior=ior;if(thickness!==undefined)material.thickness=thickness;if(mode!==undefined)material.transmission=mode==='glass'?1:0;},
  dispose(){geometry.dispose();material.dispose();}};
}
