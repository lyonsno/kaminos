import {Group} from '../lib/three.webgpu.js';
import {createCrust,advanceCrust,setCrustConditions,saveCrust,restoreCrust,readCrust} from './crust.mjs';
import {createCrustSurface} from './crust-surface.mjs';
import {createCrustClock} from './crust-clock.mjs';
import {checkedCrystalSnapshot,defaultCrystalSnapshot,crystalRuntime} from './crust-record.mjs';

// A scene-owned simulation. World placement is an object transform; its local
// material coordinates and retained growth remain independent of the camera.
export function createCrystalObject({snapshot=defaultCrystalSnapshot(),onFrame,redraw=()=>{},changed=()=>{},isMounted=()=>true,requestIdle,cancelIdle}={}){
 let saved=checkedCrystalSnapshot(snapshot),state=restoreCrust(saved.state),surface=createCrustSurface(state),closed=false,active=true,error=null,checkpoint=null;
 const root=new Group();root.name='Salt crystals';root.add(surface.root);
 const present=()=>{surface.update(state);surface.interfaces(saved.interfaces);surface.substrate(saved.substrate);redraw();};
 const clock=createCrustClock({advance:seconds=>advanceCrust(state,seconds),onChange:()=>{present();changed();},onError:e=>{error=e.message;saved.playing=false;redraw();},requestIdle,cancelIdle});
 const configure=()=>clock.configure(!closed&&active&&isMounted(root)&&saved.playing,saved.rate);
 clock.reset(saved.pendingModelSeconds);configure();present();
 const guard=()=>{if(closed)throw Error('Crystal object is disposed');};
 const snap=()=>{guard();return {...saved,state:saveCrust(state),pendingModelSeconds:clock.read().pendingModelSeconds};};
 const read=()=>({...readCrust(state),rate:saved.rate,playing:saved.playing,effectivePlaying:saved.playing&&active&&isMounted(root)&&!closed,interfaces:saved.interfaces,substrate:saved.substrate,clock:clock.read(),error,closed});
 const replace=value=>{
  guard();const next=checkedCrystalSnapshot(value),nextState=restoreCrust(next.state),candidate=createCrustSurface(nextState);
  clock.configure(false,0);root.remove(surface.root);surface.dispose();surface=candidate;root.add(candidate.root);state=nextState;saved=next;error=null;clock.reset(next.pendingModelSeconds);configure();present();changed();return read();
 };
 const invoke=(operation,input)=>{
  guard();
  if(operation==='restore'){
   // The bench checkpoint's camera is deliberately not a scene-object input.
   const value=input?.schema==='kaminos.capillary-crust.v1'?{...snap(),state:input.state,rate:input.rate,interfaces:input.interfaces??false,pendingModelSeconds:input.pendingModelSeconds??0,playing:false}:input;
   return replace(value);
  }
  if(operation==='checkpoint')return snap();
  if(operation==='remember'){checkpoint=snap();return read();}
  if(operation==='returnToCheckpoint'){if(!checkpoint)throw Error('Store a checkpoint first');return replace(checkpoint);}
  if(operation==='restart'||operation==='seedLayout'){
   const previous=snap(),next=createCrust({rows:state.rows,seed:state.seed,settings:state.settings,setup:operation==='seedLayout'?'neighbors':state.setup,arrangement:input?.arrangement??state.arrangement,tilt:input?.tilt??state.tilt});
   const result=replace({...previous,state:saveCrust(next),pendingModelSeconds:0,playing:false});checkpoint=previous;return result;
  }
  if(operation==='conditions')setCrustConditions(state,input);
  else if(operation==='play'){if(typeof input!=='boolean')throw Error('Play requires Boolean');saved.playing=input;configure();}
  else if(operation==='rate'){if(!Number.isFinite(input)||input<0)throw Error('Invalid crystal rate');saved.rate=input;configure();}
  else if(operation==='interfaces'||operation==='substrate'){if(typeof input!=='boolean')throw Error('Visibility requires Boolean');saved[operation]=input;}
  else if(operation==='advance'){advanceCrust(state,input);}
  else throw Error('Unknown crystal operation: '+operation);
  present();changed();return read();
 };
 const stop=onFrame?.(({deltaSeconds})=>{if(closed)return;configure();clock.frame(deltaSeconds);});
 const runtime={root,read,snapshot:snap,invoke,setActive(value){active=Boolean(value);configure();},dispose(){if(closed)return;closed=true;clock.dispose();stop?.();surface.dispose();root.remove(surface.root);}};
 root[crystalRuntime]=runtime;return runtime;
}
