import {surfaceTeacherExperiment} from './surface-teacher-experiment.mjs';
import {createPaintedSteelSource,paintedSteelSummary} from '../painted-steel-source.mjs';
const definition=surfaceTeacherExperiment({
 id:'painted-steel-teacher',title:'Blistered painted steel',createSource:createPaintedSteelSource,
 readSchema:'kaminos.painted-steel-teacher.v1',label:'Blistered painted steel specimen',sourceURL:'authored:painted-steel-v1',
 boundary:'Static authored coating geometry. Magenta shows geometric support, not a proven all-angle shading budget. Finite tile.',
 initialView:{position:[1.8,1.6,2.4],target:[0,.02,0],fov:40},defaultMaterials:[],
 sourceControls:[['Blister clusters','source','patches',1],['Lift height','source','height',.002],['Support collar','source','supportMargin',.005],['Source seed','source','seed',1]],
});
export default {...definition,async create(args){
 const experiment=await definition.create({...args,inputs:{tracing:false,...args.inputs}}),originalRead=experiment.read,originalMount=experiment.mount;
 experiment.read=()=>{const state=originalRead();return {...state,sourceSummary:paintedSteelSummary(state.source)};};
 experiment.mount=function(props){originalMount.call(this,props);const row=props.document.createElement('label'),input=props.document.createElement('input');input.type='checkbox';input.checked=experiment.read().source.showMask;input.onchange=()=>props.invoke('source',{showMask:input.checked});row.append(input,' Show geometric support in magenta');props.root.append(row);};
 return experiment;
}};
