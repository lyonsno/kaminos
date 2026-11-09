import {createNeumipCarrier,createNeumipCarrierGeometry,NEUMIP_CARRIER_SOURCE} from '../neumip-carrier.mjs';
import {prepareNeumipParameters} from '../neumip-program.mjs';

const rootURL='/api/read?root=image-inbox&path=neumip-author-models%2F';
const positive=(x,name)=>{if(!Number.isFinite(x)||x<=0)throw Error(`${name} must be positive`);return x;};
export default {
  id:'neumip',title:'Neural surface materials',
  async create({host,inputs,record,updateInputs}) {
    const response=await fetch(rootURL+'catalog.json');if(!response.ok)throw Error('Install the author NeuMIP models first (tools/install_neumip_models.py)');
    const catalog=await response.json();if(catalog.schema!=='kaminos.neumip.author-models.v1')throw Error('Unknown NeuMIP model catalog');
    const source=name=>{const entry=catalog.materials[name];if(!entry)throw Error(`NeuMIP material is not installed: ${name}`);return {...entry,url:rootURL+encodeURIComponent(entry.filename)};};
    let name=inputs.material??'wool2',uvScale=positive(inputs.uvScale??3,'UV scale'),gain=positive(inputs.gain??1,'Material gain'),surface=inputs.surface??'folded';
    const session=await host.scene.open();if(!host.scene.renderer().backend.isWebGPUBackend){await session.dispose();throw Error('Neural materials require native WebGPU');}
    let parameters,recipeId,mesh,asset,disposed=false,generation=0,abort,selector,scaleInput,gainInput,surfaceInput,status,drag=[],unsubscribe=()=>{};
    const currentParameters=()=>host.scene.materials.read().recipes.find(r=>r.id===recipeId)?.parameters??parameters;
    const reconcile=()=>{
      if(asset){const entry=host.scene.objects().find(row=>row.id===asset.id);if(entry){mesh=entry.object;surface=mesh.userData.kaminosSceneObject?.neuralCarrier?.surface??entry.neuralCarrier?.surface??surface;const library=host.scene.materials.read(),binding=library.bindings.find(b=>b.objectId===asset.id),recipe=library.recipes.find(r=>r.id===binding?.recipeId);if(recipe?.implementation==='neumip')recipeId=recipe.id;else {recipeId=null;parameters=null;name='';}}}
      const p=currentParameters();if(p){uvScale=p.uvScale;gain=p.gain;name=Object.keys(catalog.materials).find(key=>catalog.materials[key].sha256===p.source.sha256)??'';}
    };
    const liveMesh=()=>{const entry=host.scene.objects().find(row=>row.id===asset?.id);if(!entry)throw Error('Neural carrier is not in the scene');mesh=entry.object;return mesh;};
    const read=()=>{reconcile();return {material:name,pending:!!abort,assigned:!!recipeId,surface,...currentParameters(),objectId:asset?.id,recipeId,backend:'WebGPU',authoredLights:host.scene.objects().filter(o=>o.type==='light').map(o=>({id:o.id,...o.light})),view:session.readView(),continuation:'Normal scene Save/Open retains the carrier, neural recipe, checkpoint identity, controls and native lights. Environment and indirect lighting are not yet evaluated.'};};
    const sync=(force=false)=>{reconcile();if(!status)return;selector.value=name;for(const [input,value] of [[scaleInput,uvScale],[gainInput,gain]]){input.disabled=!recipeId;if(force||input.ownerDocument.activeElement!==input||input.readOnly)input.value=String(value);}surfaceInput.value=surface;status.textContent=abort?'Loading material…':!recipeId?'Choose a neural checkpoint to assign to this carrier.':'Orbit to inspect the relief. Edit or add scene lights to change illumination. Environment and indirect lighting are not yet included.';};
    const persist=()=>{reconcile();updateInputs({...inputs,material:name,surface,uvScale,gain});};
    const select=async requested=>{
      if(disposed)throw Error('Neural surface session is disposed');
      const controls=currentParameters();uvScale=controls?.uvScale??uvScale;gain=controls?.gain??gain;
      const entry=source(requested),token=++generation,previousRecipe=recipeId;abort?.abort();const controller=new AbortController();abort=controller;sync();
      try{
        const next={source:{url:entry.url,sha256:entry.sha256},uvScale,gain};
        await prepareNeumipParameters(next);
        if(disposed)return;
        if(token!==generation)return read();
        reconcile();if(previousRecipe&&recipeId!==previousRecipe)return read();
        if(recipeId)await host.scene.materials.edit(recipeId,{parameters:{source:next.source}});
        else if(asset)recipeId=await host.scene.materials.create({objectId:asset.id,implementation:'neumip',name:requested,parameters:next});
        parameters=next;name=requested;persist();session.redraw();
        record({kind:'neumip.material',phase:'applied',effective:{name,source:next.source}});return read();
      }finally{if(abort===controller){abort=null;sync();}}
    };
    try{
      const library=host.scene.materials.read();
      const existing=host.scene.objects().find(row=>row.source===NEUMIP_CARRIER_SOURCE&&library.bindings.some(b=>b.objectId===row.id&&library.recipes.some(r=>r.id===b.recipeId&&r.implementation==='neumip')));
      if(existing){
        mesh=existing.object;asset=await session.attach(mesh,{owned:false});
        recipeId=library.bindings.find(b=>b.objectId===existing.id).recipeId;
        const recipe=library.recipes.find(r=>r.id===recipeId);parameters=recipe.parameters;reconcile();persist();
      }else{
        await select(name);mesh=createNeumipCarrier({surface});mesh.position.y=1.5;
        asset=await session.attach(mesh,{owned:true,metadata:{label:mesh.name,source:NEUMIP_CARRIER_SOURCE,type:'pbr',neuralCarrier:{surface}}});
        recipeId=await host.scene.materials.create({objectId:asset.id,implementation:'neumip',name,parameters});
        if(inputs.view)session.setView(inputs.view);else host.scene.frame([mesh]);
      }
    }catch(error){console.error('NeuMIP setup failed',error.stack);disposed=true;abort?.abort();if(!asset){mesh?.geometry.dispose();mesh?.material.dispose();}try{await session.dispose();}catch(cleanup){throw new AggregateError([error,cleanup],`${error.message}; cleanup: ${cleanup.message}`);}throw error;}
    unsubscribe=host.scene.materials.subscribe?.(()=>{if(!disposed){persist();sync();}})??(()=>{});
    const applied=kind=>{persist();session.redraw();sync();const state=read();record({kind:'neumip.'+kind,phase:'applied',effective:state});return state;};
    return {read,operations:{selectMaterial:select,
      setUVScale(value){uvScale=positive(value,'UV scale');host.scene.materials.edit(recipeId,{parameters:{uvScale}});return applied('scale');},
      setGain(value){gain=positive(value,'Material gain');host.scene.materials.edit(recipeId,{parameters:{gain}});return applied('gain');},
      setSurface(value){liveMesh();const next=createNeumipCarrierGeometry({surface:value}),old=mesh.geometry;mesh.geometry=next;surface=value;mesh.userData.kaminosSceneObject.neuralCarrier={surface};old.dispose();return applied('surface');},
      frame(){host.scene.frame([liveMesh()]);return applied('view');}},
      mount({root,document,invoke}){
        const selectField=(text,entries,operation)=>{const label=document.createElement('label'),select=document.createElement('select');label.append(text,select);for(const [value,title] of entries){const option=document.createElement('option');option.value=value;option.textContent=title;select.append(option);}select.addEventListener('change',()=>invoke(operation,select.value).catch(e=>{sync();status.textContent=e.message;}));root.append(label);return select;};
        selector=selectField('Material ',[['','Current checkpoint'],...Object.keys(catalog.materials).map(name=>[name,name])],'selectMaterial');
        surfaceInput=selectField('Surface ',[['folded','Folded surface'],['sphere','Sphere']],'setSurface');
        const number=(text,operation,value,step)=>{const label=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=text;input.type='number';input.step='any';input.min='0.000001';input.className='transform-input';input.value=String(value);input.addEventListener('blur',()=>sync(true));input.addEventListener('input',()=>{if(input.value&&input.validity.valid)invoke(operation,Number(input.value)).catch(e=>status.textContent=e.message);});label.append(grip,input);root.append(label);drag.push(host.controls.installNumberDrag({input,grip,step}));return input;};
        scaleInput=number('UV scale ','setUVScale',uvScale,.05);gainInput=number('Material gain ','setGain',gain,.05);
        const frame=document.createElement('button');frame.textContent='Frame surface';frame.onclick=()=>invoke('frame');status=document.createElement('p');status.className='small';root.append(frame,status);sync();
      },async dispose(){disposed=true;generation++;abort?.abort();unsubscribe();for(const d of drag)d?.dispose();await session.dispose();}}
  }
};
