import {pass,mrt,output,uniform} from 'three/tsl';

// Opt-in Workbench comparison. The normal scene capture remains the receiver
// and flame-light cache; this additional pass replaces only the sampled source.
export function createGISourceComparison(scene,camera,receiver,normal,changed) {
  const source=pass(scene,camera,{samples:0});
  source.name='SSGI proxy source comparison';source.transparent=false;
  source.setMRT(mrt({output,normal}));
  const enabled=uniform(false,'bool'),showSource=uniform(false,'bool');
  let lease=null,selection='detailed',frames=0;
  const update=source.updateBefore;
  source.updateBefore=function(frame){
    if(!enabled.value||!lease)return;
    // The actual capture also updates the ordinary shadow maps. The proxy draw
    // consumes them without replacing their casters or updating those maps.
    frame.updateBeforeNode(receiver);
    const {root,candidates}=lease,proxy=candidates[selection]?.root;
    if(!root.parent||!proxy)throw Error('GI source comparison lost its mounted asset');
    const renderer=frame.renderer,parent=root.parent,visible=root.visible,shadows=[];
    const saved={target:renderer.getRenderTarget(),mrt:renderer.getMRT(),autoClear:renderer.autoClear,
      opaque:renderer.opaque,transparent:renderer.transparent,context:renderer.contextNode,
      mask:camera.layers.mask,name:scene.name,override:scene.overrideMaterial};
    scene.traverse(object=>{if(object.isLight&&object.shadow){const s=object.shadow;shadows.push([s,s.autoUpdate,s.needsUpdate]);s.autoUpdate=false;s.needsUpdate=false;}});
    if(root.matrixAutoUpdate)root.updateMatrix();proxy.matrixAutoUpdate=false;proxy.matrix.copy(root.matrix);
    try {
      root.visible=false;parent.add(proxy);proxy.visible=visible;
      update.call(this,frame);frames++;
    } finally {
      proxy.removeFromParent();root.visible=visible;
      for(const [s,auto,needs] of shadows){s.autoUpdate=auto;s.needsUpdate=needs;}
      renderer.setRenderTarget(saved.target);renderer.setMRT(saved.mrt);renderer.autoClear=saved.autoClear;
      renderer.opaque=saved.opaque;renderer.transparent=saved.transparent;renderer.contextNode=saved.context;
      camera.layers.mask=saved.mask;scene.name=saved.name;scene.overrideMaterial=saved.override;
    }
  };
  const read=()=>({enabled:enabled.value,selection,showSource:showSource.value,frames,
    additionalSourcePasses:enabled.value?1:0,receiver:'detailed-scene',
    candidates:lease?Object.fromEntries(Object.entries(lease.candidates).map(([key,value])=>[key,value.identity])):{}});
  return {source,showSource,read,
    inputs:{enabled,beauty:source.getTextureNode('output'),depth:source.getTextureNode('depth'),normal:source.getTextureNode('normal')},
    open(root,candidates){
      if(lease)throw Error('A GI source comparison already owns this renderer');
      if(!root?.parent||!candidates||!Object.keys(candidates).length)throw Error('Mounted receiver and source candidates required');
      for(const [key,item] of Object.entries(candidates))if(key==='detailed'||!item.root?.isObject3D||item.root.parent||!item.identity)throw Error('Detached, identified GI candidates required');
      const owned={root,candidates};lease=owned;
      const current=()=>{if(lease!==owned)throw Error('GI source comparison is closed');};
      return {read,
        select(value){current();if(value!=='detailed'&&!candidates[value])throw Error('Unknown GI source');selection=value;enabled.value=value!=='detailed';changed('source-representation');return read();},
        show(value){current();showSource.value=!!value;changed('source-view');return read();},
        dispose(){if(lease!==owned)return;enabled.value=false;showSource.value=false;selection='detailed';lease=null;changed('source-comparison-closed');},
      };
    },
  };
}
