// Selected-object controls use the same operations as the scene API.
export function mountCrystalInspector({document,root,read,invoke,installNumberDrag}){
 const fields=new Map();let draft=false;
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(tag==='button')n.className='btn';return n;};
 const status=el('p');status.setAttribute('role','status');
 const act=(op,value)=>{try{const result=invoke(op,value);Promise.resolve(result).then(sync,e=>{status.textContent=e.message;});}catch(e){status.textContent=e.message;}};
 root.append(el('h3','Crystal growth'));
 const play=el('button','Grow');play.type='button';play.onclick=()=>act('play',!read().playing);root.append(play);
 const numeric=(key,label,help,operation='conditions',step=.01)=>{
  const row=el('label'),grip=el('span',label),input=el('input');row.style.cssText='display:flex;gap:6px;align-items:center;margin:10px 0';input.type='number';input.min='0';input.step='any';input.className='transform-input';input.style.cssText='min-width:0;flex:1';input.setAttribute('aria-label',label);input.title=grip.title=help;
  input.oninput=()=>{if(input.value.trim()&&Number.isFinite(Number(input.value)))act(operation,operation==='conditions'?{[key]:Number(input.value)}:Number(input.value));};row.append(grip,input);root.append(row);fields.set(key,input);installNumberDrag?.({input,grip,step});
 };
 numeric('rate','Evolution speed','Model seconds requested per real second. Queued time is retained when the solver falls behind.','rate',.1);
 numeric('feed','Brine feed','Incoming liquid per model second. Also brings salt at feed salinity.');
 numeric('salinity','Feed salinity','Salt per incoming liquid volume; saturation is 1. Existing liquid is unchanged.');
 numeric('evaporation','Evaporation','Liquid removed per wetted exposed area per model second.');
 const more=el('details');more.append(el('summary','Growth and birth'));
 for(const [key,label,help]of [['growth','Face growth','Converts local dissolved excess into face advance.'],['mobility','Capillary mobility','Effective inverse resistance of film tracks. Useful ranges remain exploratory.'],['nucleation','Crystal birth','Birth rate from wet area and supersaturation; zero disables new grains.'],['barrier','Birth supersaturation','Birth threshold; must be at least 1.']]){numeric(key,label,help);more.append(root.lastChild);}root.append(more);
 const layout=el('select');layout.setAttribute('aria-label','Crystal seed layout');for(const [v,t]of [['neighbors','Five neighbors'],['arcs','Nested arcs'],['spiral','Spiral']]){const o=el('option',t);o.value=v;layout.append(o);}
 const lean=el('input');lean.type='number';lean.min='0';lean.step='any';lean.className='transform-input';lean.setAttribute('aria-label','Crystal seed lean');
 const leanLabel=el('label','Seed lean (degrees) ');leanLabel.append(lean);layout.onchange=lean.oninput=()=>{draft=true;};
 const restart=el('button','Restart layout');restart.type='button';restart.onclick=()=>{act('seedLayout',{arrangement:layout.value,tilt:Number(lean.value)*Math.PI/180});draft=false;};installNumberDrag?.({input:lean,grip:leanLabel,step:1});root.append(layout,leanLabel,restart,el('p','Restart layout keeps a checkpoint. Supply edits affect future growth; existing material keeps its history.'));
 const toggles=[];for(const [key,label]of [['interfaces','Show liquid–air fronts'],['substrate','Show substrate']]){const row=el('label'),box=el('input');box.type='checkbox';box.onchange=()=>act(key,box.checked);row.append(box,document.createTextNode(label));root.append(row);toggles.push([key,box]);}
 for(const [label,op]of [['Store checkpoint','remember'],['Return to checkpoint','returnToCheckpoint'],['Restart growth','restart']]){const b=el('button',label);b.type='button';b.onclick=()=>act(op);root.append(b);}
 const load=el('input');load.type='file';load.accept='.json,application/json';load.setAttribute('aria-label','Load crystal checkpoint');load.onchange=async()=>{try{if(load.files[0])act('restore',JSON.parse(await load.files[0].text()));}catch(e){status.textContent=e.message;}};root.append(load,status);
 function sync(){const s=read();play.textContent=s.playing?'Hold growth':'Grow';for(const [key,input]of fields)if(document.activeElement!==input)input.value=key==='rate'?s.rate:s.settings[key];if(!draft){layout.value=s.arrangement??'neighbors';lean.value=Number(((s.tilt??0)*180/Math.PI).toFixed(3));}for(const[key,box]of toggles)box.checked=s[key];status.textContent=s.error?`Growth stopped: ${s.error}`:`${s.time.toFixed(1)} model s · ${s.grains} crystals · ${s.clock.pendingModelSeconds.toFixed(1)} model s queued`;}
 sync();return {sync,dispose(){root.replaceChildren();}};
}
