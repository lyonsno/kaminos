// Separated parts side by side in the shared scene: load each derived GLB, move or
// turn one about a pivot to see the cut, the caps and what separation exposed.
import {Box3,Quaternion,Vector3} from '../lib/three.core.js';

const VIEWS={'three-quarter':[1,.55,1.25],front:[0,0,1],back:[0,0,-1],left:[-1,0,0],right:[1,0,0],top:[0,1,.35],bottom:[0,-1,.35],'low-three-quarter':[1,-.45,1.25]};
const vector=(value,label)=>{if(!Array.isArray(value)||value.length!==3||!value.every(Number.isFinite))throw Error(`${label} must be three numbers`);return value;};

export default {
  id: 'poly-parts',
  title: 'Separated parts',
  async create({host, inputs, record}) {
    if(!Array.isArray(inputs.parts)||!inputs.parts.length||!inputs.parts.every(p=>typeof p?.url==='string'&&p.url.trim()))throw Error('Parts need a list of {url, label}');
    const session=await host.scene.open(),parts=[];
    try{for(const part of inputs.parts){const asset=await session.loadAsset({url:part.url});parts.push({...part,asset,home:asset.root.position.toArray(),homeRotation:asset.root.quaternion.toArray()});}}
    catch(error){await session.dispose();throw error;}
    const index=i=>{if(!Number.isInteger(i)||!parts[i])throw Error(`No part ${i}`);return parts[i];};
    const refresh=part=>host.scene.refreshPresentation(part.asset);
    const read=()=>({parts:parts.map(p=>({label:p.label??null,url:p.url,objectId:p.asset.id,position:p.asset.root.position.toArray(),quaternion:p.asset.root.quaternion.toArray()})),view:session.readView()});
    const applied=(kind,requested)=>{const effective=read();record({kind:`poly-parts.${kind}`,phase:'applied',requested,effective});return effective;};
    return {
      read,
      operations: {
        move({part:i,offset}={}){const p=index(i);p.asset.root.position.fromArray(p.home).add(new Vector3(...vector(offset,'Offset')));refresh(p);return applied('move',{part:i,offset});},
        turn({part:i,axis,degrees,pivot}={}){
          const p=index(i),q=new Quaternion().setFromAxisAngle(new Vector3(...vector(axis,'Axis')).normalize(),(Number.isFinite(degrees)?degrees:0)*Math.PI/180),c=new Vector3(...vector(pivot,'Pivot'));
          const home=new Vector3(...p.home);p.asset.root.quaternion.fromArray(p.homeRotation).premultiply(q);
          p.asset.root.position.copy(home.sub(c).applyQuaternion(q).add(c));refresh(p);return applied('turn',{part:i,axis,degrees,pivot});
        },
        view({position,target}={}){session.setView({position:vector(position,'View position'),target:vector(target,'View target')});return applied('view',{position,target});},
        reset(){for(const p of parts){p.asset.root.position.fromArray(p.home);p.asset.root.quaternion.fromArray(p.homeRotation);refresh(p);}return applied('reset',{});},
        frame({direction='three-quarter',part:i=null}={}){
          const dir=VIEWS[direction];if(!dir)throw Error(`Unknown view direction ${direction}`);
          const box=new Box3();for(const p of i===null?parts:[index(i)])box.expandByObject(p.asset.root);
          const center=box.getCenter(new Vector3()),radius=box.getSize(new Vector3()).length()/2,fov=session.readView().fov*Math.PI/180;
          session.setView({position:center.clone().add(new Vector3(...dir).normalize().multiplyScalar(radius/Math.sin(fov/2)*1.08)).toArray(),target:center.toArray()});
          return applied('view',{direction,part:i});
        },
      },
      dispose:()=>session.dispose(),
    };
  },
};
