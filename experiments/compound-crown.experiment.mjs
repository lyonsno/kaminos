import {crownRecipe,evaluateCrown} from './compound-crown/mechanism.mjs';
import {createCrownView} from './compound-crown/view.mjs';
export default{
 id:'compound-crown',title:'Compound Crown · articulated burner',
 async create({host,inputs,record}){
  let recipe=crownRecipe(inputs.recipe??inputs),pose=evaluateCrown(recipe),disposed=false;
  const session=await host.scene.open(),view=createCrownView(recipe);
  if(inputs.transform){view.root.position.fromArray(inputs.transform.position??[0,0,0]);view.root.rotation.fromArray(inputs.transform.rotation??[0,0,0]);view.root.scale.fromArray(inputs.transform.scale??[1,1,1]);}
  let asset;try{asset=await session.attach(view.root,{owned:true,metadata:{label:'Compound Crown',type:'experiment',source:'compound-crown:authored-kinematic-v1'}});}catch(error){view.dispose();await session.dispose();throw error;}
  const fields=new Map(),drags=[];let ownerDocument,status,link,playingButton,seating,elapsed=0;
  const read=()=>({objectId:asset.id,recipe:{...recipe},clearRadius:pose.clearRadius,ringAngle:pose.ringAngle,
   parts:{vanes:pose.vanes.length,leaves:pose.leaves.length,families:view.root.userData.partFamilies},
   transform:{position:view.root.position.toArray(),rotation:view.root.rotation.toArray().slice(0,3),scale:view.root.scale.toArray()},
   coupling:pose.coupling});
  const sync=()=>{
   for(const [key,input]of fields)if(ownerDocument.activeElement!==input||input.readOnly)input.value=String(recipe[key]);
   if(status)status.textContent='Clear opening Ø '+(2*pose.clearRadius).toFixed(2)+' · '+recipe.vaneCount+' vanes / '+recipe.irisCount+' leaves';
   if(playingButton)playingButton.textContent=recipe.playing?'Pause motion':'Run motion';
   if(link){const url=new URL(ownerDocument.defaultView.location.href);url.searchParams.set('experiment','compound-crown');url.searchParams.set('experiment_inputs',JSON.stringify({recipe:{...recipe,playing:false},transform:read().transform}));link.href=url.href;}
  };
  function set(patch){if(disposed)throw Error('Compound Crown is closed');const next=crownRecipe({...recipe,...patch});pose=view.update(next);recipe=next;host.scene.refreshPresentation?.(asset);session.redraw();sync();const effective=read();record({kind:'compound-crown.edit',phase:'applied',target:asset.id,requested:patch,effective});return effective;}
  const unsubscribe=session.onFrame(({deltaSeconds})=>{
   if(!recipe.playing||disposed)return;elapsed+=Math.max(0,deltaSeconds??0);const phase=elapsed*recipe.rate*2*Math.PI;
   recipe={...recipe,opening:.5+.48*Math.sin(phase),swirl:.9*Math.sin(phase*.73+.5)};pose=view.update(recipe);session.redraw();sync();
  });
  return{
   read,
   operations:{set,frame(){host.scene.frame([view.root]);return session.readView();},recipe(){return read();}},
   mount({root:entryRoot,document,invoke}){
    const root=document.createElement('section');
    const hint=document.createElement('p');hint.textContent='Select Compound Crown to operate its drives in Properties.';entryRoot.append(hint);
    ownerDocument=document;const heading=document.createElement('h3');heading.textContent='Compound Crown';root.append(heading);
    const note=document.createElement('p');note.textContent='Independent iris and linked vane motion. Flame-source coupling is the next composition.';root.append(note);
    for(const [key,label,min,max,step]of [['opening','Iris opening',0,1,.01],['swirl','Vane drive',-1,1,.01],['vaneCount','Vanes',3,undefined,1],['irisCount','Iris leaves',3,undefined,1],['rate','Cycles / second',0,undefined,.01]]){
     const row=document.createElement('label');row.style.cssText='display:flex;align-items:center;gap:10px;margin:8px 0';const grip=document.createElement('span');grip.textContent=label;grip.style.flex='1';
     const input=document.createElement('input');input.type='number';input.className='transform-input';input.min=String(min);if(max!==undefined)input.max=String(max);input.step=String(step);input.value=String(recipe[key]);input.setAttribute('aria-label',label);input.style.width='100px';
     input.addEventListener('input',()=>{if(!input.value.trim()||!Number.isFinite(Number(input.value)))return;invoke('set',{[key]:Number(input.value)}).catch(e=>{status.textContent=e.message;});});
     input.addEventListener('blur',sync);row.append(grip,input);root.append(row);fields.set(key,input);drags.push(host.controls.installNumberDrag({input,grip,step}));
    }
    playingButton=document.createElement('button');playingButton.type='button';playingButton.addEventListener('click',()=>invoke('set',{playing:!recipe.playing}));
    const frame=document.createElement('button');frame.type='button';frame.textContent='Frame apparatus';frame.addEventListener('click',()=>invoke('frame'));
    status=document.createElement('p');status.setAttribute('role','status');link=document.createElement('a');link.textContent='Reopen this setup';link.style.display='block';for(const event of ['pointerenter','focus','click'])link.addEventListener(event,sync);
    for(const button of [playingButton,frame])button.style.cssText='background:#2b2f34;color:#ddd;border:1px solid #525860;border-radius:4px;padding:6px 9px;margin:4px 6px 4px 0;cursor:pointer';
    root.append(playingButton,frame,status,link);seating=host.controls.mountObject({asset,properties:root});host.scene.select(asset.id);sync();
   },
   async dispose(){disposed=true;unsubscribe();for(const drag of drags)drag.dispose();seating?.dispose();await session.dispose();view.dispose();},
  };
 },
};
