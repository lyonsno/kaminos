import { Vector2 } from 'three/webgpu';
import { MaterialPhotoViewer as PhotoViewer } from './viewer.js';
import { ENVIRONMENTS,loadEnvironmentTexture,lightFromRing,lightOnRing } from './environment.js';

const modes=['original','photo','relit','materials'];

export class MaterialPhotoViewer {
  async init(container,device) {
    this.container=container;this.views={};this.focus=null;this.cache=new Map();this.environmentTicket=0;
    const rig={orbit:new Vector2(),target:new Vector2(),current:new Vector2()};
    for(const mode of modes){
      const canvas=container.querySelector(`[data-canvas=${mode}]`),view=new PhotoViewer();
      this.views[mode]=view;
      await view.init(canvas,device,{interactive:mode==='original',interactionTarget:container,rig});
      view.mode=mode;
    }
    this.orbit=rig.orbit;this.target=rig.target;
    await this.loadEnvironment('studio');
    this.showComparison();return this;
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
    this.container.dataset.focus=this.focus??'';
    for(const mode of modes){
      const view=this.views[mode];view.canvas.parentElement.hidden=!!this.focus&&this.focus!==mode;
      view.resize();
    }
  }
  showComparison(){this.focus=null;this.layout();}
  setImage(image,depth){
    this.primary.setImage(image,depth);
    const shared=depth?{surface:this.surface,geometry:this.primary.mesh.geometry}:null;
    for(const mode of modes.slice(0,3))this.views[mode].setImage(image,depth,shared);
    this.primary.canvas.parentElement.dataset.pending='Estimating materials';this.primary.available=false;
    const {x,y}=this.primary.getLightHandle();this.setLightHandle(x,y);
    this.layout();
  }
  setMaterials(output){this.primary.setMaterials(output);this.primary.available=true;delete this.primary.canvas.parentElement.dataset.pending;}
  getTuning(){return this.primary.getTuning();}
  setTuning(value){for(const view of Object.values(this.views))view.setTuning(value);}
  getLighting(){return this.primary.getLighting();}
  setLighting(value){for(const view of Object.values(this.views))view.setLighting(value);}
  getLightHandle(){return this.primary.getLightHandle();}
  getLightRing(){return lightOnRing(this.getLightHandle());}
  setLightScreenPosition(u,v){const {x,y}=lightFromRing(u,v);this.setLightHandle(x,y);}
  setLightHandle(x,y){for(const view of Object.values(this.views))view.setLightHandle(x,y);}
  setLight(){this.primary.setLight();const {x,y}=this.primary.getLightHandle();this.setLightHandle(x,y);}
  reset(){this.primary.reset();this.setLight();}
  async loadEnvironment(name){
    if(!Object.hasOwn(ENVIRONMENTS,name))throw Error('Unknown HDR environment');
    const ticket=++this.environmentTicket;
    if(!this.cache.has(name)){
      const promise=loadEnvironmentTexture(name).catch(error=>{this.cache.delete(name);throw error;});
      this.cache.set(name,promise);
    }
    const texture=await this.cache.get(name);
    if(ticket!==this.environmentTicket)return false;
    for(const view of Object.values(this.views))view.setEnvironment(texture);
    this.environment=name;return true;
  }
  exportPreset(){return {...this.primary.exportPreset(),environment:this.environment};}
  async applyPreset(value){
    this.primary.validatePreset(value);
    const name=value.environment??this.environment;
    if(!Object.hasOwn(ENVIRONMENTS,name))throw Error('Unknown HDR environment');
    if(!await this.loadEnvironment(name))throw Error('Preset superseded by another environment choice');
    for(const view of Object.values(this.views))view.applyPreset(value);
  }
  presentation(){
    const views=Object.fromEntries(modes.map(mode=>[mode,this.views[mode].presentation()]));
    return {...views[this.mode],comparison:{enabled:this.comparison,focus:this.focus,views}};
  }
  clear(){for(const mode of ['original','photo','relit','materials'])this.views[mode].clear();}
  async dispose(){
    this.environmentTicket++;
    const errors=[];
    for(const view of Object.values(this.views))try{await view.dispose();}catch(error){errors.push(error);}
    for(const promise of this.cache.values())try{(await promise).dispose();}catch{}
    if(errors.length)throw new AggregateError(errors,'Comparison disposal failed');
  }
}
