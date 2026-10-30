import {Matrix4} from './lib/three.core.js';
// One browser text layout for editing and for the glyph mask consumed by the
// existing solid/thermal constructor. No per-character picking or custom undo.
const width=1024;
const typography='box-sizing:border-box;width:1024px;margin:0;border:0;padding:20px 60px;font:500 76px Georgia;line-height:92px;letter-spacing:normal;text-align:center;white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;tab-size:8;';
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function promptPlaneTransform({camera,object,width:vw,height:vh,textHeight}){
 camera.updateMatrixWorld();object.updateWorldMatrix(true,false);
 const local=new Matrix4().makeTranslation(-1,textHeight/width,.018);
 local.multiply(new Matrix4().makeScale(2/width,-2/width,1));
 const clip=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(object.matrixWorld).multiply(local);
 const screen=new Matrix4().set(vw/2,0,0,vw/2,0,-vh/2,0,vh/2,0,0,1,0,0,0,0,1).multiply(clip);
 return `matrix3d(${screen.elements.join(',')})`;
}
export function installKilnPromptEditor({document,viewport,input,camera,object,onChange=()=>{},onPresentation=()=>{},onError=()=>{}}){
 const layer=document.createElement('div');layer.className='kiln-prompt-plane';viewport.append(layer);
 const home=input.parentNode,after=input.nextSibling,priorStyle=input.getAttribute('style'),priorPlaceholder=input.placeholder;
 layer.append(input);input.classList.add('kiln-prompt-input');input.placeholder='Describe your image…';input.wrap='soft';
 const mirror=document.createElement('div');mirror.setAttribute('aria-hidden','true');mirror.style.cssText=typography+'position:fixed;left:-100000px;top:0;visibility:hidden;';document.body.append(mirror);
 let height=180,burning=false,disposed=false,presented=null;
 function measure(value){mirror.textContent=value+'\u200b';return Math.max(180,mirror.scrollHeight);}
 function position(){
  if(disposed)return;const rect={width:viewport.clientWidth,height:viewport.clientHeight};
  input.style.transform=promptPlaneTransform({camera,object,width:rect.width,height:rect.height,textHeight:height});
 }
 function present(){const editing=!burning||document.activeElement===input;layer.dataset.editing=String(editing);input.style.color=editing?'#b8b2a8':'transparent';object.visible=!editing;if(presented!==editing){presented=editing;onPresentation();}}
 function sync(){
  height=measure(input.value);input.style.cssText=typography+`height:${height}px;min-height:0;max-height:none;position:absolute;left:0;top:0;transform-origin:0 0;resize:none;background:transparent;border-radius:0;box-shadow:none;overflow:hidden;outline:none;caret-color:#ffcd8d;`;
  position();present();
 }
 const edit=()=>{sync();onChange(input.value);};
 input.addEventListener('input',edit);input.addEventListener('focus',present);input.addEventListener('blur',present);
 // Existing callers sometimes set .value before dispatching/redrawing. Keep
 // their original element and native setter; the consumer calls sync on render.
 const observer=new document.defaultView.ResizeObserver(position);observer.observe(viewport);
 sync();
 return {sync,position,setBurning(value){burning=!!value;present();},
  async rasterize(value){
   await document.fonts.ready;const h=measure(value),canvas=document.createElement('canvas');canvas.width=width;canvas.height=h;
   const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}"><foreignObject width="${width}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml" style="${typography}color:white;">${escape(value)}</div></foreignObject></svg>`;
   const image=new document.defaultView.Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
   try{await image.decode();canvas.getContext('2d').drawImage(image,0,0);return canvas;}catch(error){onError(error);throw error;}
  },
  read:()=>({width,height,text:input.value,editing:!burning||document.activeElement===input,transform:input.style.transform}),
  dispose(){if(disposed)return;disposed=true;observer.disconnect();input.removeEventListener('input',edit);input.removeEventListener('focus',present);input.removeEventListener('blur',present);input.classList.remove('kiln-prompt-input');if(priorStyle===null)input.removeAttribute('style');else input.setAttribute('style',priorStyle);input.placeholder=priorPlaceholder;if(after?.parentNode===home)home.insertBefore(input,after);else home.append(input);mirror.remove();layer.remove();object.visible=true;},
 };
}
