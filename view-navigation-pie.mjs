const slots=[['left','Left',-1,0],['right','Right',1,0],['bottom','Bottom',0,1],['top','Top',0,-1],['front','Front',-.707,-.707],['back','Back',.707,-.707],['camera','View Camera',-.707,.707],['selected','View Selected',.707,.707]];
export function pieDirection(dx,dy,threshold=24){if(Math.hypot(dx,dy)<threshold)return null;let index=0,best=-Infinity;slots.forEach(([, ,x,y],i)=>{const score=dx*x+dy*y;if(score>best){best=score;index=i;}});return index;}
export function installViewPie({document,viewport,invoke,allowed=()=>true,onError=()=>{}}){
 const overlay=document.createElement('div');overlay.id='view-navigation-pie';overlay.hidden=true;overlay.setAttribute('role','menu');overlay.setAttribute('aria-label','View');
 const center=document.createElement('span');center.className='view-pie-center';center.textContent='View';overlay.append(center);
 const buttons=slots.map(([id,label,x,y],i)=>{const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitem');button.dataset.view=id;button.style.setProperty('--pie-x',String(x));button.style.setProperty('--pie-y',String(y));button.innerHTML=`<span>${label}</span><small>${i+1}</small>`;overlay.append(button);button.onclick=()=>choose(i);return button;});viewport.append(overlay);
 let pointer=null,state=null;
 const text=node=>!!node?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
 const inside=node=>viewport.contains(node)&&!node.closest?.('#authoring-viewport-tools,#transform-bar');
 const close=()=>{state=null;overlay.hidden=true;};
 const choose=index=>{if(index==null){close();return;}const id=slots[index][0];close();try{invoke(id);}catch(error){onError(error);}};
 viewport.addEventListener('pointermove',event=>{if(!state)pointer={x:event.clientX,y:event.clientY};});
 document.addEventListener('pointermove',event=>{if(!state)return;const origin=state.held?state.origin:state.display;state.index=pieDirection(event.clientX-origin.x,event.clientY-origin.y);buttons.forEach((b,i)=>b.classList.toggle('highlighted',i===state.index));});
 document.addEventListener('keydown',event=>{
  if(state){event.preventDefault();event.stopImmediatePropagation();if(event.key==='Escape'){close();return;}if(event.key==='Enter'){choose(state.index);return;}if(/^[1-8]$/.test(event.key)){choose(Number(event.key)-1);return;}if(['ArrowLeft','ArrowRight'].includes(event.key)){state.index=((state.index??0)+(event.key==='ArrowRight'?1:7))%8;buttons.forEach((b,i)=>b.classList.toggle('highlighted',i===state.index));}return;}
  if(event.code!=='Backquote'||event.shiftKey||event.ctrlKey||event.metaKey||event.altKey||event.repeat||event.defaultPrevented||text(event.target)||text(document.activeElement)||!allowed())return;
  const rect=viewport.getBoundingClientRect();const point=pointer||{x:rect.left+rect.width/2,y:rect.top+rect.height/2};if(point.x<rect.left||point.x>rect.right||point.y<rect.top||point.y>rect.bottom)return;
  if(document.activeElement!==document.body&&!inside(document.activeElement))return;
  event.preventDefault();event.stopImmediatePropagation();const margin=145,x=Math.max(rect.left+Math.min(margin,rect.width/2),Math.min(rect.right-Math.min(margin,rect.width/2),point.x)),y=Math.max(rect.top+Math.min(margin,rect.height/2),Math.min(rect.bottom-Math.min(margin,rect.height/2),point.y));
  state={held:true,origin:point,display:{x,y},index:null};overlay.style.left=x-rect.left+'px';overlay.style.top=y-rect.top+'px';overlay.hidden=false;buttons.forEach(b=>b.classList.remove('highlighted'));
 },true);
 document.addEventListener('keyup',event=>{if(!state||event.code!=='Backquote')return;event.preventDefault();event.stopImmediatePropagation();if(state.index!==null)choose(state.index);else state.held=false;},true);
 document.addEventListener('pointerdown',event=>{if(!state)return;if(!overlay.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();close();}},true);
 document.defaultView.addEventListener('blur',close);
 return {close,state:()=>state?{held:state.held,index:state.index}:null};
}
