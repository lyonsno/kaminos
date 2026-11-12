import * as THREE from '../lib/three.webgpu.js';
import {loadNeumipModel} from '../neumip-model.mjs';
import {loadStoneHandoffModel} from '../stone-handoff-model.mjs';
import {createNeumipMaterial} from '../neumip-material.mjs';
import {stoneWindowDisplayPositions} from '../stone-material-window.mjs';
function plane(domain){
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([-.08,0,-.04,-.08,0,.04,.08,0,.04,-.08,0,-.04,.08,0,.04,.08,0,-.04],3));
 g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,0,1,1,1,0,0,1,1,1,0],2));g.setIndex([0,1,2,3,4,5]);g.computeVertexNormals();g.computeTangents();return g;
}
export default {id:'shoulder-strip',title:'Marked shoulder: parallax / PBR handoff',
 async create({host,inputs={},record,updateInputs=()=>{}}){
  if(!inputs.sourceURL)throw Error('This study requires its retained source URL');
  const response=await fetch(inputs.sourceURL);if(!response.ok)throw Error('Shoulder source load failed');
  const source=await response.json();if(source.schema!=='kaminos.shoulder-strip-source.v1'||source.config.width!==.16||source.config.depth!==.08)throw Error('Wrong shoulder source');
  const ordinary=inputs.modelURL?await loadNeumipModel(inputs.modelURL,{sha256:inputs.modelSHA}):null,paired=inputs.handoffURL?await loadStoneHandoffModel(inputs.handoffURL,{sha256:inputs.handoffSHA}):null;
  for(const model of [ordinary,paired].filter(Boolean))if(model.chart?.width!==source.chart.width||model.chart?.depth!==source.chart.depth||model.chart?.offsetMeters!==source.chart.offsetMeters||model.chart?.boundary!==source.chart.boundary)throw Error('Model/source chart mismatch');
  if(paired&&JSON.stringify(paired.handoff.routing)!==JSON.stringify(source.routing))throw Error('Model/source routing mismatch');
  let mode=inputs.mode??'source',lod=inputs.lod??0,gain=inputs.residualGain??1,automatic=inputs.automatic??false;
  if(!Number.isFinite(lod)||lod<0||!Number.isFinite(gain)||gain<0||typeof automatic!=='boolean')throw Error('Invalid footprint or residual settings');
  const session=await host.scene.open(),root=new THREE.Group(),objects={},bundles=[],geometries=[],materials=[],drags=[];root.name='Marked 16 × 8 cm shoulder';
  const mesh=(g,m)=>{geometries.push(g);materials.push(m);return new THREE.Mesh(g,m);};
  const explicit=new THREE.Group();for(let i=0;i<source.materials.length;i++){const positions=stoneWindowDisplayPositions(source.triangles.filter(t=>t.materialIndex===i),source.captureDomain);if(!positions.length)continue;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();const s=source.materials[i];explicit.add(mesh(g,new THREE.MeshStandardMaterial({color:new THREE.Color(...s.color),roughness:s.roughness,metalness:s.metalness,side:THREE.DoubleSide})));}objects.source=explicit;
  const learned=(model,options={})=>{const b=createNeumipMaterial(model,{uvScale:1,gain:1,lodOverride:automatic?-1:lod,residualGain:gain,...options});bundles.push(b);return mesh(plane(source.captureDomain),b.material);};
  if(ordinary)objects.ordinary=learned(ordinary);
  if(paired){objects.paired=learned(paired);objects.cheap=learned(paired,{richEnabled:false});for(const display of ['residual','weighted-residual','routing'])objects[display]=learned(paired,{display});}
  if(!objects[mode]){for(const g of geometries)g.dispose();for(const m of materials)m.dispose();await session.dispose();throw Error('Requested trained representation unavailable');}
  for(const [key,o]of Object.entries(objects)){o.name=key;root.add(o);}let asset,selector,status,lodInput,gainInput,autoInput,holding=null;
  const view={position:[.13,.16,.21],target:[0,-.004,0],fov:42};
  const read=()=>({schema:'kaminos.shoulder-strip-study.v1',mode,lod,automatic,footprintMM:automatic?null:.16/(ordinary?.offset.width??paired?.offset.width??512)*2**lod*1000,residualGain:gain,source:inputs.sourceURL,chart:source.chart,routing:source.routing,sourceTriangles:source.triangles.length,ordinary:ordinary?.source??null,paired:paired?.source??null,objectId:asset?.id,view:session.readView(),claim:mode==='source'?'Explicit authored diagnostic relief in native raster scene lighting; this view is not the ray-traced training integral.':mode==='routing'?'Footprint-averaged rich weight; white1, black0. It is not a cost measurement.':mode==='residual'||mode==='weighted-residual'?'Signed scene-lit correction. Neutral gray is zero before global display grading. Raw includes unsupervised extrapolation outside routed support.':'Actual fitted directional response under native scene direct lights. Fit quality and handoff quality remain separate questions.',boundary:source.boundary});
  const persist=()=>updateInputs({...inputs,mode,lod,automatic,residualGain:gain});
  const apply=()=>{for(const [key,o]of Object.entries(objects))o.visible=key===mode;for(const b of bundles){b.settings.lodOverride.value=automatic?-1:lod;b.settings.residualGain.value=gain;}if(selector)selector.value=mode;if(status)status.textContent=read().claim;if(autoInput)autoInput.checked=automatic;session.redraw();};
  const changed=kind=>{apply();persist();record({kind:'shoulder-strip.'+kind,phase:'applied',effective:read()});return read();};
  try{asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:inputs.sourceURL,type:'experiment'}});session.setView(inputs.view??view);apply();}catch(e){if(!asset){for(const g of geometries)g.dispose();for(const m of materials)m.dispose();}await session.dispose();throw e;}
  return {read,operations:{setMode(v){if(!objects[v])throw Error('Representation unavailable');mode=v;return changed('mode');},setLOD(v){if(!Number.isFinite(v)||v<0)throw Error('Nonnegative LOD required');lod=v;automatic=false;if(lodInput)lodInput.value=String(v);return changed('footprint');},setAutomatic(v){if(typeof v!=='boolean')throw Error('Automatic must be boolean');automatic=v;return changed('footprint');},setResidualGain(v){if(!Number.isFinite(v)||v<0)throw Error('Nonnegative gain required');gain=v;if(gainInput)gainInput.value=String(v);return changed('residual-gain');},frame(){return session.setView(view);}},
  mount({root:panel,document,invoke}){
   const label=document.createElement('label');label.textContent='Representation ';selector=document.createElement('select');for(const [value,text]of [['source','Explicit marked shoulder'],['ordinary','Ordinary learned parallax'],['paired','PBR + learned residual'],['cheap','Cheap PBR endpoint'],['residual','Raw signed residual'],['weighted-residual','Applied signed residual'],['routing','Rich routing weight']]){const o=document.createElement('option');o.value=value;o.textContent=text;o.disabled=!objects[value];selector.append(o);}selector.value=mode;selector.onchange=()=>invoke('setMode',selector.value);label.append(selector);panel.append(label);
   const number=(text,value,action,step)=>{const l=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=text;input.type='number';input.min='0';input.step='any';input.value=String(value);input.className='transform-input';input.setAttribute('aria-label',text.trim());input.oninput=()=>{if(input.value.trim()&&Number.isFinite(Number(input.value)))invoke(action,Number(input.value)).catch(e=>status.textContent=e.message);};l.append(grip,input);panel.append(l);drags.push(host.controls.installNumberDrag({input,grip,step}));return input;};
   lodInput=number('Footprint LOD ',lod,'setLOD',.1);const hint=document.createElement('p');hint.textContent='LOD0 = 0.3125 mm box; +1 doubles both physical axes. Fixed footprint affects learned views. Source is native raster shading.';panel.append(hint);
   const autoLabel=document.createElement('label');autoInput=document.createElement('input');autoInput.type='checkbox';autoInput.checked=automatic;autoInput.onchange=()=>invoke('setAutomatic',autoInput.checked);autoLabel.append(autoInput,' Follow camera footprint');panel.append(autoLabel);
   gainInput=number('Residual display gain ',gain,'setResidualGain',.1);
   const hold=document.createElement('button');hold.textContent='Hold to inspect source';hold.onpointerdown=e=>{if(holding!==null)return;holding=mode;hold.setPointerCapture(e.pointerId);mode='source';apply();};const release=()=>{if(holding===null)return;mode=holding;holding=null;apply();};hold.onpointerup=release;hold.onpointercancel=release;hold.onlostpointercapture=release;panel.append(hold);
   status=document.createElement('p');status.textContent=read().claim;panel.append(status);const scope=document.createElement('p');scope.textContent='Bounded 16 × 8 cm study with surrounding teacher geometry. Grid is albedo; chip, bump and groove are geometry. This is an authored diagnostic, not realistic stone. Same camera and native scene lights for every representation.';panel.append(scope);
  },async dispose(){for(const d of drags)d.dispose();await session.dispose();}};
 }
};
