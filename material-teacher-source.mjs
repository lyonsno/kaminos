import {preparationSource} from './granular-preparation.mjs';
import {createGroundTeacherSource} from './ground-teacher-source.mjs';
import {createEarthTeacherSource} from './earth-surface.mjs';
export function createMaterialTeacherSource(options={}){
 if(options.kind==='granular-preparation')return preparationSource(options.snapshot,{container:options.container??false});
 if(options.kind==='earth-specimen')return createEarthTeacherSource(options);
 if(options.kind!==undefined&&options.kind!=='authored-ground')throw Error(`Unknown material source ${options.kind}`);
 return createGroundTeacherSource(options);
}
