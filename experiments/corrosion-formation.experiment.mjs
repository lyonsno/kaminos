import{surfaceTeacherExperiment}from'./surface-teacher-experiment.mjs';
import{createCorrosionSource}from'../corrosion-source.mjs';
import{restoreCorrosion,corrosionSummary}from'../coating-corrosion.mjs';
export default{
 id:'corrosion-formation',title:'Corrosion-grown coating',
 async create(args){
  if(!args||args.inputs!==undefined&&(!args.inputs||typeof args.inputs!=='object'||Array.isArray(args.inputs)))throw Error('Teacher inputs must be an object');
  const inputs=args.inputs??{},catalogURL=inputs.catalogURL??'/api/read?root=image-inbox&path=corrosion-source-first%2Fresult%2Fcatalog.json';
  const response=await fetch(catalogURL);if(!response.ok)throw Error(`Corrosion catalog ${response.status}`);const catalog=await response.json();
  if(catalog.schema!=='kaminos.corrosion-evolution.v1'||catalog.status!=='passed'||!Array.isArray(catalog.snapshots)||!catalog.snapshots.length)throw Error('Missing completed corrosion formation');
  const states=[];
  for(const entry of catalog.snapshots){
   const url=new URL(catalogURL,location.href);url.searchParams.set('path',url.searchParams.get('path').replace(/catalog\.json$/,entry.file));
   const r=await fetch(url);if(!r.ok)throw Error(`Corrosion snapshot ${r.status}`);const bytes=await r.arrayBuffer(),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
   if(digest!==entry.sha256)throw Error('Corrosion state digest mismatch');states.push(JSON.parse(new TextDecoder().decode(bytes)));
  }
  const summaries=states.map(state=>corrosionSummary(restoreCorrosion(state)));
  const choose=options=>{
   if(options!==undefined&&(!options||typeof options!=='object'||Array.isArray(options)))throw Error('Invalid corrosion presentation');
   const snapshot=options?.snapshot??states.length-1;if(!Number.isSafeInteger(snapshot)||!states[snapshot])throw Error('Retained snapshot is unavailable');
   const source=createCorrosionSource(states[snapshot],{...options,snapshot});source.config.stateSHA256=catalog.snapshots[snapshot].sha256;return source;
  };
  const definition=surfaceTeacherExperiment({id:this.id,title:this.title,createSource:choose,label:'Corrosion-grown coated steel',sourceURL:catalogURL,
   boundary:'Retained formation states: pitting, oxide deposition and adhesion loss. Small-slope coating; fracture and curled free sheets are not implemented. Periodic fields, finite ray tile.',
   initialView:{position:[1.5,1.1,1.9],target:[0,.02,0],fov:40},defaultTracing:false,defaultMaterials:[],sourceControls:[],sourceToggles:[['Inspect substrate beneath paint','showSubstrate']],
   describeSource:options=>({...summaries[options.snapshot],stateSHA256:catalog.snapshots[options.snapshot].sha256,producerRevision:catalog.sourceRevision}),readSchema:'kaminos.corrosion-formation-experiment.v1'});
  const api=await definition.create(args),mount=api.mount,source=api.operations.source;let select,sourceInfo;
  const updateSourceInfo=()=>{const state=api.read(),n=state.source.formationResolution;if(sourceInfo)sourceInfo.textContent=`Formation grid: ${n} × ${n} cells · ${state.sourceTriangles} triangles`;};
  api.operations.source=async value=>{const result=await source(value);if(select)select.value=String(result.source.snapshot);updateSourceInfo();return result;};
  api.mount=function(options){
   mount.call(api,options);const{root,document,invoke}=options,row=document.createElement('label');row.textContent='Retained exposure ';select=document.createElement('select');select.setAttribute('aria-label','Retained exposure');
   catalog.snapshots.forEach((entry,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=`${entry.time} exposure units`;select.append(option);});select.value=String(api.read().source.snapshot);
   select.onchange=()=>invoke('source',{snapshot:Number(select.value)}).catch(error=>{select.value=String(api.read().source.snapshot);root.querySelector('[role=status]').textContent=error.message;});row.append(select);sourceInfo=document.createElement('p');sourceInfo.setAttribute('data-corrosion-source-grid','');root.prepend(row,sourceInfo);updateSourceInfo();
  };return api;
 }
};
