import {Mesh,PlaneGeometry,SphereGeometry} from '../lib/three.webgpu.js';
import {loadNeumipModel} from '../neumip-model.mjs';
import {createNeumipMaterial} from '../neumip-material.mjs';

const rootURL='/api/read?root=image-inbox&path=neumip-author-models%2F';
const positive=(x,name)=>{if(!Number.isFinite(x)||x<=0)throw Error(`${name} must be positive`);return x;};
export default {
  id:'neumip',title:'Neural surface materials',
  async create({host,inputs,record,updateInputs}) {
    const catalogURL=inputs.catalogURL??rootURL+'catalog.json';
    const response=await fetch(catalogURL);if(!response.ok)throw Error(`NeuMIP model catalog HTTP ${response.status}: ${catalogURL}`);
    const catalog=await response.json();if(!['kaminos.neumip.author-models.v1','kaminos.neumip.models.v1'].includes(catalog.schema))throw Error('Unknown NeuMIP model catalog');
    const source=name=>{const entry=catalog.materials[name];if(!entry)throw Error(`NeuMIP material is not installed: ${name}`);return {...entry,url:entry.url??rootURL+encodeURIComponent(entry.filename)};};
    let name=inputs.material??'wool2',uvScale=positive(inputs.uvScale??3,'UV scale'),gain=positive(inputs.gain??1,'Material gain'),surface=inputs.surface??'folded';
    const session=await host.scene.open();if(!host.scene.renderer().backend.isWebGPUBackend){await session.dispose();throw Error('Neural materials require native WebGPU');}
    let current,mesh,asset,disposed=false,generation=0,abort,selector,scaleInput,gainInput,surfaceInput,status,drag=[];
    const makeGeometry=kind=>{
      if(kind==='sphere'){const g=new SphereGeometry(1,64,48);g.computeTangents();return g;}
      if(kind!=='folded')throw Error('Choose folded or sphere');
      const g=new PlaneGeometry(2.6,2.6,96,96),p=g.attributes.position;
      for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i);p.setZ(i,.18*Math.sin(6*x+1.2*y)+.12*Math.cos(3*y-2*x));}
      p.needsUpdate=true;g.computeVertexNormals();g.computeTangents();return g;
    };
    const read=()=>({material:name,catalogURL,pending:!!abort,surface,uvScale,gain,objectId:asset?.id,backend:'WebGPU',...current?.read(),authoredLights:host.scene.objects().filter(o=>o.type==='light').map(o=>({id:o.id,...o.light})),view:session.readView(),continuation:'Experiment inputs restore model, surface and material controls. Native scene lights remain editable; indirect/environment response is not implemented.'});
    const sync=(force=false)=>{if(!status)return;selector.value=name;for(const [input,value] of [[scaleInput,uvScale],[gainInput,gain]])if(force||input.ownerDocument.activeElement!==input||input.readOnly)input.value=String(value);surfaceInput.value=surface;status.textContent=abort?'Loading material…':'Orbit to inspect the relief. Edit or add scene lights to change illumination. Environment and indirect lighting are not yet included.';};
    const persist=()=>updateInputs({...inputs,material:name,surface,uvScale,gain});
    const select=async requested=>{
      if(disposed)throw Error('Neural surface session is disposed');
      const entry=source(requested),token=++generation;abort?.abort();const controller=new AbortController();abort=controller;sync();
      try{
        const model=await loadNeumipModel(entry.url,{sha256:entry.sha256,signal:controller.signal});
        if(disposed)return;
        if(token!==generation)return read();
        const next=createNeumipMaterial(model,{uvScale,gain});
        const previous=current;current=next;name=requested;if(mesh)mesh.material=next.material;previous?.material.dispose();persist();session.redraw();
        record({kind:'neumip.material',phase:'applied',effective:{name,source:model.source}});return read();
      }finally{if(abort===controller){abort=null;sync();}}
    };
    try{
      await select(name);mesh=new Mesh(makeGeometry(surface),current.material);mesh.name='Neural surface';mesh.receiveShadow=true;mesh.position.y=1.5;
      asset=await session.attach(mesh,{owned:true,metadata:{label:mesh.name,source:current.read().source.url,type:'experiment'}});
      if(inputs.view)session.setView(inputs.view);else host.scene.frame([mesh]);
    }catch(error){console.error('NeuMIP setup failed',error.stack);disposed=true;abort?.abort();if(!asset)mesh?.geometry.dispose();current?.material.dispose();try{await session.dispose();}catch(cleanup){throw new AggregateError([error,cleanup],`${error.message}; cleanup: ${cleanup.message}`);}throw error;}
    const applied=kind=>{persist();session.redraw();sync();const state=read();record({kind:'neumip.'+kind,phase:'applied',effective:state});return state;};
    return {read,operations:{selectMaterial:select,
      setUVScale(value){uvScale=positive(value,'UV scale');current.settings.scale.value=uvScale;return applied('scale');},
      setGain(value){gain=positive(value,'Material gain');current.settings.gain.value=gain;return applied('gain');},
      setSurface(value){const next=makeGeometry(value),old=mesh.geometry;mesh.geometry=next;surface=value;old.dispose();return applied('surface');},
      frame(){host.scene.frame([mesh]);return applied('view');}},
      mount({root,document,invoke}){
        const selectField=(text,entries,operation)=>{const label=document.createElement('label'),select=document.createElement('select');label.append(text,select);for(const [value,title] of entries){const option=document.createElement('option');option.value=value;option.textContent=title;select.append(option);}select.addEventListener('change',()=>invoke(operation,select.value).catch(e=>{sync();status.textContent=e.message;}));root.append(label);return select;};
        selector=selectField('Material ',Object.keys(catalog.materials).map(name=>[name,catalog.materials[name].title??name]),'selectMaterial');
        surfaceInput=selectField('Surface ',[['folded','Folded surface'],['sphere','Sphere']],'setSurface');
        const number=(text,operation,value,step)=>{const label=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=text;input.type='number';input.step='any';input.min='0.000001';input.className='transform-input';input.value=String(value);input.addEventListener('blur',()=>sync(true));input.addEventListener('input',()=>{if(input.value&&input.validity.valid)invoke(operation,Number(input.value)).catch(e=>status.textContent=e.message);});label.append(grip,input);root.append(label);drag.push(host.controls.installNumberDrag({input,grip,step}));return input;};
        scaleInput=number('UV scale ','setUVScale',uvScale,.05);gainInput=number('Material gain ','setGain',gain,.05);
        const frame=document.createElement('button');frame.textContent='Frame surface';frame.onclick=()=>invoke('frame');status=document.createElement('p');status.className='small';root.append(frame,status);sync();
      },async dispose(){disposed=true;generation++;abort?.abort();for(const d of drag)d?.dispose();await session.dispose();}}
  }
};
