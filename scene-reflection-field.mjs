import {RenderTarget,HalfFloatType,FloatType,RedFormat,NearestFilter,NodeMaterial,QuadMesh,TSL} from './lib/three.webgpu.js';
const {texture,passTexture,Fn,property,vec4,uv,outputStruct,context}=TSL;

// One radiance/history grid. Both grids share the full-resolution opaque source
// and source pyramid; each retains independent geometry and temporal history.
export class ReflectionField{
 constructor(owner,name,{dense=false}={}){
  this.owner=owner;this.dense=dense;this.frames=0;this.writeIndex=1;
  this.raw=new RenderTarget(1,1,{count:dense?3:2,type:HalfFloatType,depthBuffer:false,minFilter:NearestFilter,magFilter:NearestFilter});
  this.raw.textures[0].name=name+' current radiance and coverage';this.raw.textures[1].name=name+' logarithmic hit moments';
  if(dense){this.raw.textures[2].format=RedFormat;this.raw.textures[2].name=name+' allocation weight';}this.allocation=texture(this.raw.textures[dense?2:1]);
  this.targets=Array.from({length:2},()=>{
   const t=new RenderTarget(1,1,{count:4,depthBuffer:false,minFilter:NearestFilter,magFilter:NearestFilter});
   for(const [i,map]of t.textures.entries()){map.type=i===2?FloatType:HalfFloatType;if(i===2)map.format=RedFormat;map.name=name+' '+['resolved radiance','normal and roughness','metric depth','moments and applied history'][i];map.generateMipmaps=false;}return t;
  });
  this.result=passTexture(owner,this.targets[0].textures[0]);this.surface=texture(this.targets[0].textures[1]);this.surfaceDepth=texture(this.targets[0].textures[2]);
  this.oldColor=texture(this.targets[0].textures[0]);this.oldNormal=texture(this.targets[0].textures[1]);this.oldDepth=texture(this.targets[0].textures[2]);this.oldStats=texture(this.targets[0].textures[3]);
  this.current=texture(this.raw.texture);this.currentStats=texture(this.raw.textures[1]);this.statistics=texture(this.targets[0].textures[3]);
  this.traceMaterial=new NodeMaterial();this.traceMaterial.name=name+' ray query';this.traceQuad=new QuadMesh(this.traceMaterial);
  this.filterMaterial=new NodeMaterial();this.filterMaterial.name=name+' reconstruction';this.filterQuad=new QuadMesh(this.filterMaterial);
 }
 setup(shared,sample,reconstruct){
  const o=this.owner;this.traceMaterial.contextNode=context(shared);const traced=property('mat4');
  this.traceMaterial.colorNode=Fn(()=>{traced.assign(sample({coords:uv(),depthMap:o.depth,colorMap:o.filteredColor,colorSampler:TSL.sampler(o.filteredColor),normalMap:o.normal,projection:o.projection,inverseProjection:o.inverseProjection,maxDistance:o.distance,thickness:o.thickness,nearPlane:o.near,steps:o.steps,refinementSteps:o.refinementSteps,frame:o.frame,roughnessCutoff:o.cutoff,samples:o.samples,stable:o.stable,coarseStats:this.dense?o.coarse.currentStats:this.oldStats,dense:this.dense}));return vec4(0);})();
  this.traceMaterial.outputNode=this.dense?outputStruct(traced.element(0),traced.element(1),traced.element(2).x):outputStruct(traced.element(0),traced.element(1));
  this.filterMaterial.contextNode=context(shared);const filtered=property('mat4');
  this.filterMaterial.colorNode=Fn(()=>{filtered.assign(reconstruct({coords:uv(),current:this.current,currentStats:this.currentStats,depthMap:o.depth,normalMap:o.normal,oldColor:this.oldColor,oldNormal:this.oldNormal,oldDepth:this.oldDepth,oldStats:this.oldStats,inverseProjection:o.inverseProjection,toPrevious:o.toPreviousView,previousProjection:o.oldProjection,previousInverseProjection:o.oldInverseProjection,historyValid:o.valid,historyWeight:o.historyWeight,roughnessCutoff:o.cutoff,detailMask:this.dense?this.allocation:this.oldStats,dense:this.dense}));return vec4(0);})();
  this.filterMaterial.outputNode=outputStruct(filtered.element(0),filtered.element(1),filtered.element(2).x,filtered.element(3));
  this.traceMaterial.needsUpdate=this.filterMaterial.needsUpdate=true;
 }
 setSize(w,h){this.raw.setSize(w,h);for(const t of this.targets)t.setSize(w,h);}
 render(renderer){
  renderer.setRenderTarget(this.raw);this.traceQuad.render(renderer);
  const t=this.targets[this.writeIndex];renderer.setRenderTarget(t);this.filterQuad.render(renderer);
  for(const [key,i]of [['result',0],['surface',1],['surfaceDepth',2],['oldColor',0],['oldNormal',1],['oldDepth',2],['oldStats',3],['statistics',3]])this[key].value=t.textures[i];
  this.writeIndex=1-this.writeIndex;this.frames++;
 }
 dispose(){this.raw.dispose();for(const t of this.targets)t.dispose();this.traceMaterial.dispose();this.filterMaterial.dispose();}
}
