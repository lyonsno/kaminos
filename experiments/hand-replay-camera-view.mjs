import {Group,Sprite,SpriteMaterial,CanvasTexture,SRGBColorSpace,Mesh,PlaneGeometry,MeshBasicMaterial,DoubleSide} from '../lib/three.core.js';
import {projectHand,projectionSupport,commonImageBox,maskDisagreement} from './hand-replay-projection.mjs';
// The existing shared renderer displays camera-projected silhouette textures.
// A filled triangle union gives exact projected mesh coverage, including self overlap.
export async function createCameraComparison(scene,document,labelTexture){
 const N=640,root=new Group(),cards=[],planes=[],timeLabels=[],timeRoot=new Group();root.add(timeRoot);
 const canvas=()=>{const c=document.createElement('canvas');c.width=c.height=N;return c;};
 const sprite=(c)=>{const texture=new CanvasTexture(c);texture.colorSpace=SRGBColorSpace;const s=new Sprite(new SpriteMaterial({map:texture,depthTest:false,depthWrite:false,toneMapped:false}));return {canvas:c,texture,sprite:s};};
 const label=text=>{const s=new Sprite(new SpriteMaterial({map:labelTexture(text),depthTest:false}));s.scale.set(1.9,.238,1);return s;};
 for(let i=0;i<4;i++){const card=sprite(canvas());card.sprite.position.set(-3+i*2,4.7,0);card.sprite.scale.set(1.9,1.9,1);root.add(card.sprite);card.label=label('');card.label.position.set(-3+i*2,5.83,0);root.add(card.label);cards.push(card);}
 await scene.attach(root,{owned:true,metadata:{label:'Recorded camera silhouettes and disagreement',type:'hand-camera-comparison'}});
 let data,images,pair=[],box,cache=new Map(),mode='camera',sourceMode='crop',opacity=.55;
 const disposeTexture=o=>{o.texture?.dispose();o.sprite?.material?.dispose();};
 const clearPlanes=()=>{for(const p of planes){timeRoot.remove(p.sprite);p.sprite.geometry?.dispose();disposeTexture(p);}planes.length=0;for(const l of timeLabels){timeRoot.remove(l);l.material.map?.dispose();l.material.dispose();}timeLabels.length=0;};
 const reset=()=>{clearPlanes();cache.clear();};
 const support=()=>{
  if(!data)return {available:false,reason:'no recorded sequence'};
  if(pair.length!==2||pair.some(i=>i<0))return {available:false,reason:'camera comparison requires two identified models'};
  const observed=data.frames.flatMap(f=>pair.map(i=>f.hands[i])).filter(h=>h.status==='observed');
  if(!observed.length)return {available:false,reason:'no observed predictions'};
  if(data.frames.some(f=>pair.some(i=>f.hands[i].status==='observed'&&f.hands[i].camera&&f.hands[i].camera.sourceCaptureId!==f.captureId)))return {available:false,reason:'camera capture identity mismatch'};
  const bad=observed.map(projectionSupport).find(s=>!s.available);if(bad)return bad;
  const size=observed[0].camera.imageSize;if(observed.some(h=>h.camera.imageSize.some((v,k)=>v!==size[k])))return {available:false,reason:'source camera image sizes disagree'};
  if(images.some(im=>(im.naturalWidth??im.width)!==size[0]||(im.naturalHeight??im.height)!==size[1]))return {available:false,reason:'source camera metadata does not match recorded image size'};
  return {available:true,imageSize:size,methods:pair.map(i=>data.frames.find(f=>f.hands[i].status==='observed')?.hands[i].camera.method??'unavailable'),crop:commonImageBox(data.frames,pair[0],size)};
 };
 const updateBox=()=>{const s=support();box=s.available?(sourceMode==='full'?[0,0,...s.imageSize]:s.crop):null;reset();};
 const point=v=>{const fit=N/Math.max(box[2]-box[0],box[3]-box[1]);return [(N-(box[2]-box[0])*fit)/2+(v[0]-box[0])*fit,(N-(box[3]-box[1])*fit)/2+(v[1]-box[1])*fit];};
 const photo=(ctx,im)=>{ctx.clearRect(0,0,N,N);ctx.fillStyle='#303844';ctx.fillRect(0,0,N,N);const fit=N/Math.max(box[2]-box[0],box[3]-box[1]);ctx.drawImage(im,(N-(box[2]-box[0])*fit)/2-box[0]*fit,(N-(box[3]-box[1])*fit)/2-box[1]*fit,(im.naturalWidth??im.width)*fit,(im.naturalHeight??im.height)*fit);};
 const raster=(h,faces)=>{
  if(h.status!=='observed')return null;
  const p=projectHand(h),c=canvas(),ctx=c.getContext('2d');ctx.fillStyle='white';
  for(const face of faces){const points=face.map(i=>point(p.vertices[i]));ctx.beginPath();ctx.moveTo(...points[0]);ctx.lineTo(...points[1]);ctx.lineTo(...points[2]);ctx.closePath();ctx.fill();}
  const pixels=ctx.getImageData(0,0,N,N).data,mask=new Uint8Array(N*N);for(let i=0;i<mask.length;i++)mask[i]=pixels[i*4+3]>0?255:0;
  return {canvas:c,mask,projected:p,pixels:mask.reduce((sum,v)=>sum+(v?1:0),0)};
 };
 const frame=index=>{
  if(cache.has(index))return cache.get(index);
  const f=data.frames[index],masks=pair.map(mi=>raster(f.hands[mi],data.models[mi].faces));
  const diff=masks.every(Boolean)?maskDisagreement(masks[0].mask,masks[1].mask):null;
  let differenceCanvas;if(diff){differenceCanvas=canvas();const ctx=differenceCanvas.getContext('2d'),im=ctx.createImageData(N,N);im.data.set(diff.rgba);ctx.putImageData(im,0,0);}
  const value={masks,diff,differenceCanvas};cache.set(index,value);return value;
 };
 const setLabel=(card,text)=>{card.label.material.map?.dispose();card.label.material.map=labelTexture(text);card.label.material.needsUpdate=true;};
 const warning=(ctx,text)=>{ctx.fillStyle='rgba(20,25,35,.9)';ctx.fillRect(0,N*.77,N,N*.23);ctx.fillStyle='#ffbd77';ctx.font='24px system-ui';ctx.fillText('Prediction unavailable',18,N*.84);ctx.font='18px system-ui';ctx.fillText(text.slice(0,65),18,N*.91);};
 const draw=(index,newMode=mode,newSource=sourceMode,newOpacity=opacity)=>{
  mode=newMode;opacity=newOpacity;if(newSource!==sourceMode){sourceMode=newSource;updateBox();}
  const s=support();root.visible=s.available&&mode!=='spatial';if(!root.visible)return;
  const f=data.frames[index],r=frame(index);timeRoot.visible=mode==='time';
  for(const c of cards)c.sprite.visible=c.label.visible=mode==='camera';
  if(mode==='camera'){
   cards.forEach(c=>photo(c.canvas.getContext('2d'),images[index]));setLabel(cards[0],'Recorded camera');
   for(let k=0;k<2;k++){
    const c=cards[k+1],ctx=c.canvas.getContext('2d'),h=f.hands[pair[k]];setLabel(c,data.models[pair[k]].label);
    if(r.masks[k]?.pixels){
     const colored=canvas(),cc=colored.getContext('2d');cc.drawImage(r.masks[k].canvas,0,0);cc.globalCompositeOperation='source-in';cc.fillStyle=k?'#ff963c':'#2dbeff';cc.fillRect(0,0,N,N);ctx.globalAlpha=opacity;ctx.drawImage(colored,0,0);ctx.globalAlpha=1;
    }else warning(ctx,r.masks[k]?'Projected mesh is outside view':h.reason??'not observed');
   }
   const dc=cards[3].canvas.getContext('2d');setLabel(cards[3],'Silhouette disagreement');if(r.diff){dc.globalAlpha=.9;dc.drawImage(r.differenceCanvas,0,0);dc.globalAlpha=1;}else warning(dc,'Both predictions are required');
   for(const c of cards)c.texture.needsUpdate=true;
  }else if(!planes.length){
   for(let i=0;i<data.frames.length;i++){
    const r=frame(i);if(!r.diff)continue;const texture=new CanvasTexture(r.differenceCanvas);texture.colorSpace=SRGBColorSpace;const p={texture,sprite:new Mesh(new PlaneGeometry(1,1),new MeshBasicMaterial({map:texture,transparent:true,opacity:.16,depthWrite:false,side:DoubleSide,toneMapped:false}))};p.index=i;p.sprite.position.set(0,4.6,-(data.frames[i].timeMs-data.frames[0].timeMs)/1000*2);p.sprite.scale.set(3.6,3.6,1);p.sprite.material.opacity=.16;timeRoot.add(p.sprite);planes.push(p);
   }
   for(const i of [0,data.frames.length-1]){const seconds=(data.frames[i].timeMs-data.frames[0].timeMs)/1000;const l=label(seconds.toFixed(2)+' s');l.position.set(-2,4.8,-seconds*2);l.scale.set(1,.125,1);timeRoot.add(l);timeLabels.push(l);}
  }
  for(const p of planes)p.sprite.material.opacity=p.index===index?.85:.12;
 };
 return {load(next,nextImages,nextPair){data=next;images=nextImages;pair=nextPair;updateBox();const s=support();setLabel(cards[0],'Recorded camera');return s;},draw,support,read(index){const s=support();return {...s,box,counts:s.available?frame(index).diff?.counts??null:null,projectedPixels:s.available?frame(index).masks.map(m=>m?.pixels??null):[],comparison:'model disagreement, not ground-truth error',placement:'native camera where supplied; fitted translation where explicitly declared',pairedFrames:s.available?data.frames.filter(f=>pair.every(i=>f.hands[i]?.status==='observed')).length:0,totalFrames:data?.frames.length??0,timeAxis:'recorded elapsed seconds into depth; missing comparisons omitted'};},clear(){root.visible=false;data=null;reset();},dispose(){reset();cards.forEach(disposeTexture);}};
}
