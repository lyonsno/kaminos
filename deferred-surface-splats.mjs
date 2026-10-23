import {Group,Scene,Mesh,QuadMesh,NodeMaterial,PlaneGeometry,InstancedBufferGeometry,InstancedInterleavedBuffer,InterleavedBufferAttribute,RenderTarget,FloatType,HalfFloatType,NearestFilter,DoubleSide,DataUtils,CustomBlending,OneFactor,AddEquation,Vector2,Vector3,RendererUtils,MeshBasicNodeMaterial,MeshPhysicalNodeMaterial,TSL} from './lib/three.webgpu.js';
const {Fn,If,Discard,attribute,vec2,vec3,vec4,float,bool,uv,screenUV,texture,uniform,varying,positionGeometry,positionView,positionViewDirection,faceDirection,transformNormalToView,outputStruct,cameraProjectionMatrix,cameraProjectionMatrixInverse,cameraWorldMatrix,cameraNear,cameraFar,getViewPosition,viewZToPerspectiveDepth,viewZToOrthographicDepth,viewportOpaqueMipTexture,refract}=TSL;

// Surface kernels reconstruct coverage and material attributes independently.
// Only the two resolved surfaces run physical lighting; source quads do not.
class SurfaceMaterial extends MeshPhysicalNodeMaterial {
 setupLighting(builder){
  positionView.assign(this.surfacePosition).toStack();
  positionViewDirection.assign(builder.camera.isOrthographicCamera?vec3(0,0,1):this.surfacePosition.negate().normalize()).toStack();
  return super.setupLighting(builder).context({positionView:this.surfacePosition,positionWorld:this.surfaceWorld,shadowPositionWorld:this.surfaceWorld});
 }
 setupLightingModel(builder){const model=super.setupLightingModel(builder);model.transmission=false;return model;}
}
export function createDeferredSurfaceSplats(data,meta,footprints){
 if(!(data instanceof Float32Array)||meta.stride!==12||!Number.isSafeInteger(meta.count)||meta.count<1||data.length!==meta.count*12||!data.every(Number.isFinite)||!(meta.radius>0)||!(footprints instanceof Float32Array)||footprints.length!==meta.count*8||!footprints.every(Number.isFinite))throw Error('Invalid surface splat payload');
 for(let i=0;i<meta.count;i++)if(Math.hypot(...data.subarray(i*12+3,i*12+6))<1e-8||footprints[i*8+3]<=0||footprints[i*8+7]<=0)throw Error('Invalid splat frame');
 const root=new Group();root.name='Deferred TRELLIS surface splats';
 const populations=[[],[]];for(let i=0;i<meta.count;i++)populations[data[i*12+11]<.98?1:0].push(i);
 const zeroMaterial=new NodeMaterial();zeroMaterial.fragmentNode=outputStruct(vec4(0),vec4(0),vec4(0));zeroMaterial.depthTest=false;zeroMaterial.depthWrite=false;const zeroQuad=new QuadMesh(zeroMaterial);
 const layers=[],ior=uniform(1.45),thickness=uniform(.06),worldScale=uniform(1);
 let state={mode:'glass',ior:1.45,thickness:.06},disposed=false,busy=false,key='',updates=0,lastRenderer;
 const fullscreen=material=>{material.vertexNode=vec4(positionGeometry.xy,0,1);};
 for(let p=0;p<2;p++){
  const ids=populations[p];if(!ids.length)continue;
  const plane=new PlaneGeometry(2,2),geometry=new InstancedBufferGeometry();geometry.index=plane.index.clone();geometry.setAttribute('position',plane.attributes.position.clone());geometry.setAttribute('uv',plane.attributes.uv.clone());plane.dispose();geometry.instanceCount=ids.length;
  const packed=new Float32Array(ids.length*20);
  ids.forEach((id,j)=>{packed.set(data.subarray(id*12,id*12+12),j*20);packed.set(footprints.subarray(id*8,id*8+8),j*20+12);for(let c=0;c<3;c++){const v=Math.min(1,Math.max(0,packed[j*20+6+c]));packed[j*20+6+c]=v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}});
  const buffer=new InstancedInterleavedBuffer(packed,20);
  for(const [name,width,offset]of [['center',3,0],['sourceNormal',3,3],['sourceColor',3,6],['sourceMetal',1,9],['sourceRough',1,10],['sourceOpacity',1,11],['axisU',4,12],['axisV',4,16]])geometry.setAttribute(name,new InterleavedBufferAttribute(buffer,width,offset));
  const nearest=new RenderTarget(1,1,{type:FloatType,minFilter:NearestFilter,magFilter:NearestFilter});
  const sums=new RenderTarget(1,1,{count:3,type:HalfFloatType,minFilter:NearestFilter,magFilter:NearestFilter,depthBuffer:false});
  const tolerance=uniform(meta.radius*1.5),disc=uv().mul(2).sub(1),r2=disc.dot(disc);
  const viewNormal=varying(transformNormalToView(attribute('sourceNormal','vec3').normalize())).mul(faceDirection).normalize();
  const nearSample=texture(nearest.texture,screenUV),weight=r2.mul(-4.5).exp();
  const sourcePosition=attribute('center','vec3').add(attribute('axisU','vec4').xyz.mul(attribute('axisU','vec4').w.mul(positionGeometry.x).mul(3))).add(attribute('axisV','vec4').xyz.mul(attribute('axisV','vec4').w.mul(positionGeometry.y).mul(3)));
  const mask=Fn(()=>{If(r2.greaterThan(1),()=>Discard());return bool(true);})();
  const nearestMaterial=new MeshBasicNodeMaterial({side:DoubleSide});nearestMaterial.positionNode=sourcePosition;nearestMaterial.maskNode=mask;nearestMaterial.outputNode=vec4(viewNormal,positionView.z.negate());nearestMaterial.toneMapped=false;
  const sumMaterial=new MeshBasicNodeMaterial({side:DoubleSide,transparent:true,depthTest:false,depthWrite:false,blending:CustomBlending,blendSrc:OneFactor,blendDst:OneFactor,blendEquation:AddEquation,blendSrcAlpha:OneFactor,blendDstAlpha:OneFactor,blendEquationAlpha:AddEquation});
  sumMaterial.positionNode=sourcePosition;sumMaterial.maskNode=mask;sumMaterial.toneMapped=false;
  const reject=Fn(()=>{If(positionView.z.negate().sub(nearSample.a).abs().greaterThan(tolerance).or(viewNormal.dot(nearSample.xyz).lessThan(.5)),()=>Discard());return vec4(0);})();
  sumMaterial.colorNode=reject;
  sumMaterial.outputNode=outputStruct(vec4(attribute('sourceColor','vec3').mul(weight),weight),vec4(viewNormal.mul(weight),positionView.z.negate().mul(weight)),vec4(vec3(attribute('sourceOpacity','float'),attribute('sourceMetal','float'),attribute('sourceRough','float')).mul(weight),weight));
  const scenes=[nearestMaterial,sumMaterial].map(material=>{const scene=new Scene(),mesh=new Mesh(geometry,material);mesh.frustumCulled=false;mesh.matrixAutoUpdate=false;scene.add(mesh);return scene;});
  const c=texture(sums.textures[0],screenUV),n=texture(sums.textures[1],screenUV),m=texture(sums.textures[2],screenUV),den=c.a.max(1e-6);
  const color=c.rgb.div(den),normal=n.xyz.div(den).normalize(),parameters=m.xyz.div(den),z=n.a.div(den).negate();
  const depth=Fn(([],builder)=>builder.camera.isOrthographicCamera?viewZToOrthographicDepth(z,cameraNear,cameraFar):viewZToPerspectiveDepth(z,cameraNear,cameraFar))();
  const position=getViewPosition(screenUV,depth,cameraProjectionMatrixInverse),world=cameraWorldMatrix.mul(vec4(position,1)).xyz;
  const valid=c.a.greaterThan(1e-6);
  const material=new SurfaceMaterial({side:DoubleSide});fullscreen(material);material.surfacePosition=position;material.surfaceWorld=world;
  material.maskNode=valid;material.depthNode=depth;material.normalNode=normal;material.receivedShadowPositionNode=world;
  const mesh=new Mesh(new PlaneGeometry(2,2),material);mesh.frustumCulled=false;mesh.receiveShadow=true;mesh.name=p?'Resolved glass splats':'Resolved opaque splats';mesh.renderOrder=p?1:0;root.add(mesh);
  const aoMaterial=new MeshBasicNodeMaterial({side:DoubleSide});fullscreen(aoMaterial);aoMaterial.toneMapped=false;aoMaterial.maskNode=valid;aoMaterial.depthNode=depth;aoMaterial.colorNode=vec4(z.negate(),0,0,1);mesh.userData.kaminosAODepthMaterial=aoMaterial;
  // Screen-space optics: one authored travel distance, sampling only opaque color.
  const transmitted=Fn(()=>{
   const direction=refract(position.normalize(),normal,ior.reciprocal());
   const endpoint=cameraProjectionMatrix.mul(vec4(position.add(direction.mul(thickness).mul(worldScale)),1));
   const projected=endpoint.xy.div(endpoint.w).mul(.5).add(.5),coords=vec2(projected.x,projected.y.oneMinus()).clamp(.001,.999);
   return viewportOpaqueMipTexture(coords,parameters.z.mul(5)).rgb.mul(color);
  })();
  layers.push({mesh,material,aoMaterial,geometry,nearest,sums,scenes,nearestMaterial,sumMaterial,tolerance,color,normal,parameters,transmitted,p,count:ids.length});
 }
 function apply(){
  ior.value=state.ior;thickness.value=state.thickness;
  for(const l of layers){const {material,color,normal,parameters,p}=l;
   material.colorNode=vec4(state.mode==='plain'?vec3(.5):state.mode==='normals'?normal.mul(.5).add(.5):color,1);
   material.lights=state.mode!=='normals';material.metalnessNode=state.mode==='plain'?float(0):parameters.y;material.roughnessNode=state.mode==='plain'?float(.8):parameters.z;
   material.transmission=state.mode==='glass'&&p?1:0;material.ior=state.ior;
   material.backdropNode=material.transmission?l.transmitted:null;material.backdropAlphaNode=material.transmission?parameters.x.oneMinus():null;
   material.opacityNode=state.mode==='opacity'?parameters.x:null;material.alphaHash=state.mode==='opacity';material.needsUpdate=true;
  }
 }
 function prepare(renderer,scene,camera){
  if(busy||disposed)return;lastRenderer=renderer;
  const size=renderer.getDrawingBufferSize(new Vector2()),next=[size.x,size.y,...camera.matrixWorld.elements,...camera.projectionMatrix.elements,...root.matrixWorld.elements].join(',');if(key===next)return;
  busy=true;const oldOpaque=renderer.opaque,oldTransparent=renderer.transparent,saved=RendererUtils.resetRendererState(renderer);
  try{
   renderer.setMRT(null);renderer.setRenderObjectFunction(null);renderer.setClearColor(0,0);renderer.autoClear=false;renderer.opaque=true;renderer.transparent=true;
   const scale=new Vector3().setFromMatrixScale(root.matrixWorld);worldScale.value=Math.max(scale.x,scale.y,scale.z);
   for(const l of layers){l.tolerance.value=meta.radius*1.5*worldScale.value;l.nearest.setSize(size.x,size.y);l.sums.setSize(size.x,size.y);
    for(const [i,target]of [l.nearest,l.sums].entries()){l.scenes[i].children[0].matrix.copy(root.matrixWorld);renderer.setRenderTarget(target);renderer.clear();if(i===1)zeroQuad.render(renderer);renderer.render(l.scenes[i],camera);}
   }
   updates++;key=next;
  }finally{RendererUtils.restoreRendererState(renderer,saved);renderer.opaque=oldOpaque;renderer.transparent=oldTransparent;busy=false;}
 }
 for(const l of layers)l.mesh.onBeforeRender=prepare;
 apply();
 return {root,read:()=>({...state,count:meta.count,sourceCount:meta.sourceCount??meta.count,route:'deferred-surface-splats',layers:layers.length,lightingPrimitives:layers.length*2,updates,width:layers[0].nearest.width,height:layers[0].nearest.height,populations:layers.map(l=>({glass:!!l.p,count:l.count}))}),set(patch){
  if(disposed)throw Error('Surface splats disposed');const next={...state,...patch};if(!['glass','opaque','opacity','plain','normals'].includes(next.mode)||!Number.isFinite(next.ior)||next.ior<1||next.ior>2.5||!Number.isFinite(next.thickness)||next.thickness<0||next.thickness>1)throw Error('Invalid splat optics');state={mode:next.mode,ior:next.ior,thickness:next.thickness};apply();return this.read();
 },async inspectSurface(x,y){if(!lastRenderer||disposed)throw Error('Splats have not rendered');return Promise.all(layers.map(async l=>({glass:!!l.p,nearest:Array.from(await lastRenderer.readRenderTargetPixelsAsync(l.nearest,x,y,1,1)),sums:await Promise.all(l.sums.textures.map(async(_,i)=>Array.from(await lastRenderer.readRenderTargetPixelsAsync(l.sums,x,y,1,1,i),DataUtils.fromHalfFloat)))})));},
 dispose(){if(disposed)return;disposed=true;zeroMaterial.dispose();for(const l of layers){l.mesh.geometry.dispose();l.geometry.dispose();for(const m of [l.material,l.aoMaterial,l.nearestMaterial,l.sumMaterial])m.dispose();l.nearest.dispose();l.sums.dispose();}root.clear();}};
}
