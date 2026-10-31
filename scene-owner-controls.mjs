// Presentation attachment for actual registered objects; no domain state or clock.
export function createSceneOwnerControls({document,viewport,inspector,selected,onContext=()=>{},project,onFrame}) {
 const entries=new Set(),operating=new Set();
 let stopFrames;
 let context=false;
 const belongs=(entry,selection)=>{
  if(!selection)return false;
  if(selection.ownerId===entry.asset.id)return true;
  for(let object=selection.object;object;object=object.parent)if(object===entry.asset.root||entry.relatedAssets.some(asset=>asset?.id&&object===asset.root))return true;
  return false;
 };
 function update(){
  const selection=selected();
  for(const entry of entries){const active=belongs(entry,selection);entry.properties.hidden=!active;if(entry.playback)entry.playback.hidden=!active;if(active)entry.onSelected?.();}
  const next=[...entries].some(e=>belongs(e,selection));if(next!==context){context=next;onContext(next);}
 }
 function mount({asset,relatedAssets=[],properties,playback,onSelected}){
  if(!asset?.id||!asset.root||!properties)throw Error('Object controls require a registered root and properties');
  if(!Array.isArray(relatedAssets))throw Error('Related owner objects must be registered asset receipts');
  const entry={asset,relatedAssets,properties,playback,onSelected};entries.add(entry);
  if(playback)playback.className+=' scene-owner-playback';
  properties.className+=' scene-owner-properties';
  inspector.append(properties);if(playback)viewport.append(playback);update();
  let disposed=false;
  return {update,dispose(){if(disposed)return;disposed=true;entries.delete(entry);properties.remove();playback?.remove();update();}};
 }
 // These controls operate registered objects directly; selection remains independent.
 function positionOperating(){
  const placed=[];
  const locked=[...operating].some(e=>e.pointer||e.node.contains(document.activeElement));
  for(const entry of operating){
   const point=project(entry.asset,entry.anchor);
   entry.node.hidden=!point;
   if(!point)continue;
   if(locked&&entry.position){placed.push(entry.position);continue;}
   const w=entry.node.offsetWidth,h=entry.node.offsetHeight,b=point.bounds;
   let x=entry.side==='left'?point.x-w-24:point.x+24;
   x=Math.max(b.left+12,Math.min(x,b.right-w-12));
   let y=Math.max(b.top+12,Math.min(point.y-h-48,b.bottom-h-12));
   for(const other of placed)if(x<other.x+other.w+12&&x+w+12>other.x&&y<other.y+other.h+12&&y+h+12>other.y){
    const below=other.y+other.h+12;
    y=below+h<b.bottom-12?below:Math.max(b.top+12,other.y-h-12);
   }
   const next={x,y,w,h};entry.position=next;placed.push(next);
   entry.node.style.left=x+'px';entry.node.style.top=y+'px';
  }
 }
 function mountOperating({asset,node,side='right',anchor=[0,0,0]}){
  if(!asset?.id||!asset.root||!node||!project||!onFrame)throw Error('Operating controls require a registered object and viewport projection');
  const entry={asset,node,side,anchor,pointer:false};operating.add(entry);
  node.classList.add('scene-owner-operating');node.dataset.ownerId=asset.id;
  const events=[];
  const listen=(target,event,fn,options)=>{target.addEventListener(event,fn,options);events.push(()=>target.removeEventListener(event,fn,options));};
  for(const event of ['pointerdown','pointermove','pointerup','click','dblclick','wheel','keydown','keyup'])listen(node,event,e=>e.stopPropagation());
  listen(node,'pointerdown',()=>{entry.pointer=true;},true);
  const release=()=>{entry.pointer=false;};
  listen(document,'pointerup',release,true);listen(document,'pointercancel',release,true);listen(document.defaultView,'blur',release);
  viewport.append(node);if(!stopFrames)stopFrames=onFrame(positionOperating);positionOperating();
  let disposed=false;
  return {update:positionOperating,dispose(){if(disposed)return;disposed=true;events.splice(0).forEach(remove=>remove());operating.delete(entry);node.remove();if(!operating.size){stopFrames?.();stopFrames=null;}}};
 }
 return {mount,mountOperating,update};
}
