import * as T from './lib/three.core.js';
import {OBB} from 'three/addons/math/OBB.js';

export const FOLD_FLOW = Object.freeze({hinge:[-1.3,1.05,0],length:2.7,width:1.55,thickness:.13,receiver:[-3.05,2.2,0],receiverSize:[.12,2,1.8]});
export function initialFoldFlow(){return {creased:false,angle:0,receiver:false,receiverAngle:0,secondCrease:false,secondAngle:0};}
export function foldFlowPose(state){
 const pivot=new T.Matrix4().makeTranslation(...FOLD_FLOW.hinge),turn=new T.Matrix4().makeRotationZ(state.angle);
 return pivot.multiply(turn).multiply(new T.Matrix4().makeTranslation(FOLD_FLOW.length/2,0,0));
}
export function receiverFlowPose(state){return new T.Matrix4().makeTranslation(-3.05,1.2,-.9).multiply(new T.Matrix4().makeRotationY(state.receiverAngle)).multiply(new T.Matrix4().makeTranslation(0,1,.9));}
export function receiverEncounter(state){
 if(!state.creased)return null;
 const leaf=new OBB(new T.Vector3(),new T.Vector3(FOLD_FLOW.length/2,FOLD_FLOW.thickness/2,FOLD_FLOW.width/2)).applyMatrix4(foldFlowPose(state));
 const receiver=new OBB(new T.Vector3(),new T.Vector3(...FOLD_FLOW.receiverSize).multiplyScalar(.5)).applyMatrix4(receiverFlowPose(state));
 if(!leaf.intersectsOBB(receiver))return null;
 const along=(FOLD_FLOW.receiver[0]-FOLD_FLOW.hinge[0])/Math.cos(state.angle);
 return {moving:'leaf',receiving:'receiver',point:[FOLD_FLOW.receiver[0],FOLD_FLOW.hinge[1]+Math.sin(state.angle)*along,0],method:'prepared analytical slab OBBs'};
}
export function acceptFoldReceiver(state){if(!receiverEncounter(state))throw Error('Bring the folded part to the receiver');return {...state,receiver:true,receiverAngle:-Math.PI/2};}
