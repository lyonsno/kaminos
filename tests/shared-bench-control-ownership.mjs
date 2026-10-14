// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {installExperimentWorkspace} from '../experiment-workspace.mjs';
import {createControlSlots} from '../authoring-workspace.mjs';

// Minimal DOM for exercising the installed workspace's actual slot transitions.
class Node {
  children=[];parent=null;dataset={};classList={toggle(){}};
  selectors=new Map();
  constructor(id=''){this.id=id;}
  append(...nodes){for(const node of nodes)this.insert(node,this.children.length);}
  insert(node,index){
    if(node.parent){const old=node.parent.children.indexOf(node);if(node.parent===this&&old<index)index--;node.parent.children.splice(old,1);}
    node.parent=this;this.children.splice(index,0,node);
  }
  before(node){this.parent.insert(node,this.parent.children.indexOf(this));}
  after(node){this.parent.insert(node,this.parent.children.indexOf(this)+1);}
  replaceChildren(...nodes){for(const node of this.children)node.parent=null;this.children=[];this.append(...nodes);}
  get firstChild(){return this.children[0]??null;}
  querySelector(selector){if(!this.selectors.has(selector))this.selectors.set(selector,new Node(selector));return this.selectors.get(selector);}
  querySelectorAll(){return [];}
  addEventListener(){} setAttribute(){}
}
function fixture(){
  const nodes=new Map(),document={body:new Node('body'),defaultView:{},createElement:()=>new Node(),createComment:()=>new Node('marker'),addEventListener(){},
    getElementById(id){if(!nodes.has(id))nodes.set(id,new Node(id));return nodes.get(id);}};
  const legacy=new Node('transform-bar'),authoring=new Node('authoring-gizmo-slot'),rotate=new Node('rotate');legacy.append(rotate);
  const authoringSlots=createControlSlots(document,[{node:rotate,destination:authoring}]);
  const bench=installExperimentWorkspace({document,title:'Shared bench',subtitle:'',tools:[{id:'making-bench',label:'Shared bench'},{id:'assets',label:'Assets'}],
    inspector:{setWorkbenchInspector(){},setWorkbenchTreeDestination(){}},frame(){},openTool(){},makingTools:[rotate]});
  return {bench,authoringSlots,rotate,authoring,legacy,home:document.getElementById('experiment-making-tools')};
}
test('inactive Workbench tool updates cannot reclaim Authoring controls',()=>{
  const f=fixture();f.bench.setTool('making-bench');f.bench.setActive(true);assert.equal(f.rotate.parent,f.home);
  f.bench.setActive(false);assert.equal(f.rotate.parent,f.legacy);f.authoringSlots.setActive(true);
  for(const action of ['Rim Light','Add Water Emitter','repeated Assets selection']){
    f.bench.setTool('assets');assert.equal(f.rotate.parent,f.authoring,action+' leaves the active owner intact');
  }
  f.authoringSlots.setActive(false);f.bench.setActive(true);f.bench.setTool('making-bench');assert.equal(f.rotate.parent,f.home);
});
