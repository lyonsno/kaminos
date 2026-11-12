import {loadStoneHandoffModel} from '../stone-handoff-model.mjs';
import * as THREE from '../lib/three.webgpu.js';
import {uv,wgslFn} from '../lib/three.tsl.js';
import {createStoneTransitionSource} from '../stone-transition-source.mjs';
import {stoneHandoffQuads} from '../stone-handoff-geometry.mjs';
import {loadNeumipModel} from '../neumip-model.mjs';
import {createNeumipMaterial} from '../neumip-material.mjs';
import {stoneMaterialWindow,stoneWindowQuads,stoneWindowDisplayPositions} from '../stone-material-window.mjs';

function geometry(quads,config){
 const positions=[],uvs=[];
 for(const [a,b,c,d]of quads)for(const [u,v]of [[a,b],[a,d],[c,d],[a,b],[c,d],[c,b]]){positions.push((u-.5)*config.width,0,(v-.5)*config.depth);uvs.push(u,v);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(Array.from({length:positions.length/3},(_,i)=>i));g.computeVertexNormals();g.computeTangents();return g;
}
export default {
 id:'stone-handoff',title:'Stone PBR / neural handoff',
 async create({host,inputs={},record,updateInputs=()=>{}}){
  if(!inputs||typeof inputs!=='object'||Array.isArray(inputs))throw Error('Stone comparison inputs must be an object');
  let mode=inputs.mode??'source',collar=inputs.collar??.04,residualGain=inputs.residualGain??1;
  if(!Number.isFinite(residualGain)||residualGain<0)throw Error('Residual gain must be finite and nonnegative');
  const pairedModes=['paired','cheap','residual','weighted-residual','routing'];
  const source=stoneMaterialWindow(createStoneTransitionSource({...inputs.source,halo:0}),inputs.window);
  const support=stoneHandoffQuads(source.config,{collar});
  support.quads=stoneWindowQuads(support.quads,source.window);
  support.areaFraction=support.quads.reduce((sum,[a,b,c,d])=>sum+(c-a)*(d-b),0);
  const domain=source.captureDomain??source.config,frameScale=source.window?.uvScale??1;
  const framedView={position:[4.3*frameScale,3.4*frameScale,4.6*frameScale],target:[0,-.04,0],fov:42};
  if(!['source','pbr','neural','overlap-control',...pairedModes].includes(mode))throw Error('Unknown stone view');
  let model,pairedModel;if(inputs.modelURL)model=await loadNeumipModel(inputs.modelURL,{sha256:inputs.modelSHA});if(inputs.handoffURL)pairedModel=await loadStoneHandoffModel(inputs.handoffURL,{sha256:inputs.handoffSHA});
  if(pairedModes.includes(mode)&&!pairedModel)throw Error('Paired view requires a trained handoff artifact');
  if(pairedModel&&(source.window||pairedModel.handoff.routing.width!==domain.width||pairedModel.handoff.routing.depth!==domain.depth||pairedModel.handoff.routing.inner!==Math.max(source.config.margin,source.config.bevel)||pairedModel.handoff.routing.collar!==collar))throw Error('Paired model routing does not match the displayed source domain');
  if(['neural','overlap-control'].includes(mode)&&!model)throw Error('This view requires an actual fitted model URL');
  const session=await host.scene.open(),root=new THREE.Group();root.name='Stone parallax handoff';
  const objects={},materials=[],geometries=[],diagnostics=[];
  const ownMesh=(name,g,m)=>{const mesh=new THREE.Mesh(g,m);mesh.name=name;mesh.receiveShadow=true;materials.push(m);geometries.push(g);return mesh;};
  const explicit=new THREE.Group();
  for(let index=0;index<source.materials.length;index++){
   const ts=source.triangles.filter(t=>t.materialIndex===index),positions=source.window?stoneWindowDisplayPositions(ts,domain):ts.flatMap(t=>[...t.a,...t.b,...t.c]);if(!positions.length)continue;
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();
   const m=source.materials[index];explicit.add(ownMesh(m.name,g,new THREE.MeshStandardMaterial({color:new THREE.Color(...m.color),roughness:m.roughness,metalness:m.metalness,side:THREE.DoubleSide})));
  }
  objects.source=explicit;
  const pbr=()=>new THREE.MeshStandardNodeMaterial({color:new THREE.Color(...source.materials[0].color),roughness:source.materials[0].roughness,metalness:0,side:THREE.DoubleSide});
  const plane=()=>geometry([[0,0,1,1]],domain);
  objects.pbr=ownMesh('Flat PBR endpoint',plane(),pbr());
  if(model){
   const full=createNeumipMaterial(model,{uvScale:1,gain:1});objects.neural=ownMesh('Full ordinary NeuMIP',plane(),full.material);
   const overlap=new THREE.Group();overlap.name='Output-fade control, not learned bridge';overlap.add(ownMesh('Native PBR underlay',plane(),pbr()));
   const rich=createNeumipMaterial(model,{uvScale:1,gain:1});rich.material.transparent=true;rich.material.depthWrite=false;rich.material.forceSinglePass=true;
   // Both layers describe the same carrier. Bias the overlay's raster depth so
   // subdivided support cannot lose coplanar pixels to the PBR underlay.
   rich.material.polygonOffset=true;rich.material.polygonOffsetFactor=-1;rich.material.polygonOffsetUnits=-1;
   const width=source.config.width,depth=source.config.depth,inner=Math.max(source.config.margin,source.config.bevel),outer=inner+collar;
   const origin=source.window?.uvOrigin??[0,0],scale=source.window?.uvScale??1;
   const code=`fn stoneHandoffWeight(p:vec2<f32>)->f32{let original=vec2<f32>(${origin[0]},${origin[1]})+p*${scale};let f=fract(original*2.0);let d=min(f,vec2<f32>(1.0)-f)*vec2<f32>(${width},${depth})*0.5;let distance=min(d.x,d.y);${collar===0?`return select(0.0,1.0,distance<${inner});`:`let t=clamp((${outer}-distance)/${collar},0.0,1.0);return t*t*(3.0-2.0*t);`}}`;
   rich.material.opacityNode=wgslFn(code)(uv());
   const layer=ownMesh('Neural support and overlap',geometry(support.quads,domain),rich.material);layer.renderOrder=1;overlap.add(layer);objects['overlap-control']=overlap;
  }
  if(pairedModel){for(const display of ['residual','weighted-residual','routing']){const bundle=createNeumipMaterial(pairedModel,{uvScale:1,gain:1,display,residualGain});diagnostics.push(bundle);objects[display]=ownMesh(display,plane(),bundle.material);}objects.paired=ownMesh('Trained cheap plus rich residual',plane(),createNeumipMaterial(pairedModel,{uvScale:1,gain:1}).material);objects.cheap=ownMesh('Trained cheap endpoint',plane(),createNeumipMaterial(pairedModel,{uvScale:1,gain:1,richEnabled:false}).material);}
  for(const o of Object.values(objects))root.add(o);
  const apply=()=>{for(const [key,o]of Object.entries(objects))o.visible=key===mode;session.redraw();};
  let asset,selector,status,gainInput;
  const persist=()=>updateInputs({...inputs,source:source.config,mode,collar,residualGain});
  const read=()=>({schema:'kaminos.stone-handoff-comparison.v1',mode,residualGain,source:source.config,window:source.window,captureDomain:domain,sourceSchema:source.schema,model:model?.source??null,modelInstalled:!!model,pairedModel:pairedModel?.source??null,pairedInstalled:!!pairedModel,objectId:asset?.id,collar,neuralAreaFraction:support.areaFraction,
   claim:mode==='residual'?'Unweighted signed residual under current scene direct lights. Gray = zero; brighter RGB channels add, darker subtract. Display = clamp(0.5 + 0.5 × gain × correction). Cheap centers are unsupervised extrapolation in this view.':mode==='weighted-residual'?'Signed correction actually added after footprint routing, under current scene direct lights. Gray = zero; brighter adds, darker subtracts. Same display gain as raw residual.':mode==='routing'?'Footprint-aware rich weight: black = zero, white = one. This is weight, not measured execution cost.':mode==='paired'?'Trained footprint-routed cheap response plus signed residual; no runtime speedup established':mode==='cheap'?'Trained mipmapped GGX response correction, with rich residual disabled':mode==='overlap-control'?'Analytic output-fade control over an authored-source fit; no learned bridge or speedup established':mode==='neural'?'Ordinary NeuMIP fit of authored source':mode==='pbr'?'Native PBR plane, including the current scene renderer':'Explicit authored source in native raster lighting, not the traced teacher integral',view:session.readView()});
  try{apply();asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:inputs.handoffURL??inputs.modelURL??'procedural:stone-transition-v1',type:'experiment'}});session.setView(inputs.view??framedView);}
  catch(e){if(!asset){for(const g of geometries)g.dispose();for(const m of materials)m.dispose();}await session.dispose();throw e;}
  return {read,operations:{
   setMode(value){if(!objects[value])throw Error('View unavailable: fitted model not installed or unknown view');mode=value;apply();persist();if(selector)selector.value=mode;if(status)status.textContent=read().claim;record({kind:'stone-handoff.mode',phase:'applied',effective:read()});return read();},
   setResidualGain(value){if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('Residual gain must be finite and nonnegative');residualGain=value;for(const bundle of diagnostics)bundle.settings.residualGain.value=value;persist();if(gainInput&&gainInput.ownerDocument.activeElement!==gainInput)gainInput.value=String(value);session.redraw();record({kind:'stone-handoff.residual-gain',phase:'applied',effective:read()});return read();},
   frame(){return session.setView(framedView);},
  },mount({root:panel,document,invoke}){
   const label=document.createElement('label');label.textContent='Representation ';selector=document.createElement('select');
   for(const [value,text]of [['source','Explicit source'],['pbr','Plain PBR — uniform stone'],['neural','Full learned parallax'],['overlap-control','PBR overlap — output-fade control'],['paired','Trained PBR + residual'],['cheap','Trained cheap endpoint'],['residual','Raw residual — signed'],['weighted-residual','Applied residual — signed'],['routing','Rich routing weight']]){const option=document.createElement('option');option.value=value;option.textContent=text;option.disabled=!objects[value];selector.append(option);}selector.value=mode;selector.onchange=()=>invoke('setMode',selector.value).catch(e=>status.textContent=e.message);label.append(selector);panel.append(label);
   const gainLabel=document.createElement('label'),grip=document.createElement('span');grip.textContent='Residual display gain ';gainInput=document.createElement('input');gainInput.type='number';gainInput.min='0';gainInput.step='any';gainInput.className='transform-input';gainInput.value=String(residualGain);gainInput.setAttribute('aria-label','Residual display gain');gainInput.oninput=()=>{if(gainInput.value.trim()&&Number.isFinite(Number(gainInput.value)))invoke('setResidualGain',Number(gainInput.value)).catch(e=>status.textContent=e.message);};gainInput.onblur=()=>gainInput.value=String(residualGain);gainLabel.append(grip,gainInput);panel.append(gainLabel);host.controls.installNumberDrag({input:gainInput,grip,step:.1});
   status=document.createElement('p');status.textContent=read().claim;panel.append(status);const modelState=document.createElement('p');modelState.textContent=pairedModel?'Paired fit loaded. Gain1, UVscale1.':model?'Ordinary fit loaded. Gain1, UVscale1.':'Fit pending; neural views remain unavailable.';panel.append(modelState);
  },async dispose(){await session.dispose();}};
 }
};
