import * as THREE from './lib/three.webgpu.js';

export function createLogBurnIndicator({object,fields,document,fitObject=false}) {
  const group=new THREE.Group(),owned=[];
  group.userData.kaminosBurnIndicator=true;
  group.userData.kaminosEditorHelper=true;
  const bounds=new THREE.Box3().setFromObject(object),size=bounds.getSize(new THREE.Vector3()),worldScale=object.getWorldScale(new THREE.Vector3());
  const width=fitObject?Math.min(.9,Math.max(size.x,size.z)*1.2):.9;
  let summary=fields[0].summaryNode;
  for(const field of fields.slice(1))summary=summary.max(field.summaryNode);
  const burning=summary.z.greaterThan(.002),warm=summary.x.greaterThan(.08);
  for(const [text,condition,color] of [
    ['Burning',burning,'#ffba54'],
    ['Not burning - warm',burning.not().and(warm),'#e4dfcd'],
    ['Not burning - cold',burning.not().and(warm.not()),'#d8e7e2'],
  ]) {
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#111a1de8';ctx.fillRect(0,0,512,96);
    ctx.font='bold 36px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(text,256,48);
    const texture=new THREE.CanvasTexture(canvas),material=new THREE.SpriteNodeMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false});
    material.opacityNode=condition.select(THREE.TSL.float(1),THREE.TSL.float(0));
    const sprite=new THREE.Sprite(material);sprite.scale.set(width/Math.abs(worldScale.x),width*(.17/.9)/Math.abs(worldScale.y),1);sprite.renderOrder=10000;group.add(sprite);owned.push(texture,material);
  }
  object.add(group);
  const local=object.worldToLocal(bounds.getCenter(new THREE.Vector3()));
  local.y+=size.y/worldScale.y*.7;group.position.copy(local);
  return {dispose(){object.remove(group);for(const resource of owned)resource.dispose();}};
}
