import * as T from './lib/three.core.js';

export const WORKPIECES=Object.freeze({
 stairs:{label:'Attached stairs',origin:[-4.7,0,0],choices:[
  {id:'swing',label:'Swing flight',parameters:[['Sweep',-1.1,1.1,'deg'],['Lift',-.25,.65,'deg']]},
  {id:'rebuild',label:'Rebuild run',parameters:[['Side',-1.8,1.8,'m'],['Run',1.3,3.3,'m']]},
 ]},
 trough:{label:'Forked trough',origin:[0,0,0],choices:[
  {id:'branch',label:'Outlet only',parameters:[['Turn',-.7,.7,'deg'],['Lift',-.3,.9,'deg']]},
  {id:'carry',label:'Carry junction',parameters:[['Turn',-.7,.7,'deg'],['Lift',-.3,.9,'deg']]},
  {id:'route',label:'Reshape route',parameters:[['Reach',1.1,2.8,'m'],['Rise',-.25,1.2,'m']]},
 ]},
 corner:{label:'Kitchen corner',origin:[4.7,0,0],choices:[
  {id:'carry',label:'Carry return',parameters:[['Fold',-.25,1.1,'deg'],['Sweep',-.6,.6,'deg']]},
  {id:'leave',label:'Leave return',parameters:[['Fold',-.25,1.1,'deg'],['Sweep',-.6,.6,'deg']]},
  {id:'wrap',label:'Wrap split',parameters:[['Fold',-.25,1.1,'deg'],['Front band',.3,.9,'m']]},
 ]},
});
const copy=v=>structuredClone(v),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const choiceFor=(piece,kind)=>WORKPIECES[piece]?.choices.find(c=>c.id===kind);
export function validateWorkpiece(piece,model){
 const choice=choiceFor(piece,model?.kind);
 if(!choice)throw Error('Unknown construction choice');
 if(model.bearing!==undefined&&!Number.isFinite(model.bearing))throw Error('Finite route bearing required');
 for(const [i,key]of ['u','v'].entries()){
  const [,min,max]=choice.parameters[i];
  if(!Number.isFinite(model[key])||model[key]<min||model[key]>max)throw Error('Parameters must fit this prepared workpiece');
 }
 return copy(model);
}
export function initialWorkpieces(){return {stairs:{kind:'rebuild',u:0,v:2.2},trough:{kind:'branch',u:0,v:0},corner:{kind:'carry',u:0,v:0}};}
export function interpretWorkpiece(piece,kind,intent){
 if(kind===intent.kind)return validateWorkpiece(piece,intent);
 let u=intent.u,v=intent.v,extra={};
 if(piece==='stairs'){
  const plan=stairPlan(intent);
  if(kind==='swing'){u=plan.heading;v=0;}else{u=plan.foot[0];v=plan.foot[2];}
 }
 if(piece==='trough'){
  const end=troughPlan(intent).right;
  if(kind==='route'){u=Math.hypot(end[0],end[2]);v=end[1]-.85;extra.bearing=Math.atan2(end[0],-end[2]);}
  else{const z=kind==='carry'?-3.05:-1.45,dz=end[2]-(kind==='carry'?1.6:0);v=Math.asin(clamp((end[1]-.85)/-z,-1,1));u=Math.atan2(1.45,-z*Math.cos(v))-Math.atan2(end[0],-dz);}
 }
 if(piece==='corner'&&(kind==='wrap'||intent.kind==='wrap'))v=kind==='wrap'?.6:0;
 const choice=choiceFor(piece,kind);if(!choice)throw Error('Unknown construction choice');
 return validateWorkpiece(piece,{kind,...extra,u:clamp(u,...choice.parameters[0].slice(1,3)),v:clamp(v,...choice.parameters[1].slice(1,3))});
}
export function createWorkpieceAuthoring(){
 let frame={stage:'idle',models:initialWorkpieces(),piece:null,intent:null,highlighted:null,choice:null,parameters:null},parents=[];
 const expect=stage=>{if(frame.stage!==stage)throw Error(`Expected ${stage}, got ${frame.stage}`);};
 const push=next=>{parents.push(copy(frame));frame=next;};
 function display(){const models=copy(frame.models);if(frame.stage==='shaping'||frame.stage==='choosing')models[frame.piece]=copy(frame.intent);
  if(frame.stage==='choosing'&&frame.highlighted)models[frame.piece]=interpretWorkpiece(frame.piece,frame.highlighted,frame.intent);
  if(frame.stage==='tuning')models[frame.piece]=copy(frame.parameters);return models;}
 return {
  read:()=>copy({...frame,depth:parents.length}),display,
  begin(piece){expect('idle');if(!WORKPIECES[piece])throw Error('Unknown workpiece');push({...frame,stage:'shaping',piece,intent:copy(frame.models[piece])});},
  shape(parameters){expect('shaping');const model=validateWorkpiece(frame.piece,{...frame.intent,...parameters});frame={...frame,intent:model};},
  hold(){expect('shaping');push({...frame,stage:'choosing',highlighted:null});},
  highlight(kind){expect('choosing');if(kind!==null&&!choiceFor(frame.piece,kind))throw Error('Unknown construction choice');frame={...frame,highlighted:kind};},
  choose(){expect('choosing');if(!frame.highlighted)throw Error('Highlight a construction choice');push({...frame,stage:'tuning',choice:frame.highlighted,parameters:interpretWorkpiece(frame.piece,frame.highlighted,frame.intent)});},
  tune(parameters){expect('tuning');frame={...frame,parameters:validateWorkpiece(frame.piece,{...frame.parameters,...parameters})};},
  enter(){expect('tuning');push({stage:'idle',models:display(),piece:null,intent:null,highlighted:null,choice:null,parameters:null});},
  back(){if(parents.length)frame=parents.pop();},
  reset(){parents=[];frame={stage:'idle',models:initialWorkpieces(),piece:null,intent:null,highlighted:null,choice:null,parameters:null};},
 };
}

