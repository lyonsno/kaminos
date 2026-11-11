import {Color} from './lib/three.core.js';
import {createGrassTeacherSource} from './surface-teacher-source.mjs';
// Same frozen ribbons and linear material values as the interactive grass teacher.
export function createGrassMaterialSource(options={}){
 const source=createGrassTeacherSource(options);
 return {...source,materials:[{color:new Color(0x62513a).toArray(),roughness:.95,metalness:0},{color:new Color(0x71812c).toArray(),roughness:.65,metalness:0}],
 referenceHeight:source.config.height+.002,
 boundary:source.periodic?'Periodic surface geometry and ray transport; one canonical cell on continuous backing':'Finite broad grass patch on backing; edge exits are retained, not infinite periodic transport',
 unit:'one rectangular frozen grass patch'};
}
