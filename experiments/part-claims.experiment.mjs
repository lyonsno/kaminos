import {Box3,Vector3} from '../lib/three.core.js';
import {sourceParts,createRegistrationViewer} from '../registration-viewer.mjs';
import {mountRegistrationControls} from '../registration-controls.mjs';
import {sourceJoints,jointWorldFrame,snapSourceJoint,createJointMarker} from '../registration-joints.mjs';

const pose=root=>({position:root.position.toArray(),rotation:root.rotation.toArray().slice(0,3),scale:root.scale.toArray()});
function restorePose(root,value){for(const k of ['position','rotation','scale'])if(!Array.isArray(value[k])||value[k].length!==3||!value[k].every(Number.isFinite)||(k==='scale'&&value[k].some(n=>n===0)))throw Error(`Invalid joint guess ${k}`);root.position.fromArray(value.position);root.rotation.set(...value.rotation);root.scale.fromArray(value.scale);}

export default {
 id:'part-claims',title:'Reverse registration · part claims',
 async create({host,inputs,record}){
  const sourceUrl=inputs.sourceUrl||'/api/read?root=scenes&path=hostile-analytical-arm-supported-1017.kaminos.json';
  const targetUrl=inputs.targetUrl||'/api/read?root=generated-meshes&path=hostile-machine-trials-1018%2Felaborated-arm.glb';
  if(inputs.targetTransform)for(const key of ['position','rotation','scale']){const v=inputs.targetTransform[key];if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite)||(key==='scale'&&v.some(n=>n===0)))throw Error(`Invalid target ${key}`);}
  const response=await fetch(sourceUrl);if(!response.ok)throw Error(`Source carrier HTTP ${response.status}: ${sourceUrl}`);
  const source=await response.json(),parts=sourceParts(source),joints=sourceJoints(source),session=await host.scene.open();let controller,panel,stop;
  const jointTargets=[],jointPanels=[];
  try{
   const asset=await session.loadAsset({url:targetUrl,normalize:false,metadata:{label:'Generated arm · registration target'}});
   if(inputs.targetTransform){const t=inputs.targetTransform;asset.root.position.fromArray(t.position);asset.root.rotation.set(...t.rotation);asset.root.scale.fromArray(t.scale);host.scene.refreshPresentation(asset);}
   const targetTransform=()=>({position:asset.root.position.toArray(),rotation:asset.root.rotation.toArray().slice(0,3),scale:asset.root.scale.toArray()});
   const available=receipt=>host.scene.objects().some(row=>row.id===receipt.id&&row.object===receipt.root);
   let sourceAsset=null;
   const unavailableReason=()=>sourceAsset&&!available(sourceAsset)?'source carrier was removed or replaced':!available(asset)?'target was removed or replaced':null;
   const requireInputs=()=>{const reason=unavailableReason();if(reason)throw Error('unavailable: '+reason);};
   controller=createRegistrationViewer({target:asset.root,parts,redraw:()=>session.redraw(),onChange:()=>panel?.sync(),unavailableReason});
   sourceAsset=await session.attach(controller.ghost,{owned:true,metadata:{label:'Analytical carrier · move / rotate / scale',source:sourceUrl}});
   await session.attach(controller.diagnostic,{owned:true,presentation:true,metadata:{source:'kaminos:independent-claims'}});
   controller.fitBounds();if(inputs.settings)controller.configure(inputs.settings);
   host.scene.refreshPresentation(sourceAsset);
   for(const joint of joints){
    const guide=createJointMarker({color:'#36d6cf',radius:.055});guide.name=`Known · ${joint.label}`;guide.position.fromArray(joint.center);guide.quaternion.setFromUnitVectors(new Vector3(0,0,1),new Vector3(...joint.axis));controller.ghost.add(guide);
    if(inputs.jointGuesses?.[joint.id]===null)continue;
    const root=createJointMarker({color:'#ff963e',radius:.065}),frame=jointWorldFrame(controller.ghost,joint);root.position.fromArray(frame.center);root.quaternion.setFromUnitVectors(new Vector3(0,0,1),new Vector3(...frame.axis));
    if(inputs.jointGuesses?.[joint.id])restorePose(root,inputs.jointGuesses[joint.id]);
    const receipt=await session.attach(root,{owned:true,metadata:{label:`Manual target guess · ${joint.label}`,source:'manual-joint-correspondence'}});jointTargets.push({joint,receipt});
   }
   const frame=()=>{const b=new Box3().setFromObject(asset.root),center=b.getCenter(new Vector3()),radius=b.getSize(new Vector3()).length();return session.setView({position:center.clone().add(new Vector3(1,.55,1.5).multiplyScalar(radius)).toArray(),target:center.toArray()});};
   if(inputs.view)session.setView(inputs.view);else frame();
   let lastAvailability='';
   stop=session.onFrame(()=>{controller.refresh();const signature=jointTargets.map(t=>available(t.receipt)).join(',');if(signature!==lastAvailability){lastAvailability=signature;panel?.sync();}});
   const targetMaterials=()=>{const rows=[];asset.root.traverse(n=>{if(n.isMesh)for(const m of Array.isArray(n.material)?n.material:[n.material])rows.push({name:m.name,baseColor:!!m.map?.image?.width,roughness:!!m.roughnessMap?.image?.width,metalness:!!m.metalnessMap?.image?.width});});return rows;};
   const read=()=>{controller.refresh();return {...controller.read(),sourceUrl,targetUrl,objectId:asset.id,sourceObjectId:sourceAsset.id,targetTransform:targetTransform(),targetMaterials:targetMaterials(),joints:jointTargets.map(({joint,receipt})=>({...joint,available:available(receipt),sourceFrame:available(sourceAsset)?jointWorldFrame(controller.ghost,joint):null,guessObjectId:receipt.id,guessPose:available(receipt)?pose(receipt.root):null,guessMethod:'manual; initialized from source, not detected'})),view:session.readView()};};
   const settings=()=>{const {schema,status,progress,summary,method,partsSource,...s}=controller.read();return s;};
   const recipe=()=>{controller.refresh();requireInputs();return {sourceUrl,targetUrl,targetTransform:targetTransform(),settings:settings(),jointGuesses:Object.fromEntries(joints.map(joint=>{const item=jointTargets.find(t=>t.joint.id===joint.id);return [joint.id,item&&available(item.receipt)?pose(item.receipt.root):null];})),view:session.readView()};};
   const retain=()=>{if(unavailableReason())return null;const url=new URL(location.href);url.hash='';url.search='';url.searchParams.set('workspace','workbench');url.searchParams.set('experiment','part-claims');url.searchParams.set('experiment_inputs',JSON.stringify(recipe()));return url.href;};
   const operation=(kind,fn)=>(...args)=>{const result=fn(...args);const done=value=>{record({kind:`part-claims.${kind}`,phase:'applied',requested:args,effective:read()});return value;};return result?.then?result.then(done):done(result);};
   const selectJoint=id=>{const item=jointTargets.find(t=>t.joint.id===id);if(!item)throw Error('Unknown joint');if(!available(item.receipt))throw Error('Joint guess unavailable; reopen a retained comparison to restore it');return item;};
   return {read,operations:{configure:operation('configure',p=>controller.configure(p)),fitBounds:operation('bounds',async()=>{controller.refresh();const before=controller.read().alignment;controller.fitBounds();const fitted=pose(controller.ghost);controller.configure({alignment:before});await host.scene.setTransform(sourceAsset.id,fitted);controller.refresh();return read();}),compute:operation('compute',()=>controller.compute()),frame:operation('frame',frame),recipe,
     selectSource:()=>host.scene.select(sourceAsset.id),selectTarget:()=>host.scene.select(asset.id),selectJoint:id=>host.scene.select(selectJoint(id).receipt.id),
     snapJoint:operation('snap-joint',async id=>{requireInputs();const {joint,receipt}=selectJoint(id);await host.scene.setTransform(sourceAsset.id,snapSourceJoint(controller.ghost,joint,receipt.root));controller.refresh();return read();})},
    mount:({root,document,invoke})=>{
     panel=mountRegistrationControls({root,document,invoke,read,retain,controls:host.controls});
     for(const {joint,receipt}of jointTargets){const properties=document.createElement('section');const title=document.createElement('h3');title.textContent=joint.label+' · manual target guess';const hint=document.createElement('p');hint.textContent='Move the center and rotate the orange axis with the native gizmo. This is your correspondence, not a detected cylinder. Scale changes marker size only.';const snap=document.createElement('button');snap.className='btn';snap.textContent='Snap source joint here';snap.addEventListener('click',()=>invoke('snapJoint',joint.id).catch(error=>{hint.textContent=error.message;}));properties.append(title,hint,snap);jointPanels.push(host.controls.mountObject({asset:receipt,properties}));}
    },
    dispose:async()=>{stop?.();panel?.dispose();for(const p of jointPanels)p.dispose();controller.dispose();await session.dispose();}};
  }catch(error){stop?.();controller?.dispose();await session.dispose();throw error;}
 },
};
