import pile from './hand-goin-pile.experiment.mjs';
import {Group,Mesh,RingGeometry,MeshStandardMaterial,DoubleSide} from '../lib/three.core.js';
import {PLAY_SPACE_DEFAULTS} from './hand-play-space.mjs';

export const PLAY_INPUTS={playSpace:{...PLAY_SPACE_DEFAULTS},goinPile:{count:24,mass:.25,couplingSteps:8,collisionSides:12,
  stackCenters:[[-1.8,-1.3],[-.6,-2.1],[.6,-2.1],[1.8,-1.3]]}};
export const resolvePlayInputs=(inputs={})=>({...PLAY_INPUTS,...inputs,
  goinPile:inputs.goinPile===null?null:{...PLAY_INPUTS.goinPile,...inputs.goinPile}});

export default {...pile,id:'hand-play-space',title:'Glove Playground',
  async create(context){
    const inputs=resolvePlayInputs(context.inputs);
    const instance=await pile.create({...context,inputs});
    let scene;
    try{
      scene=await context.host.scene.open();
      const markings=new Group();markings.name='Goin court markings';
      for(const [i,[x,z]]of (inputs.goinPile?.stackCenters??[]).entries()){
        const ring=new Mesh(new RingGeometry(.55,.6,64),new MeshStandardMaterial({color:i%2?0xf6f3ec:0x43c7be,roughness:.8,side:DoubleSide}));
        ring.rotation.x=-Math.PI/2;ring.position.set(x,.006,z);markings.add(ring);
      }
      await scene.attach(markings,{owned:true,metadata:{label:'Goin court markings',type:'fixture',source:'authored_noncolliding_floor_inlay'}});
      scene.redraw();
    }catch(error){await scene?.dispose();await instance.dispose();throw error;}
    return {...instance,async dispose(){try{await instance.dispose();}finally{await scene.dispose();}}};
  }};
