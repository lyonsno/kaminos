import {Box3,Vector3} from '../lib/three.core.js';
import {sourceParts,createRegistrationViewer} from '../registration-viewer.mjs';
import {mountRegistrationControls} from '../registration-controls.mjs';

export default {
 id:'part-claims',title:'Reverse registration · part claims',
 async create({host,inputs,record}){
  const sourceUrl=inputs.sourceUrl||'/api/read?root=scenes&path=hostile-analytical-arm-supported-1017.kaminos.json';
  const targetUrl=inputs.targetUrl||'/api/read?root=generated-meshes&path=hostile-machine-trials-1018%2Felaborated-arm.glb';
  if(inputs.targetTransform)for(const key of ['position','rotation','scale']){const v=inputs.targetTransform[key];if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite)||(key==='scale'&&v.some(n=>n===0)))throw Error(`Invalid target ${key}`);}
  const response=await fetch(sourceUrl);if(!response.ok)throw Error(`Source carrier HTTP ${response.status}: ${sourceUrl}`);
  const parts=sourceParts(await response.json()),session=await host.scene.open();let controller,panel,stop;
  try{
   const asset=await session.loadAsset({url:targetUrl,normalize:false,metadata:{label:'Generated arm · registration target'}});
   if(inputs.targetTransform){const t=inputs.targetTransform;asset.root.position.fromArray(t.position);asset.root.rotation.set(...t.rotation);asset.root.scale.fromArray(t.scale);host.scene.refreshPresentation(asset);}
   const targetTransform=()=>({position:asset.root.position.toArray(),rotation:asset.root.rotation.toArray().slice(0,3),scale:asset.root.scale.toArray()});
   controller=createRegistrationViewer({target:asset.root,parts,redraw:()=>session.redraw(),onChange:()=>panel?.sync()});
   await session.attach(controller.ghost,{owned:true,presentation:true,metadata:{source:sourceUrl}});
   await session.attach(controller.diagnostic,{owned:true,presentation:true,metadata:{source:'kaminos:independent-claims'}});
   controller.fitBounds();if(inputs.settings)controller.configure(inputs.settings);
   const frame=()=>{const b=new Box3().setFromObject(asset.root),center=b.getCenter(new Vector3()),radius=b.getSize(new Vector3()).length();return session.setView({position:center.clone().add(new Vector3(1,.55,1.5).multiplyScalar(radius)).toArray(),target:center.toArray()});};
   if(inputs.view)session.setView(inputs.view);else frame();
   stop=session.onFrame(()=>controller.refresh());
   const targetMaterials=()=>{const rows=[];asset.root.traverse(n=>{if(n.isMesh)for(const m of Array.isArray(n.material)?n.material:[n.material])rows.push({name:m.name,baseColor:!!m.map?.image?.width,roughness:!!m.roughnessMap?.image?.width,metalness:!!m.metalnessMap?.image?.width});});return rows;};
   const read=()=>({...controller.read(),sourceUrl,targetUrl,objectId:asset.id,targetTransform:targetTransform(),targetMaterials:targetMaterials(),view:session.readView()});
   const settings=()=>{const {schema,status,progress,summary,method,partsSource,...s}=controller.read();return s;};
   const recipe=()=>({sourceUrl,targetUrl,targetTransform:targetTransform(),settings:settings(),view:session.readView()});
   const retain=()=>{const url=new URL(location.href);url.hash='';url.search='';url.searchParams.set('workspace','workbench');url.searchParams.set('experiment','part-claims');url.searchParams.set('experiment_inputs',JSON.stringify(recipe()));return url.href;};
   const operation=(kind,fn)=>(...args)=>{const result=fn(...args);const done=value=>{record({kind:`part-claims.${kind}`,phase:'applied',requested:args,effective:read()});return value;};return result?.then?result.then(done):done(result);};
   return {read,operations:{configure:operation('configure',p=>controller.configure(p)),fitBounds:operation('bounds',()=>controller.fitBounds()),compute:operation('compute',()=>controller.compute()),frame:operation('frame',frame),recipe},
    mount:({root,document,invoke})=>{panel=mountRegistrationControls({root,document,invoke,read,retain});},
    dispose:async()=>{stop?.();panel?.dispose();controller.dispose();await session.dispose();}};
  }catch(error){stop?.();controller?.dispose();await session.dispose();throw error;}
 },
};
