import * as THREE from '../lib/three.webgpu.js';
import {createCausewaySource,validateCausewayConfig} from '../causeway-source.mjs';
import {createCausewayDisplay} from '../causeway-display.mjs';
import {loadNeumipModel} from '../neumip-model.mjs';
import {createNeumipMaterial} from '../neumip-material.mjs';

export default {id:'causeway',title:'Giant’s Cosplay — shallow columnar stone',
 async create({host,inputs={},record,updateInputs=()=>{}}){
  if(inputs.mode!==undefined&&!['source','learned'].includes(inputs.mode))throw Error('Invalid causeway representation');
  let config=validateCausewayConfig(inputs.source),source,displayed={...config},mode='source',lod=inputs.lod??0,cutaway=inputs.cutaway??false,pending=false,error=null,timer;
  if(!Number.isFinite(lod)||lod<0)throw Error('Nonnegative footprint required');
  const model=inputs.modelURL?await loadNeumipModel(inputs.modelURL,{sha256:inputs.modelSHA}):null;
  if(model&&(model.chart?.width!==config.width||model.chart?.depth!==config.depth||model.chart?.offsetMeters!==.004||model.chart?.boundary!=='repeat'))throw Error('Model/source chart mismatch');
  const fitSource=validateCausewayConfig(inputs.fitSource??inputs.source),fittedConfig=JSON.stringify(fitSource);
  const session=await host.scene.open(),root=new THREE.Group(),explicit=new THREE.Group(),drags=[],controls=new Map();
  root.name='Giant’s Cosplay — shallow basalt columns';root.add(explicit);
  const palette=[];
  let bundle,learned,asset,status,selector,disposed=false,buildCount=0,registration=null;
  const modelMatches=()=>model&&JSON.stringify(displayed)===fittedConfig;
  const rebuild=()=>{
   clearTimeout(timer);if(disposed)return;
   try{
    const next=createCausewaySource(config),display=createCausewayDisplay(next,{cutaway});
    if(!palette.length)palette.push(...next.materials.map(s=>new THREE.MeshStandardMaterial({color:new THREE.Color(...s.color),roughness:s.roughness,metalness:s.metalness,side:THREE.DoubleSide})));
    const children=[];
    const tile=(g,material)=>{if(cutaway)return new THREE.Mesh(g,material);const m=new THREE.InstancedMesh(g,material,9),matrix=new THREE.Matrix4();let k=0;for(let z=-1;z<=1;z++)for(let x=-1;x<=1;x++)m.setMatrixAt(k++,matrix.makeTranslation(x*next.config.width,0,z*next.config.depth));m.instanceMatrix.needsUpdate=true;m.computeBoundingSphere();return m;};
    for(let i=0;i<display.byMaterial.length;i++){const p=display.byMaterial[i];if(!p.length)continue;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.computeVertexNormals();const m=tile(g,palette[i]);m.name=next.materials[i].name;children.push(m);}
    if(display.sections.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(display.sections,3));g.computeVertexNormals();const cap=new THREE.Mesh(g,palette[16]);cap.name='Display-only stone section faces';cap.userData.causewaySection=true;children.push(cap);}
    for(const child of [...explicit.children]){explicit.remove(child);child.geometry.dispose();}
    explicit.add(...children);source=next;displayed={...config};pending=false;error=null;buildCount++;
    if(mode==='learned'&&!modelMatches())mode='source';apply();
   }catch(e){pending=false;error=e.message;apply();throw e;}
  };
  const view={position:[.31,.36,.38],target:[0,-.002,0],fov:42,zoom:.95};
  const read=()=>({schema:'kaminos.causeway-study.v1',mode,config:{...config},displayedConfig:{...displayed},pending,error,buildCount,cutaway,displayRepeats:cutaway?1:9,columns:source.columns.length,sourceTriangles:source.triangles.length,chart:source.chart,referenceHeight:source.referenceHeight,model: model?.source??null,modelMatches:!!modelMatches(),registration,lod,objectId:asset?.id,view:session.readView(),claim:mode==='source'?'Authored column geometry in native scene raster lighting; this is not the ray-traced teacher integral.':'Learned directional response on a flat carrier; source geometry is hidden.',boundary:source.boundary});
  const persist=()=>updateInputs({...inputs,source:{...config},cutaway,...(model?{fitSource}:{}),mode,lod});
  const apply=()=>{explicit.visible=mode==='source';if(learned)learned.visible=mode==='learned';if(bundle)bundle.settings.lodOverride.value=lod;if(selector){selector.value=mode;selector.options[1].disabled=!modelMatches();}if(status)status.textContent=error??(pending?'Updating geometry…':read().claim);session.redraw();};
  const event=kind=>{persist();record({kind:'causeway.'+kind,phase:'applied',effective:read()});return read();};
  try{
   rebuild();
   if(model){const g=new THREE.PlaneGeometry(config.width,config.depth);g.rotateX(-Math.PI/2);g.computeTangents();bundle=createNeumipMaterial(model,{uvScale:1,gain:1,lodOverride:lod});learned=new THREE.Mesh(g,bundle.material);learned.name='Learned flat carrier';root.add(learned);}
   if(inputs.mode==='learned'){if(!modelMatches())throw Error('Requested learned material does not match source');mode='learned';}
   asset=await session.attach(root,{owned:true,metadata:{label:root.name,type:'experiment',source:'causeway-source.mjs',sourceConfig:config}});session.setView(inputs.view??view);apply();
  }catch(e){for(const child of explicit.children)child.geometry.dispose();for(const m of palette)m.dispose();learned?.geometry.dispose();bundle?.material.dispose();await session.dispose();throw e;}
  const operations={
   async registerTraining({path}){
    if(pending)rebuild();
    const response=await fetch('/api/neural-material-sources',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,recipe:{sourceKind:'causeway',source:{...displayed},trainingRecipe:'author-web-spatial-v1',receiver:'grazing-angle-gooch-goblin',fit:{resolution:512,steps:30000,batch:2048,samples:8,bounces:2}}})});
    const result=await response.json();if(!response.ok)throw Error(result.error??'Source registration failed');registration=result;event('registered');if(status)status.textContent='Training source saved: '+result.path;return result;
   },
   setShape({key,value}){
    if(!['relief','shoulder','dish','grain','sheetGap','slant','layoutJitter'].includes(key)||!Number.isFinite(value))throw Error('Invalid causeway setting');
    config=validateCausewayConfig({...config,[key]:Math.max(0,value)});pending=true;
    if(controls.has(key))controls.get(key).input.value=String(config[key]*controls.get(key).scale);
    clearTimeout(timer);timer=setTimeout(()=>{try{rebuild();event('source');}catch{}},140);apply();persist();return read();
   },
   setCutaway(value){if(typeof value!=='boolean')throw Error('Cutaway must be boolean');cutaway=value;pending=true;rebuild();return event('presentation');},
   flush(){if(!pending)return read();rebuild();return event('source');},
   setMode(value){if(!['source','learned'].includes(value)||value==='learned'&&!modelMatches())throw Error('Requested representation unavailable for displayed source');mode=value;apply();return event('mode');},
   setLOD(value){if(!Number.isFinite(value)||value<0)throw Error('Nonnegative footprint required');lod=value;apply();return event('footprint');},
   frame(){return session.setView(view);}
  };
  return {read,operations,mount({root:panel,document,invoke}){
   const label=document.createElement('label');label.textContent='Representation ';selector=document.createElement('select');for(const [value,text]of [['source','Explicit column geometry'],['learned','Learned parallax material']]){const option=document.createElement('option');option.value=value;option.textContent=text;selector.append(option);}selector.onchange=()=>invoke('setMode',selector.value);label.append(selector);panel.append(label);
   for(const [key,text,scale,step]of [['relief','Relief (mm)',1000,.1],['sheetGap','Reference gap (mm)',1000,.05],['shoulder','Shoulder retreat (%)',100,.5],['dish','Top dishing (%)',100,.5],['grain','Mineral relief (%)',100,.1],['slant','Coupled top slant (% relief)',100,.5],['layoutJitter','Layout irregularity (%)',100,.5]]){
    const l=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=text+' ';input.type='number';input.min='0';input.step='any';input.value=String(config[key]*scale);input.className='transform-input';input.setAttribute('aria-label',text);input.oninput=()=>{if(input.value.trim()&&Number.isFinite(Number(input.value)))invoke('setShape',{key,value:Number(input.value)/scale}).catch(e=>{input.value=String(config[key]*scale);status.textContent=e.message;});};l.append(grip,input);panel.append(l);controls.set(key,{input,scale});drags.push(host.controls.installNumberDrag({input,grip,step}));
   }
   const footprint=document.createElement('label'),f=document.createElement('input');footprint.textContent='Learned footprint LOD ';f.type='number';f.min='0';f.step='any';f.value=String(lod);f.setAttribute('aria-label','Learned footprint LOD');f.oninput=()=>{if(f.value.trim()&&Number.isFinite(Number(f.value)))invoke('setLOD',Number(f.value)).catch(e=>status.textContent=e.message);};footprint.append(f);panel.append(footprint);
   const cutLabel=document.createElement('label'),cut=document.createElement('input');cut.type='checkbox';cut.checked=cutaway;cut.onchange=()=>invoke('setCutaway',cut.checked);cutLabel.append(cut,' Faced cutaway (one tile)');panel.append(cutLabel);
   status=document.createElement('p');panel.append(status);
   const recipeLabel=document.createElement('label'),recipePath=document.createElement('input'),register=document.createElement('button');recipeLabel.textContent='Training source file ';recipePath.value=inputs.registrationPath??'causeway/tuned.json';recipePath.setAttribute('aria-label','Training source file');recipeLabel.append(recipePath);register.textContent='Register for training';register.onclick=()=>invoke('registerTraining',{path:recipePath.value}).catch(e=>status.textContent=e.message);panel.append(recipeLabel,register);
const note=document.createElement('p');note.textContent='A shared polygonal layout with separate retreating shoulders, dished tops, side bands and small mineral facets. Shown as a square repeat; Cutaway adds display-only section faces. Geometry controls update live after a brief debounce. Changing the source disables a mismatched trained comparison. Authored approximation; no cooling or fracture simulation.';panel.append(note);apply();
  },async dispose(){disposed=true;clearTimeout(timer);for(const d of drags)d.dispose();for(const child of explicit.children)child.geometry.dispose();for(const m of palette)m.dispose();learned?.geometry.dispose();bundle?.material.dispose();await session.dispose();}};
 }
};
