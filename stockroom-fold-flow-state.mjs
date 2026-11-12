import * as T from './lib/three.core.js';
import {OBB} from 'three/addons/math/OBB.js';

export const FOLD_FLOW = Object.freeze({hinge:[-1.3,1.05,0],length:2.7,width:1.55,thickness:.13,receiver:[-3.05,2.2,0],receiverSize:[.12,2,1.8]});
export function initialFoldFlow(){return {creased:false,angle:0,receiver:false,receiverAngle:0,receiverExtent:1.7,receiverCenter:2.2,receiverKind:'side',secondCrease:false,secondAngle:0};}
export function foldFlowPose(state){
 const pivot=new T.Matrix4().makeTranslation(...FOLD_FLOW.hinge),turn=new T.Matrix4().makeRotationZ(state.angle);
 return pivot.multiply(turn).multiply(new T.Matrix4().makeTranslation(FOLD_FLOW.length/2,0,0));
}
export function receiverFrame(state){
 if(!state.receiver)return new T.Matrix4().makeTranslation(-3.05,1.2,-.9);
 const side=state.receiverKind==='side';
 return new T.Matrix4().makeTranslation(-3.05,state.receiverCenter-.65,side?state.receiverExtent/2:0)
  .multiply(side?new T.Matrix4().makeRotationY(state.receiverAngle):new T.Matrix4().makeRotationZ(state.receiverAngle));
}
export function receiverFlowPose(state){return receiverFrame(state).multiply(new T.Matrix4().makeTranslation(0,state.receiver?.65:1,state.receiver?(state.receiverKind==='side'?-state.receiverExtent/2:0):.9));}
export function receiverEncounter(state){
 if(!state.creased)return null;
 const leaf=new OBB(new T.Vector3(),new T.Vector3(FOLD_FLOW.length/2,FOLD_FLOW.thickness/2,FOLD_FLOW.width/2)).applyMatrix4(foldFlowPose(state));
 const receiver=new OBB(new T.Vector3(),new T.Vector3(...(state.receiver?[.12,1.3,state.receiverExtent]:FOLD_FLOW.receiverSize)).multiplyScalar(.5)).applyMatrix4(receiverFlowPose(state));
 if(!leaf.intersectsOBB(receiver))return null;
 const along=(FOLD_FLOW.receiver[0]-FOLD_FLOW.hinge[0])/Math.cos(state.angle);
 return {moving:'leaf',receiving:'receiver',point:[FOLD_FLOW.receiver[0],FOLD_FLOW.hinge[1]+Math.sin(state.angle)*along,0],method:'prepared analytical slab OBBs'};
}
export const FOLD_CHOICES=Object.freeze([
 {id:'side',label:'Side flap',axis:'Vertical hinge',parameters:['Span','Swing']},
 {id:'drop',label:'Drop flap',axis:'Lower hinge',parameters:['Span','Fold']},
]);
export function acceptFoldReceiver(state,kind='side',parameters={extent:1.7,angle:Math.PI/2}){
 const encounter=receiverEncounter(state);if(!encounter)throw Error('Bring the folded part to the receiver');
 if(!FOLD_CHOICES.some(choice=>choice.id===kind))throw Error('Unknown receiving choice');
 if(!Number.isFinite(parameters.extent)||!Number.isFinite(parameters.angle))throw Error('Finite receiving parameters required');
 if(parameters.extent<=.12||parameters.extent>FOLD_FLOW.receiverSize[2])throw Error('Span must fit the receiving surface');
 return {...state,receiver:true,receiverKind:kind,receiverExtent:parameters.extent,receiverAngle:parameters.angle,
  receiverCenter:Math.max(1.85,Math.min(2.55,encounter.point[1]))};
}

// This is the prepared decision sequence, not scene history or a topology model.
export function createFoldAuthoring(){
 let frame={stage:'idle',model:initialFoldFlow(),part:null,highlighted:null,choice:null,parameters:null,encounter:null},parents=[];
 const copy=value=>structuredClone(value),requireStage=stage=>{if(frame.stage!==stage)throw Error(`Expected ${stage}, got ${frame.stage}`);};
 const push=next=>{parents.push(copy(frame));frame=next;};
 const display=()=>frame.stage==='tuning'||frame.stage==='choosing'&&frame.highlighted
  ?acceptFoldReceiver(frame.model,frame.choice??frame.highlighted,frame.parameters??{extent:1.7,angle:Math.PI/2}):copy(frame.model);
 return {
  read:()=>copy({...frame,depth:parents.length}),display,
  begin(part){requireStage('idle');if(!['leaf','receiver','tip'].includes(part)||part!=='leaf'&&!frame.model.receiver)throw Error('Part is not available');
   const model={...frame.model,[part==='tip'?'secondCrease':'creased']:true};push({...frame,stage:'bending',model,part});},
  bend(angle){requireStage('bending');if(!Number.isFinite(angle))throw Error('Finite fold angle required');const key=frame.part==='leaf'?'angle':frame.part==='receiver'?'receiverAngle':'secondAngle';frame={...frame,model:{...frame.model,[key]:angle}};},
  hold(){requireStage('bending');const encounter=frame.part==='leaf'&&!frame.model.receiver?receiverEncounter(frame.model):null;
   push({...frame,stage:encounter?'choosing':'idle',encounter,part:null,highlighted:null,choice:null,parameters:null});},
  highlight(id){requireStage('choosing');if(id!==null&&!FOLD_CHOICES.some(choice=>choice.id===id))throw Error('Unknown receiving choice');frame={...frame,highlighted:id};},
  choose(){requireStage('choosing');if(!frame.highlighted)throw Error('Highlight a receiving choice first');
   push({...frame,stage:'tuning',choice:frame.highlighted,parameters:{extent:1.7,angle:Math.PI/2}});},
  tune(parameters){requireStage('tuning');acceptFoldReceiver(frame.model,frame.choice,parameters);frame={...frame,parameters:copy(parameters)};},
  enter(){requireStage('tuning');const model=display();push({...frame,stage:'idle',model,part:null,highlighted:null,choice:null,parameters:null,encounter:null});},
  back(){if(parents.length)frame=parents.pop();return copy(frame);},
  reset(){parents=[];frame={stage:'idle',model:initialFoldFlow(),part:null,highlighted:null,choice:null,parameters:null,encounter:null};},
 };
}
