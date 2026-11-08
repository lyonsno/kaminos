// Native inspector attachment for the unit root and its emitter component.
export function mountFireUnitControls({document,owner,asset,edits,components,mountObject,select,redraw,onError}){
 const dataTarget='@fire-unit-data:'+asset.id,sourceTarget='@fire-unit-emitter:'+asset.id;
 let sourceMode=false;
 const properties=document.createElement('section'),title=document.createElement('h3'),label=document.createElement('label'),link=document.createElement('input'),sourceButton=document.createElement('button'),status=document.createElement('p');
 properties.dataset.fireUnitControls=asset.id;link.type='checkbox';link.dataset.fireUnitLink=asset.id;label.append(link,document.createTextNode(' Move emitter with grid'));
 sourceButton.type='button';sourceButton.className='btn';properties.append(title,label,sourceButton,status);
 const refresh=()=>{const data=owner.capture();title.textContent=sourceMode?'Fire emitter':'Fire simulation';link.checked=data.moveEmitterWithGrid;sourceButton.textContent=sourceMode?'Select grid':'Select emitter';status.textContent='Outer and Fine grids move as one unit. Each fire has its own simulation.';};
 const guarded=fn=>{try{fn();refresh();redraw();}catch(error){onError(error);refresh();}};
 edits.register(dataTarget,{read:()=>owner.capture(),check:value=>{if(typeof value.moveEmitterWithGrid!=='boolean')throw Error('Move emitter with grid must be boolean');return structuredClone(value);},write:value=>{owner.setData(value);refresh();redraw();}});
 edits.register(sourceTarget,{read:()=>owner.capture().emitter,check:value=>{if(!value?.position?.every(Number.isFinite))throw Error('Emitter needs a finite pose');return structuredClone(value);},write:value=>{owner.setEmitter(value);refresh();redraw();}});
 const seat=components.register(asset.id,{enter(){sourceMode=true;owner.proxy.parent??asset.root.parent?.add(owner.proxy);refresh();},exit(){sourceMode=false;refresh();},
  target:()=>({id:sourceTarget,type:'fire-unit-emitter',label:'Fire emitter',object:owner.proxy,read:()=>owner.capture().emitter,frameObjects:[owner.emitter]}),
  pick(){},selectAll(){}});
 sourceButton.onclick=()=>guarded(()=>{select(asset.id);components.toggle(asset.id);});
 link.onchange=()=>guarded(()=>edits.apply(dataTarget,{...owner.capture(),moveEmitterWithGrid:link.checked},'Link emitter to fire grid'));
 const controls=mountObject({asset,properties,onSelected:refresh});refresh();
 return {refresh,dispose(){seat.dispose();controls.dispose();edits.unregister(dataTarget);edits.unregister(sourceTarget);}};
}
