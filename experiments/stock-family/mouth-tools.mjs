import {BufferGeometry,BufferAttribute,LineSegments,LineBasicMaterial,Matrix4} from '../../lib/three.core.js';
import {createStockWarp,stockMouths,stockMouthFrame,alignStockMouth,stockMouthGap} from './model.mjs';
import {installSceneControlHistory} from '../../scene-control-history.mjs';

export function createStockMouthTools({host,win,items,session,edits,source,geometry,write,record}){
  const target='@stock-mouths:'+crypto.randomUUID(),helpers=new Map(),cleanups=[],uis=[];
  let visible=true;
  const calibration=()=>stockMouths(source().profile,source().mouths);
  const frames=item=>{
    if(item.removed||item.error)throw Error('Mouth unavailable on removed or blocked stock');
    const p=source().profile,warp=createStockWarp(p,item.value,geometry().userData.stockRestCurve);
    return Object.fromEntries(['start','end'].map(side=>[side,stockMouthFrame(warp,p,calibration(),side)]));
  };
  const member=id=>{const item=items.find(i=>i.value.id===id);if(!item)throw Error('Unknown stock member');return item;};
  function update(item){
    let helper=helpers.get(item);
    if(!helper){
      helper=['start','end'].map((side,index)=>{const line=new LineSegments(new BufferGeometry(),new LineBasicMaterial({color:index?0xf2ba5d:0x6cddd0,depthTest:false}));line.renderOrder=10;line.name=side+' mouth';item.root.add(line);return line;});helpers.set(item,helper);
    }
    for(const line of helper)line.visible=visible&&!item.error&&!item.removed;
    if(item.error||item.removed)return;
    const p=source().profile;
    for(const [index,side]of ['start','end'].entries()){
      const m=calibration()[side],warp=createStockWarp(p,item.value,geometry().userData.stockRestCurve),f=frames(item)[side],sign=side==='start'?-1:1;
      const a=warp.point([p.xMin,m.y,m.station]).position,b=warp.point([p.xMax,m.y,m.station]).position,c=f.position;
      const q=warp.point([m.x,m.y+.1,m.station]).position,t=[c[0]+sign*Math.sin(warp.point([m.x,m.y,m.station]).theta)*.15,c[1],c[2]+sign*Math.cos(warp.point([m.x,m.y,m.station]).theta)*.15];
      helper[index].geometry.setAttribute('position',new BufferAttribute(new Float32Array([...a,...b,...c,...q,...c,...t]),3));helper[index].geometry.computeBoundingSphere();
    }
  }
  const operations={
    mouths({mouths}){const next=stockMouths(source().profile,mouths);if(edits.state().active?.id===target)edits.preview(next);else edits.apply(target,next,'Calibrate stock mouths');return calibration();},
    mouthMarkers({enabled}){if(typeof enabled!=='boolean')throw Error('Explicit mouth marker visibility required');visible=enabled;items.forEach(update);session.redraw();return {enabled};},
    join({movingId,targetId,movingSide='start',targetSide='end'}){
      if(movingId===targetId)throw Error('Choose a different target member');
      const moving=member(movingId),fixed=member(targetId),a=frames(moving)[movingSide],b=frames(fixed)[targetSide];
      if(!a||!b)throw Error('Unknown stock mouth');
      moving.root.updateWorldMatrix(true,false);fixed.root.updateWorldMatrix(true,false);
      const next=alignStockMouth({moving:a,target:b,movingWorld:moving.root.matrixWorld,targetWorld:fixed.root.matrixWorld,parentWorld:moving.root.parent?.matrixWorld??new Matrix4()});
      edits.apply(moving.asset.id,next,'Join '+moving.value.label+' mouth');moving.value.join={targetId,movingSide,targetSide};host.scene.refreshPresentation(moving.asset);session.redraw();
      const result=gap(movingId,movingSide,targetId,targetSide);uis.forEach(fn=>fn());record({kind:'stock-family.join',phase:'applied',target:moving.asset.id,effective:{movingId,targetId,movingSide,targetSide,pose:next,...result}});return result;
    },
  };
  function gap(movingId,movingSide,targetId,targetSide){const a=member(movingId),b=member(targetId);a.root.updateWorldMatrix(true,false);b.root.updateWorldMatrix(true,false);return stockMouthGap(frames(a)[movingSide],a.root.matrixWorld,frames(b)[targetSide],b.root.matrixWorld);}
  edits.register(target,{read:calibration,check:value=>stockMouths(source().profile,value),write:value=>{write(value);items.forEach(update);session.redraw();}});
  items.forEach(update);
  return {target,operations,update,frames,calibration,
    mountSource(common,document,invoke){
      const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Mouth frames';details.append(summary);common.append(details);
      const label=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=visible;toggle.onchange=()=>invoke('mouthMarkers',{enabled:toggle.checked});label.append(toggle,' Show mouths');details.append(label);
      const status=document.createElement('output');status.className='stock-source-status';
      const inputs=[];
      for(const side of ['start','end'])for(const [key,name,step]of [['station','Station',.01],['x','Center X',.01],['y','Center Y',.01]]){
        const row=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=(side==='start'?'Start ':'End ')+name;input.type='number';input.step='any';input.className='transform-input';input.setAttribute('aria-label',grip.textContent);row.append(grip,input);details.append(row);inputs.push({input,side,key});
        input.oninput=()=>{if(!input.value.trim())return;const mouths=calibration();mouths[side][key]=Number(input.value);invoke('mouths',{mouths}).then(()=>{status.textContent='';}).catch(e=>{status.textContent=e.message;});};
        const drag=host.controls.installNumberDrag({input,grip,step});cleanups.push(()=>drag.dispose());
      }
      const history=installSceneControlHistory({controls:inputs.map(v=>v.input),edits,id:target,label:'Calibrate stock mouths',onError:e=>{status.textContent=e.message;}});cleanups.push(()=>history.dispose());details.append(status);
      uis.push(()=>{const mouths=calibration();toggle.checked=visible;for(const {input,side,key}of inputs)if(document.activeElement!==input||input.readOnly)input.value=String(mouths[side][key]);});
    },
    mountItem(item,properties,document,invoke){
      const section=document.createElement('div');section.className='stock-mouth-join';const title=document.createElement('h4');title.textContent='Join mouths';section.append(title);
      const select=(name,options)=>{const row=document.createElement('label'),s=document.createElement('select');row.textContent=name;s.className='transform-input';s.setAttribute('aria-label',item.value.label+' '+name);for(const [value,text]of options){const option=document.createElement('option');option.value=value;option.textContent=text;s.append(option);}row.append(s);section.append(row);return s;};
      const side=select('This mouth',[['start','Start'],['end','End']]),other=select('Target member',items.filter(i=>i!==item).map(i=>[i.value.id,i.value.label])),end=select('Target mouth',[['end','End'],['start','Start']]);
      const button=document.createElement('button'),status=document.createElement('output');button.className='btn';button.textContent='Join mouths';status.className='stock-mouth-gap';section.append(button,status);properties.append(section);
      let shownJoin='';
      const refresh=()=>{const key=JSON.stringify(item.value.join);if(key!==shownJoin){shownJoin=key;if(item.value.join){side.value=item.value.join.movingSide;other.value=item.value.join.targetId;end.value=item.value.join.targetSide;}}
        try{const g=gap(item.value.id,side.value,other.value,end.value);status.textContent=`Frame gap ${g.distance.toFixed(4)} \u00b7 Facing ${g.facingDegrees.toFixed(1)}\u00b0`;button.disabled=false;}catch(e){status.textContent=e.message;button.disabled=true;}};
      side.onchange=other.onchange=end.onchange=refresh;
      button.onclick=()=>invoke('join',{movingId:item.value.id,targetId:other.value,movingSide:side.value,targetSide:end.value}).then(refresh).catch(e=>{status.textContent=e.message;});uis.push(refresh);
    },
    refresh(){uis.forEach(fn=>fn());},
    dispose(){cleanups.forEach(fn=>fn());edits.unregister(target);for(const lines of helpers.values())for(const line of lines){line.removeFromParent();line.geometry.dispose();line.material.dispose();}},
  };
}
