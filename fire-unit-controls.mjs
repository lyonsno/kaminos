// Native inspector attachment for the unit, Fine box and emitter components.
export function mountFireUnitControls({document,owner,asset,edits,components,mountObject,redraw,onError,mountTuning=()=>null}){
 const dataTarget='@fire-unit-data:'+asset.id,sourceTarget='@fire-unit-emitter:'+asset.id,fineTarget='@fire-unit-fine:'+asset.id;
 let component=null,tuning=null,tuningRevision=-1;
 const emissionLabel=document.createElement('label'),enabled=document.createElement('input');enabled.type='checkbox';emissionLabel.append(enabled,document.createTextNode(' Emit gas'));
 const properties=document.createElement('section'),title=document.createElement('h3'),label=document.createElement('label'),link=document.createElement('input'),status=document.createElement('p');
 properties.dataset.fireUnitControls=asset.id;link.type='checkbox';link.dataset.fireUnitLink=asset.id;label.append(link,document.createTextNode(' Move emitter with grid'));properties.append(title,label,emissionLabel,status);
 const refresh=()=>{const data=owner.linkState();title.textContent=component==='emitter'?'Flame emitter':component==='fine'?'Fine box':'Flame';link.checked=data.moveEmitterWithGrid;enabled.checked=data.emissionEnabled!==false;if(tuning&&tuningRevision!==owner.authoringRevision){tuningRevision=owner.authoringRevision;tuning.sync();}tuning?.setSourceMode?.(component==='emitter');status.textContent='Tab edits Fine and emitter. Click either in the viewport; Tab returns to the whole Flame.';};
 const guarded=fn=>{try{fn();refresh();redraw();}catch(error){onError(error);refresh();}};
 edits.register(dataTarget,{read:()=>owner.capture(),check:value=>{if(typeof value.moveEmitterWithGrid!=='boolean')throw Error('Move emitter with grid must be boolean');return structuredClone(value);},write:value=>{owner.setData(value);refresh();redraw();}});
 const poseHistory={capture:pose=>({...pose,fineManualHold:owner.capture().fineManualHold===true}),restore:value=>value};
 edits.register(sourceTarget,{history:poseHistory,read:()=>owner.capture().emitter,write:value=>{owner.setEmitter(value,{manualHold:value.fineManualHold??false});refresh();redraw();}});
 edits.register(fineTarget,{history:poseHistory,read:()=>owner.finePose(),write:value=>{owner.setFinePose(value,{manualHold:value.fineManualHold??true});refresh();redraw();}});
 const seat=components.register(asset.id,{enter(){component='fine';if(owner.fineProxy&&!owner.fineProxy.parent)asset.root.parent?.add(owner.fineProxy);if(owner.proxy&&!owner.proxy.parent)asset.root.parent?.add(owner.proxy);refresh();},exit(){component=null;refresh();},
  target:()=>component==='emitter'?{id:sourceTarget,type:'fire-unit-emitter',label:'Flame emitter',object:owner.proxy,read:()=>owner.capture().emitter,frameObjects:[owner.emitter]}:{id:fineTarget,type:'fire-unit-fine',label:'Fine box',object:owner.fineProxy,read:()=>owner.finePose(),frameObjects:[owner.fine]},
  pick(event,context){const next=owner.pickComponent(event,context);if(next&&next!==component)seat.changed(()=>{component=next;refresh();});},selectAll(){}});
 enabled.onchange=()=>guarded(()=>edits.apply(dataTarget,{...owner.capture(),emissionEnabled:enabled.checked,fineManualHold:false},'Toggle fire source'));
 link.onchange=()=>guarded(()=>edits.apply(dataTarget,{...owner.capture(),moveEmitterWithGrid:link.checked},'Link emitter to fire grid'));
 const tuningRoot=document.createElement('div');properties.append(tuningRoot);tuning=mountTuning({root:tuningRoot,owner,target:dataTarget});
 const controls=mountObject({asset,properties,onSelected:refresh,onDeselected:()=>tuning?.close()});refresh();
 return {refresh,dispose(){tuning?.dispose();seat.dispose();controls.dispose();edits.unregister(dataTarget);edits.unregister(sourceTarget);edits.unregister(fineTarget);}};
}
