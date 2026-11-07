import {createMountedGenerationWorkshop,withoutMountedWorkshop} from './mounted-generation-workshop.mjs';
import {arrivalTranslation} from './generation-arrival.mjs';
import {createStageMold} from './stage-mold.mjs';
import {createProceduralMesh} from './scene-geometry.mjs';
import {sceneRadianceMaterialChain} from './scene-radiance.mjs';

// One retained native scene session; the application continues owning the view,
// renderer, inference and document. There are no simulation/readback operations.
export function installMountedGenerationWorkshop({document,THREE,mergeGeometries,loadGlb,host,camera,readView,selection,setSelection,find,applyMaterials,warm,mounted=()=>{},prepareParts=async()=>null,changed=()=>{},redraw}) {
 const ids=new Set();let handles=[],savedSelection=null,memberOwner=null;
 const card=document.createElement('div');card.id='mounted-generation-workshop';card.hidden=true;
 card.style.cssText='position:absolute;z-index:12;top:82px;right:18px;display:flex;gap:12px;align-items:center;padding:9px 12px;border:1px solid #646260;border-radius:8px;background:#202528ed;color:#ead5ad;pointer-events:auto;font:14px system-ui';
 const status=document.createElement('span'),back=document.createElement('button');back.type='button';back.textContent='Return to scene';
 back.title='Withdraw the workshop. An active generation continues; use Stop to cancel it.';card.append(status,back);
 const viewport=document.getElementById('viewport');viewport.append(card);
 function update(state){card.hidden=!state.wanted&&['unprepared','preparing','closed','disposed'].includes(state.phase);card.style.display=card.hidden?'none':'flex';status.textContent=state.error?`Workshop unavailable · ${state.error}`:state.phase==='preparing'||state.phase==='unprepared'?'Preparing workshop…':'Generation workshop';changed(state);redraw();}
 const controller=createMountedGenerationWorkshop({onFrame:callback=>host.onFrame(callback),changed:update,
  async acquire({signal}){
   const session=host.open();const acquired=[],materials=new Map(),shadows=new Map(),frame=new THREE.Group();let placed=false,parts=null;
   const release=async()=>{await parts?.dispose();memberOwner=null;for(const h of acquired)ids.delete(h.id);await session.dispose();for(const h of acquired)h.root.removeFromParent();frame.removeFromParent();};
   try{
    const response=await fetch('./assets/workshop/cold-stage.json',{signal});if(!response.ok)throw Error(`Workshop manifest ${response.status}`);
    const recipe=await response.json();if(recipe.schema!=='kaminos.mounted-workshop.v1'||!Array.isArray(recipe.objects))throw Error('Unsupported workshop manifest');
    for(const record of recipe.objects){
     signal.throwIfAborted();
     let instance=null,root;if(record.type==='glb')root=await loadGlb(record.source,signal);
     else if(record.stageMold)root=createStageMold(record.stageMold);
     else if(record.type==='procedural-mesh'){instance=createProceduralMesh(THREE,mergeGeometries,record.geometry,record.surface);root=instance.group;}
     else throw Error(`Unsupported workshop member ${record.type}`);
     if(signal.aborted){root.traverse(n=>{n.geometry?.dispose();for(const m of [n.material].flat().filter(Boolean))m.dispose();});signal.throwIfAborted();}
     root.position.fromArray(record.transform.position);root.rotation.set(...record.transform.rotation);root.scale.fromArray(record.transform.scale);root.visible=false;
     root.userData.kaminosMountedWorkshop=true;applyMaterials(root,record.materials);
     root.traverse(node=>{for(const material of [node.material].flat().filter(Boolean)){if(!materials.has(material))materials.set(material,{opacity:material.opacity,transparent:material.transparent});material.transparent=true;}});
     const handle=await session.attach(root,{owned:true,metadata:{...record,collision:null,waterCollision:false}});ids.add(handle.id);acquired.push(handle);mounted(handle,instance);
     // Yield between authored members, independently of the Generate click.
     await new Promise(resolve=>setTimeout(resolve,0));
    }
    signal.throwIfAborted();
    const box=new THREE.Box3();for(const h of acquired){h.root.updateMatrixWorld(true);box.expandByObject(h.root);}
    const sphere=box.getBoundingSphere(new THREE.Sphere());
    await warm(acquired.map(h=>h.root));signal.throwIfAborted();
    // The shared scene owns this presentation frame. Registered children keep
    // authored local units while native transforms use their real parent.
    acquired[0].root.parent.add(frame);for(const h of acquired)frame.add(h.root);
    handles=acquired;
    memberOwner=async(root,metadata)=>{
     signal.throwIfAborted();root.visible=false;root.userData.kaminosMountedWorkshop=true;
     const handle=await session.attach(root,{owned:true,metadata:{...metadata,collision:null}});ids.add(handle.id);acquired.push(handle);
     frame.add(root);await warm([root]);signal.throwIfAborted();root.visible=controller.read().amount>0;return handle;
    };
    parts=await prepareParts();signal.throwIfAborted();
    function restoreSelection(){if(!savedSelection)return;const previous=savedSelection;savedSelection=null;const available=previous.ids.filter(id=>find(id));setSelection(available,available.includes(previous.activeId)?previous.activeId:available.at(-1)??null);}
    return {get ids(){return acquired.map(h=>h.id);},
     place(){
      savedSelection=structuredClone(selection());
      const next=arrivalTranslation({view:{...readView(),aspect:camera.aspect},center:sphere.center.toArray(),radius:sphere.radius});
      const view=readView(),direction=new THREE.Vector3().fromArray(view.target).sub(new THREE.Vector3().fromArray(view.position));
      const distance=Math.max(camera.near*4,Math.min(direction.length()*.35,2)),scale=distance/next.distance;
      frame.scale.setScalar(scale);frame.position.fromArray(view.position).addScaledVector(direction.normalize(),distance).addScaledVector(sphere.center,-scale);frame.updateMatrixWorld(true);placed=true;
     },
     present(amount){
      for(const h of acquired)h.root.visible=amount>0;
      for(const h of acquired)h.root.traverse(node=>{
       if(node.isMesh){if(!shadows.has(node))shadows.set(node,node.castShadow);node.castShadow=amount>0&&amount<1?false:shadows.get(node);}
       for(const material of [node.material].flat().filter(Boolean)){
        // Lighting can wrap a material during arrival. Its copied opacity is
        // presentation state; retain the authored state through that owner chain.
        const chain=sceneRadianceMaterialChain(material),source=chain.at(-1);
        const authored=chain.map(value=>materials.get(value)).find(Boolean)??{opacity:source.opacity,transparent:source.transparent};
        for(const value of chain){
         materials.set(value,authored);
         const transparent=amount>0&&amount<1?true:authored.transparent;
         if(value.transparent!==transparent){value.transparent=transparent;value.needsUpdate=true;}
         value.opacity=authored.opacity*amount;
        }
       }
      });
      if(amount===0&&placed){frame.position.set(0,0,0);frame.scale.setScalar(1);frame.updateMatrixWorld(true);placed=false;restoreSelection();}
      parts?.present?.(amount);
      redraw();
     },
     async dispose(){restoreSelection();handles=[];await release();},
    };
   }catch(error){await release();throw error;}
  },
 });
 back.onclick=()=>{controller.exit();document.defaultView.kaminosAssets?.close();};
 return Object.freeze({...controller,owns:id=>ids.has(id),handles:()=>handles.map(h=>({id:h.id,root:h.root,source:h.source})),
  attach(root,metadata){if(!memberOwner)throw Error('Prepare the workshop before attaching a member');return memberOwner(root,metadata);},view:readView,authored:doc=>withoutMountedWorkshop(doc,id=>ids.has(id)),
 });
}
