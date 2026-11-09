// kaminos-test: node
import assert from 'node:assert/strict';
import {mountInspectionControls} from '../experiments/hand-replay-inspection.mjs';

class Element{
 style={};dataset={};children=[];attributes={};hidden=false;
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
 setAttribute(k,v){this.attributes[k]=v;}
 addEventListener(){}
 remove(){this.removed=true;}
 getBoundingClientRect(){return {left:300,top:40,width:1000,height:800};}
}
const viewport=new Element(),renderer=new Element(),hiddenCanvas=new Element();
hiddenCanvas.getBoundingClientRect=()=>({left:0,top:0,width:0,height:0});
viewport.querySelector=selector=>selector==='#kaminos-host-renderer-canvas'?renderer:hiddenCanvas;
let resize,watched,disconnected=0,frames=0;
const document={createElement:()=>new Element(),querySelector:()=>viewport,defaultView:{ResizeObserver:class{constructor(fn){resize=fn;}observe(node){watched=node;}disconnect(){disconnected++;}}}};
const inspection={locked:false,frozen:false,visible:true,stations:[{visible:true,resetAnchor:[-2,4,0]},{visible:true,resetAnchor:[2,4,0]}]};
const view={position:[0,5,15],target:[0,5,0],up:[0,1,0],fov:40,zoom:1};
const read=()=>({captureId:'saved',viewMode:'inspection',projection:{available:true},inspection,view,models:[{label:'First'},{label:'Second'}]});
const controls=mountInspectionControls(document,async op=>{if(op==='frame')frames++;return read();},read);
controls.sync();const resets=viewport.children.filter(n=>n.dataset.handInspection==='reset');
assert.equal(resets.length,2);
assert(resets.every(b=>!b.hidden&&b.style.left?.endsWith('px')),'reset handles must use the visible host renderer rather than the first hidden canvas');
assert.notEqual(resets[0].style.left,resets[1].style.left,'reset handles must follow their separate stations');
assert(watched===viewport,'photo mode needs viewport-resize observation');
resize();await Promise.resolve();assert.equal(frames,0,'3D inspection must retain the operator camera on resize');
inspection.locked=true;resize();await Promise.resolve();assert.equal(frames,1,'photo view must reframe after a viewport resize');
controls.dispose();assert.equal(disconnected,1,'dispose the viewport observer');assert(resets.every(b=>b.removed));
resize();await Promise.resolve();assert.equal(frames,1,'disposed controls must not change the view');
console.log('spatial handle placement and photo-only resize lifecycle passed');
