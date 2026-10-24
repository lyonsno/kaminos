import { Vector2 } from 'three/webgpu';
import { MaterialPhotoViewer as PhotoViewer } from './viewer.js';
import { ENVIRONMENTS,loadEnvironmentTexture,lightFromRing,lightOnRing } from './environment.js';
import { chooseComparisonLayout } from './layout.js';

const modes=['original','photo','relit','materials'];

export class MaterialPhotoViewer {
  async init(container,device,{foreground=null,onError=error=>console.error(error)}={}) {
    this.container=container;this.views={};this.focus=null;this.cache=new Map();this.environmentTicket=0;
    this.foreground=foreground;this.environmentRequests=new Set();
    const rig={orbit:new Vector2(),target:new Vector2(),current:new Vector2()};
    for(const mode of modes){
      const canvas=container.querySelector(`[data-canvas=${mode}]`),view=new PhotoViewer();
      this.views[mode]=view;
      await view.init(canvas,device,{interactive:mode==='original',interactionTarget:container,rig,autoRender:!foreground});
      view.mode=mode;
    }
    this.orbit=rig.orbit;this.target=rig.target;
    await this.loadEnvironment('studio');
    this.resizeObserver=new ResizeObserver(()=>this.layout());this.resizeObserver.observe(container);
    this.showComparison();
    if(foreground)this.startFrames(foreground,onError);
    return this;
  }
  startFrames(foreground,onError){
    let sequence=0;
    this.frameStats={rendered:0,duringModel:0};
    const frame=time=>{
      if(this.stopped)return;
      try{
        this.pendingFrame=foreground.request({requestId:`material-photo:${++sequence}`,run:opportunity=>{
          let rendered=0;
          if(!this.stopped)for(const view of Object.values(this.views))if(view.render(time))rendered++;
          if(rendered){this.frameStats.rendered++;if(opportunity.runId)this.frameStats.duringModel++;}
          return {renderedViews:rendered};
        }});
        this.pendingFrame.completion.then(receipt=>{
          this.pendingFrame=null;
          if(this.stopped)return;
          if(receipt.status!=='completed')throw Error(receipt.failure?.error?.message??`Photograph frame ${receipt.status}`);
          this.frameId=requestAnimationFrame(frame);
        }).catch(onError);
      }catch(error){onError(error);}
    };
    this.frameId=requestAnimationFrame(frame);
  }
  get primary(){return this.views.materials;}
  get selected(){return this.views[this.mode];}
  get renderer(){return this.primary.renderer;}
  get gi(){return this.primary.gi;}
  get surface(){return this.primary.surface;}
  get original(){return this.primary.original;}
  get maps(){return this.primary.maps;}
  get comparison(){return !this.focus;}
  get mode(){return this.focus??(this.maps?'materials':this.surface?'photo':'original');}
  set mode(mode){
    if(!modes.includes(mode))throw Error('Unknown photograph view');
    this.focus=mode;this.layout();
  }
  get map(){return this.selected.map;}
  set map(value){for(const view of Object.values(this.views))view.map=value;}
  get useGI(){return this.primary.useGI;}
  set useGI(value){for(const view of Object.values(this.views))view.useGI=value;}
  get glow(){return this.primary.glow;}
  set glow(value){this.primary.glow=value;}
  layout(){
    const bounds=this.container.getBoundingClientRect();
    this.container.dataset.layout=chooseComparisonLayout(bounds.width,bounds.height,this.primary.aspect??1);
    this.container.dataset.focus=this.focus??'';
    for(const mode of modes){
      const view=this.views[mode];view.canvas.closest('[data-tile]').hidden=!!this.focus&&this.focus!==mode;
      view.resize();
    }
  }
  showComparison(){this.focus=null;this.layout();}
  setImage(image,depth,cutout=null){
    const preset=this.primary.exportPreset();
    this.primary.setImage(image,depth,null,cutout);
    const shared=depth?{surface:this.surface,geometry:this.primary.mesh.geometry}:null;
    this.views.relit.setImage(image,depth,shared,cutout);
    this.views.photo.setImage(image,depth,cutout?null:shared,null);
    const photograph=depth?{surface:this.views.photo.surface,geometry:this.views.photo.mesh.geometry}:null;
    this.views.original.setImage(image,depth,photograph,null);
    for(const [mode,view]of Object.entries(this.views)){view.applyPreset(preset);view.glow=mode==='materials'&&preset.glow;}
    this.primary.available=true;this.setMaterialStatus('Materials not generated');
    const {x,y}=this.primary.getLightHandle();this.setLightHandle(x,y);
    this.layout();
  }
  setMaterialStatus(message){
    const surface=this.primary.canvas.parentElement;
    if(message)surface.dataset.pending=message;else delete surface.dataset.pending;
  }
  setMaterials(output){this.primary.setMaterials(output);this.primary.available=true;this.setMaterialStatus(null);}
  getMaterialContrast(){return this.primary.getMaterialContrast();}
  setMaterialContrast(value){this.primary.setMaterialContrast(value);}
  getDiagnostic(){return this.primary.getDiagnostic();}
  setDiagnostic(value){for(const view of Object.values(this.views))view.setDiagnostic(value);}
  getTuning(){return this.primary.getTuning();}
  setTuning(value){for(const view of Object.values(this.views))view.setTuning(value);}
  getLighting(){return this.primary.getLighting();}
  getEffects(){return this.primary.getEffects();}
  setEffects(value){for(const view of Object.values(this.views))view.setEffects(value);}
  setLighting(value){for(const view of Object.values(this.views))view.setLighting(value);}
  getLightHandle(){return this.primary.getLightHandle();}
  getLightRing(){return lightOnRing(this.getLightHandle());}
  setLightScreenPosition(u,v){const {x,y}=lightFromRing(u,v);this.setLightHandle(x,y);}
  setLightHandle(x,y){for(const view of Object.values(this.views))view.setLightHandle(x,y);}
  setLight(){this.primary.setLight();const {x,y}=this.primary.getLightHandle();this.setLightHandle(x,y);}
  reset(){this.primary.reset();this.setLight();}
  async loadEnvironment(name){
    if(this.stopped)throw Error('Photograph viewer disposed');
    if(!Object.hasOwn(ENVIRONMENTS,name))throw Error('Unknown HDR environment');
    const ticket=++this.environmentTicket;
    if(!this.cache.has(name)){
      const promise=loadEnvironmentTexture(name).catch(error=>{this.cache.delete(name);throw error;});
      this.cache.set(name,promise);
    }
    const texture=await this.cache.get(name);
    if(this.stopped)throw Error('Photograph viewer disposed');
    if(ticket!==this.environmentTicket)return false;
    const apply=()=>{
      if(this.stopped)throw Error('Photograph viewer disposed');
      if(ticket!==this.environmentTicket)return false;
      // PMREM generation submits GPU work, so environment changes need admission too.
      for(const view of Object.values(this.views))view.setEnvironment(texture);
      this.environment=name;return true;
    };
    if(!this.foreground)return apply();
    const request=this.foreground.request({requestId:`material-photo:environment:${ticket}`,run:apply});
    this.environmentRequests.add(request);
    try{
      const receipt=await request.completion;
      if(receipt.status!=='completed')throw Error(receipt.failure?.error?.message??`Photograph environment ${receipt.status}`);
      return receipt.result;
    }finally{this.environmentRequests.delete(request);}
  }
  exportPreset(){return {...this.primary.exportPreset(),environment:this.environment};}
  async applyPreset(value){
    this.primary.validatePreset(value);
    const name=value.environment??this.environment;
    if(!Object.hasOwn(ENVIRONMENTS,name))throw Error('Unknown HDR environment');
    if(!await this.loadEnvironment(name))throw Error('Preset superseded by another environment choice');
    for(const [mode,view]of Object.entries(this.views)){view.applyPreset(value);view.glow=mode==='materials'&&value.glow;}
  }
  presentation(){
    const views=Object.fromEntries(modes.map(mode=>[mode,this.views[mode].presentation()]));
    return {...views[this.mode],comparison:{enabled:this.comparison,focus:this.focus,views},renderCallbacks:this.frameStats?{...this.frameStats}:null};
  }
  clear(){for(const mode of ['original','photo','relit','materials'])this.views[mode].clear();}
  async dispose(){
    this.stopped=true;
    this.environmentTicket++;
    if(this.frameId!=null)cancelAnimationFrame(this.frameId);
    const pending=[...(this.environmentRequests??[])];
    if(this.pendingFrame)pending.push(this.pendingFrame);
    for(const request of pending)request.cancel('Photograph viewer disposed');
    await Promise.all(pending.map(request=>request.completion));
    this.resizeObserver?.disconnect();
    const errors=[];
    for(const view of Object.values(this.views))try{await view.dispose();}catch(error){errors.push(error);}
    for(const promise of this.cache.values())try{(await promise).dispose();}catch{}
    if(errors.length)throw new AggregateError(errors,'Comparison disposal failed');
  }
}