const vector=p=>new T.Vector3(...p),matrix=(point,u,v)=>new T.Matrix4().makeTranslation(...point).multiply(new T.Matrix4().makeRotationY(u)).multiply(new T.Matrix4().makeRotationX(v));
export function stairPlan(model){
 validateWorkpiece('stairs',model);const top=[0,1.3,0],n=7,points=[],treads=[];
 const heading=model.kind==='swing'?model.u:Math.atan2(model.u,model.v),yaw=model.kind==='swing'?heading:0,run=model.kind==='swing'?2.2:Math.hypot(model.u,model.v),tilt=model.kind==='swing'?model.v:0;
 if(model.kind==='rebuild'){
  for(let i=0;i<=n;i++)points.push([model.u*i/n,1.3*(1-i/n),model.v*i/n]);
  for(let i=0;i<n;i++)treads.push({point:[model.u*(i+.5)/n,1.3*(1-(i+1)/n),model.v*(i+.5)/n],yaw:0,tilt:0,depth:model.v/n});
  return {top,foot:points.at(-1),points,treads,yaw,heading,tilt,run,retained:[top],mode:model.kind};
 }
 const transform=matrix(top,yaw,-tilt);
 for(let i=0;i<=n;i++)points.push(vector([0,-1.3*i/n,run*i/n]).applyMatrix4(transform).toArray());
 for(let i=0;i<n;i++)treads.push({point:vector([0,-1.3*(i+1)/n,run*(i+.5)/n]).applyMatrix4(transform).toArray(),yaw,tilt,depth:run/n});
 return {top,foot:points.at(-1),points,treads,yaw,heading,tilt,run,retained:[top],mode:model.kind};
}
export function troughPlan(model){
 validateWorkpiece('trough',model);const junction=[0,.85,0],stem=[0,.85,1.6],left=[-1.45,.85,-1.45],right=[1.45,.85,-1.45];
 const pivot=model.kind==='carry'?stem:junction,rotation=matrix(pivot,model.kind==='route'?0:model.u,model.kind==='route'?0:model.v).multiply(new T.Matrix4().makeTranslation(...pivot.map(x=>-x)));
 const turn=p=>vector(p).applyMatrix4(rotation).toArray();
 let center=junction,inlet=stem,leftEnd=left,rightEnd=right;
 if(model.kind==='carry'){center=turn(junction);inlet=turn(stem);leftEnd=turn(left);rightEnd=turn(right);}
 else if(model.kind==='branch')rightEnd=turn(right);
 else{const bearing=model.bearing??Math.PI/4;rightEnd=[model.u*Math.sin(bearing),.85+model.v,-model.u*Math.cos(bearing)];}
 const routes=[[inlet,center],[center,leftEnd]];
 if(model.kind==='route'){
  const control=vector(center).lerp(vector(rightEnd),.5).add(new T.Vector3(.15,.35+Math.abs(model.v)*.25,.2));
  const curve=new T.QuadraticBezierCurve3(vector(center),control,vector(rightEnd));routes.push(curve.getPoints(12).map(p=>p.toArray()));
 }else routes.push([center,rightEnd]);
 return {junction:center,inlet,left:leftEnd,right:rightEnd,routes,retained:model.kind==='carry'?[stem]:[stem,left,junction],mode:model.kind};
}
export function cornerPlan(model){
 validateWorkpiece('corner',model);const hinge=[-1.15,1.2,0],moving=new T.Matrix4().makeTranslation(...hinge).multiply(new T.Matrix4().makeRotationY(model.kind==='wrap'?0:model.v)).multiply(new T.Matrix4().makeRotationZ(model.u));
 const point=p=>vector(p).applyMatrix4(moving).toArray(),width=1.4,band=model.kind==='wrap'?model.v:width;
 return {hinge,matrix:moving.toArray(),band,splitZ:.7-band,tip:point([2.3,0,.5]),returnTop:model.kind==='leave'?[1.15,1.95,0]:point([2.3,.75,model.kind==='wrap'?.7-band/2:0]),canopy:[0,2.55,-.3],retained:[hinge,[0,2.55,-.3]],mode:model.kind};
}
