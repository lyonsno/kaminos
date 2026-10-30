import {Scene,InstancedMesh,RenderTarget,FloatType,HalfFloatType,NearestFilter,DoubleSide,CustomBlending,OneFactor,AddEquation,Color,Vector2,Vector3} from './lib/three.core.js';
import {MeshBasicNodeMaterial,TSL} from './lib/three.webgpu.js';
const {Fn,If,Discard,attribute,vec4,vec3,float,bool,uv,texture,screenUV,positionView,normalViewGeometry,faceDirection,uniform}=TSL;

// Reconstruct attributes of the nearest wall, not a stack of independently transparent discs.
// The source geometry still supplies visibility/depth; this pass never changes source rows.
export function createSurfelSurface(meshes,radius){
 const targets=[FloatType,HalfFloatType,HalfFloatType,HalfFloatType].map((type,i)=>new RenderTarget(1,1,{type,minFilter:NearestFilter,magFilter:NearestFilter,depthBuffer:i===0}));
 const [nearest,colorSum,normalSum,materialSum]=targets;
 const tolerance=uniform(radius*1.5);
 const nearestSample=texture(nearest.texture,screenUV);
 const viewNormal=normalViewGeometry.mul(faceDirection).normalize();
 const reject=()=>If(positionView.z.negate().sub(nearestSample.a).abs().greaterThan(tolerance).or(viewNormal.dot(nearestSample.xyz).lessThan(.5)),()=>Discard());
 const disc=uv().mul(2).sub(1);
 const weight=float(1).sub(disc.dot(disc)).max(0).pow(2);
 const values=[attribute('surfelColor','vec3'),viewNormal,vec3(attribute('surfelOpacity','float'),attribute('surfelMetallic','float'),attribute('surfelRoughness','float'))];
 const materials=[new MeshBasicNodeMaterial({side:DoubleSide})];
 materials[0].fragmentNode=vec4(viewNormal,positionView.z.negate());
 for(const value of values){
  const m=new MeshBasicNodeMaterial({side:DoubleSide,transparent:true,depthTest:false,depthWrite:false,blending:CustomBlending,blendSrc:OneFactor,blendDst:OneFactor,blendEquation:AddEquation,blendSrcAlpha:OneFactor,blendDstAlpha:OneFactor,blendEquationAlpha:AddEquation});
  m.fragmentNode=Fn(()=>{reject();return vec4(value.mul(weight),weight);})();materials.push(m);
 }
 const scenes=materials.map(material=>{
  const scene=new Scene();
  for(const source of meshes){const copy=new InstancedMesh(source.geometry,material,source.count);copy.instanceMatrix=source.instanceMatrix;copy.matrixAutoUpdate=false;copy.frustumCulled=false;scene.add(copy);}
  return scene;
 });
 const normalized=target=>{const t=texture(target.texture,screenUV);return t.xyz.div(t.a.max(1e-6));};
 const color=normalized(colorSum),normal=normalized(normalSum).normalize(),parameters=normalized(materialSum);
 let key='',busy=false,disposed=false,updates=0,lastRenderer;
 function prepare(renderer,scene,camera){
  if(busy||disposed)return;
  lastRenderer=renderer;
  const oldTarget=renderer.getRenderTarget(),size=oldTarget?new Vector2(oldTarget.width,oldTarget.height):renderer.getDrawingBufferSize(new Vector2());
  const next=[size.x,size.y,...camera.matrixWorld.elements,...camera.projectionMatrix.elements,...meshes.flatMap(m=>m.matrixWorld.elements)].join(',');
  if(next===key)return;
  const oldClear=renderer.getClearColor(new Color()),oldAlpha=renderer.getClearAlpha(),oldAuto=renderer.autoClear,oldMRT=renderer.getMRT(),oldFunction=renderer.getRenderObjectFunction(),oldOpaque=renderer.opaque,oldTransparent=renderer.transparent,oldFace=renderer.getActiveCubeFace?.()??0,oldMip=renderer.getActiveMipmapLevel?.()??0;
  busy=true;
  try{
   renderer.setMRT(null);renderer.setRenderObjectFunction(null);renderer.setClearColor(0,0);renderer.autoClear=true;renderer.opaque=true;renderer.transparent=true;
   const scale=new Vector3().setFromMatrixScale(meshes[0].matrixWorld);tolerance.value=radius*1.5*Math.max(scale.x,scale.y,scale.z);
   for(let p=0;p<targets.length;p++){
    targets[p].setSize(size.x,size.y);
    scenes[p].children.forEach((copy,i)=>copy.matrix.copy(meshes[i].matrixWorld));
    renderer.setRenderTarget(targets[p]);renderer.render(scenes[p],camera);
   }
   key=next;updates++;
  }finally{renderer.setRenderTarget(oldTarget,oldFace,oldMip);renderer.setMRT(oldMRT);renderer.setRenderObjectFunction(oldFunction);renderer.setClearColor(oldClear,oldAlpha);renderer.autoClear=oldAuto;renderer.opaque=oldOpaque;renderer.transparent=oldTransparent;busy=false;}
 }
 return {prepare,invalidate(){key='';},mask:Fn(()=>{reject();return bool(true);})(),color:Fn(()=>{reject();return vec4(color,1);})(),normal,opacity:parameters.x,metallic:parameters.y,roughness:parameters.z,
  read:()=>({updates,width:nearest.width,height:nearest.height,depthTolerance:tolerance.value,route:'nearest-wall-normalized-attributes'}),
  async inspect(x,y){if(!lastRenderer||disposed)throw Error('Surface has not rendered or was disposed');if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=nearest.width||y>=nearest.height)throw Error('Surface sample outside the buffer');return Promise.all(targets.map(async t=>({type:t.texture.type,values:Array.from(await lastRenderer.readRenderTargetPixelsAsync(t,x,y,1,1))})));},
  dispose(){disposed=true;for(const t of targets)t.dispose();for(const m of materials)m.dispose();for(const s of scenes)for(const m of s.children)m.dispose();}
 };
}
