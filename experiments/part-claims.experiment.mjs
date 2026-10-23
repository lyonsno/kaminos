import {Box3,Vector3} from '../lib/three.core.js';
import {sourceParts,createRegistrationViewer} from '../registration-viewer.mjs';
import {mountRegistrationControls} from '../registration-controls.mjs';
import {sourceJoints,jointWorldFrame,snapSourceJoint,createJointMarker} from '../registration-joints.mjs';
import {registrationRequest,savedRegistrationURL} from '../registration-retention.mjs';

const pose=root=>({position:root.position.toArray(),rotation:root.rotation.toArray().slice(0,3),scale:root.scale.toArray()});
function restorePose(root,value){for(const k of ['position','rotation','scale'])if(!Array.isArray(value[k])||value[k].length!==3||!value[k].every(Number.isFinite)||(k==='scale'&&value[k].some(n=>n===0)))throw Error(`Invalid joint guess ${k}`);root.position.fromArray(value.position);root.rotation.set(...value.rotation);root.scale.fromArray(value.scale);}

export default {
 id:'part-claims',title:'Reverse registration · part claims',
 async create({host,inputs,record}){
  const sourceUrl=inputs.sourceUrl||'/api/read?root=scenes&path=hostile-analytical-arm-supported-1017.kaminos.json';
  const targetUrl=inputs.targetUrl||'/api/read?root=generated-meshes&path=hostile-machine-trials-1018%2Felaborated-arm.glb';
  let registration={available:false,error:null,entries:[],lastSaved:null},identity=null;
  try{const catalog=await registrationRequest(sourceUrl,targetUrl);identity=catalog.identity;registration.available=true;registration.entries=catalog.registrations;}catch(error){registration.error=error.message;}
  if(inputs.registrationId){const loaded=await registrationRequest(sourceUrl,targetUrl,{id:inputs.registrationId});inputs=loaded.registration.recipe;identity=loaded.identity;registration.lastSaved={id:loaded.registration.id,name:loaded.registration.name};}
  if(inputs.targetTransform)for(const key of ['position','rotation','scale']){const v=inputs.targetTransform[key];if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite)||(key==='scale'&&v.some(n=>n===0)))throw Error(`Invalid target ${key}`);}
  const response=await fetch(sourceUrl);if(!response.ok)throw Error(`Source carrier HTTP ${response.status}: ${sourceUrl}`);
  const source=await response.json(),parts=sourceParts(source),joints=sourceJoints(source),session=await host.scene.open();let controller,panel,stop;
  const jointTargets=[],jointPanels=[];let preview=null,previewSession=null,previewBusy=false,disposed=false;
  const clearPreview=async()=>{const previous=preview,owned=previewSession;preview=null;previewSession=null;for(const p of previous?.pieces||[])p.root.visible=false;await owned?.dispose();session.redraw();panel?.sync();};
  try{
   const asset=await session.loadAsset({url:targetUrl,normalize:false,metadata:{label:'Generated arm · registration target'}});
   if(identity){const after=await registrationRequest(sourceUrl,targetUrl);if(JSON.stringify(after.identity)!==JSON.stringify(identity))throw Error('Registration source or target changed during loading');}
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
   const frame=()=>{const b=new Box3().setFromObject(asset.root);for(const p of preview?.pieces||[])b.union(new Box3().setFromObject(p.root));const center=b.getCenter(new Vector3()),radius=b.getSize(new Vector3()).length();return session.setView({position:center.clone().add(new Vector3(1,.55,1.5).multiplyScalar(radius)).toArray(),target:center.toArray()});};
   if(inputs.view)session.setView(inputs.view);else frame();
   let lastAvailability='';
   stop=session.onFrame(()=>{controller.refresh();if(preview&&preview.revision!==controller.read().claimRevision)clearPreview().catch(error=>{registration.error=error.message;panel?.sync();});const signature=jointTargets.map(t=>available(t.receipt)).join(',');if(signature!==lastAvailability){lastAvailability=signature;panel?.sync();}});
   const targetMaterials=()=>{const rows=[];asset.root.traverse(n=>{if(n.isMesh)for(const m of Array.isArray(n.material)?n.material:[n.material])rows.push({name:m.name,baseColor:!!m.map?.image?.width,roughness:!!m.roughnessMap?.image?.width,metalness:!!m.metalnessMap?.image?.width});});return rows;};
   const read=()=>{controller.refresh();return {...controller.read(),registration:structuredClone(registration),preview:preview?{revision:preview.revision,pieces:preview.pieces.map(p=>({id:p.id,label:p.label,triangles:p.triangles,objectId:p.receipt.id,available:available(p.receipt)}))}:null,sourceUrl,targetUrl,objectId:asset.id,sourceObjectId:sourceAsset.id,targetTransform:targetTransform(),targetMaterials:targetMaterials(),joints:jointTargets.map(({joint,receipt})=>({...joint,available:available(receipt),sourceFrame:available(sourceAsset)?jointWorldFrame(controller.ghost,joint):null,guessObjectId:receipt.id,guessPose:available(receipt)?pose(receipt.root):null,guessMethod:'manual; initialized from source, not detected'})),view:session.readView()};};
   const settings=()=>{const {schema,status,progress,claimRevision,summary,method,partsSource,...s}=controller.read();return s;};
   const recipe=()=>{controller.refresh();requireInputs();return {sourceUrl,targetUrl,targetTransform:targetTransform(),settings:settings(),jointGuesses:Object.fromEntries(joints.map(joint=>{const item=jointTargets.find(t=>t.joint.id===joint.id);return [joint.id,item&&available(item.receipt)?pose(item.receipt.root):null];})),view:session.readView()};};
   const retain=()=>{if(unavailableReason())return null;const url=new URL(location.href);url.hash='';url.search='';url.searchParams.set('workspace','workbench');url.searchParams.set('experiment','part-claims');url.searchParams.set('experiment_inputs',JSON.stringify(recipe()));return url.href;};
   const operation=(kind,fn)=>(...args)=>{const result=fn(...args);const done=value=>{record({kind:`part-claims.${kind}`,phase:'applied',requested:args,effective:read()});return value;};return result?.then?result.then(done):done(result);};
   const selectJoint=id=>{const item=jointTargets.find(t=>t.joint.id===id);if(!item)throw Error('Unknown joint');if(!available(item.receipt))throw Error('Joint guess unavailable; reopen a retained comparison to restore it');return item;};
   const buildPreview=async()=>{
    if(previewBusy)throw Error('Piece preview is being built');previewBusy=true;
    try{await clearPreview();requireInputs();const revision=controller.read().claimRevision,pieces=controller.claimPieces();previewSession=await host.scene.open();
     const extent=new Box3().setFromObject(asset.root).getSize(new Vector3()).length();let ordinal=0;
     for(const p of pieces){if(!p.triangles){p.dispose();continue;}if(p.id!=='contested'&&p.id!=='unclaimed'){p.root.position.x+=(ordinal++-(parts.length-1)/2)*extent*.5;p.root.position.z+=extent*.5;}
      p.receipt=await previewSession.attach(p.root,{owned:true,metadata:{label:`Claim preview · ${p.label}`,source:'independent-claim-snapshot'}});
     }
     preview={revision,pieces:pieces.filter(p=>p.triangles)};
     if(disposed||controller.read().claimRevision!==revision)await clearPreview();
     else{controller.configure({claims:false});frame();panel?.sync();}return read();
    }catch(error){await clearPreview();throw error;}finally{previewBusy=false;}
   };
   const saveRegistration=async name=>{
    if(!identity)throw Error('Registration storage was unavailable when this comparison loaded; retain its link and reopen');
    const result=await registrationRequest(sourceUrl,targetUrl,{save:{name,recipe:recipe(),identity}});
    registration.lastSaved={id:result.registration.id,name:result.registration.name};registration.error=null;
    const catalog=await registrationRequest(sourceUrl,targetUrl);registration.entries=catalog.registrations;panel?.sync();return {registration:result.registration,url:savedRegistrationURL(location.href,{sourceUrl,targetUrl,id:result.registration.id})};
   };
   return {read,operations:{configure:operation('configure',p=>controller.configure(p)),fitBounds:operation('bounds',async()=>{controller.refresh();const before=controller.read().alignment;controller.fitBounds();const fitted=pose(controller.ghost);controller.configure({alignment:before});await host.scene.setTransform(sourceAsset.id,fitted);controller.refresh();return read();}),compute:operation('compute',()=>controller.compute()),frame:operation('frame',frame),recipe,
     saveRegistration,buildPreview,clearPreview,selectPiece:id=>{const p=preview?.pieces.find(p=>p.id===id);if(!p||!available(p.receipt))throw Error('Preview piece unavailable');return host.scene.select(p.receipt.id);},
     savedURL:id=>savedRegistrationURL(location.href,{sourceUrl,targetUrl,id}),
     selectSource:()=>host.scene.select(sourceAsset.id),selectTarget:()=>host.scene.select(asset.id),selectJoint:id=>host.scene.select(selectJoint(id).receipt.id),
     snapJoint:operation('snap-joint',async id=>{requireInputs();const {joint,receipt}=selectJoint(id);await host.scene.setTransform(sourceAsset.id,snapSourceJoint(controller.ghost,joint,receipt.root));controller.refresh();return read();})},
    mount:({root,document,invoke})=>{
     panel=mountRegistrationControls({root,document,invoke,read,retain,controls:host.controls});
     for(const {joint,receipt}of jointTargets){const properties=document.createElement('section');const title=document.createElement('h3');title.textContent=joint.label+' · manual target guess';const hint=document.createElement('p');hint.textContent='Move the center and rotate the orange axis with the native gizmo. This is your correspondence, not a detected cylinder. Scale changes marker size only.';const snap=document.createElement('button');snap.className='btn';snap.textContent='Snap source joint here';snap.addEventListener('click',()=>invoke('snapJoint',joint.id).catch(error=>{hint.textContent=error.message;}));properties.append(title,hint,snap);jointPanels.push(host.controls.mountObject({asset:receipt,properties}));}
    },
    dispose:async()=>{disposed=true;stop?.();await clearPreview();panel?.dispose();for(const p of jointPanels)p.dispose();controller.dispose();await session.dispose();}};
  }catch(error){stop?.();controller?.dispose();await session.dispose();throw error;}
 },
};
