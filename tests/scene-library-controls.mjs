import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createSceneLoadRequests} from '../scene-load-generation.mjs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('top Load and the keyboard/library command open server scenes, with file import secondary',()=>{
  assert.ok(/onclick="openSceneLibrary\(\)"[^>]*>Load<\/button>/.test(html),'top Load must reach the scene library');
  const shortcut=html.slice(html.indexOf('// Keyboard shortcuts: Ctrl+S'),html.indexOf('// --- Init ---'));
  assert.ok(shortcut.includes('openSceneLibrary()'));
});

test('scene browser distinguishes ordinary saves and includes unfamiliar provenance',async()=>{
  class Node {
    children=[];style={};textContent='';className='';
    append(...children){this.children.push(...children);}appendChild(child){this.append(child);}
    set innerHTML(value){this.children=[];}get innerHTML(){return '';}
  }
  const list=new Node(),files={
    'plain.kaminos.json':{label:'Kiln',timestamp:'2026-10-08T15:14:55Z',provenance:{source_group:'local'}},
    'capture.kaminos.json':{label:'Kiln',timestamp:'2026-10-07T15:14:55Z',capture:{image:'data:image/png;base64,YQ==',capturedAt:'yesterday'}},
    'new-source.kaminos.json':{label:'Imported scene',timestamp:'2026-10-08T15:15:55Z',provenance:{source_group:'new-tool'}},
  };
  const start=html.indexOf('async function grBrowseScenes()'),end=html.indexOf('async function grBrowseScratch()',start);
  const context=vm.createContext({document:{getElementById:()=>list,createElement:()=>new Node()},currentSceneFile:null,
    grFetchApi:async(endpoint,{path})=>endpoint==='browse'?{entries:Object.keys(files).map(name=>({name}))}:files[path]});
  vm.runInContext(html.slice(start,end),context);await vm.runInContext('grBrowseScenes()',context);
  const all=[];function visit(node){all.push(node);for(const child of node.children)visit(child);}visit(list);
  assert.equal(all.filter(n=>n.className==='gr-scene-time').length,3,'every scene needs visible save identity, even without Capture');
  assert.ok(all.some(n=>n.textContent==='Imported scene'),'new provenance must not silently hide a saved scene');
});

async function pendingReadFixture() {
  class Node {
    children=[];style={};textContent='';className='';
    append(...children){this.children.push(...children);}appendChild(child){this.append(child);}
    set innerHTML(value){this.children=[];}get innerHTML(){return '';}
  }
  const list=new Node(),reads=new Map(),loads=[],sceneLibraryReads=createSceneLoadRequests();
  let pending=false;
  const dialog={open:true,close(){this.open=false;sceneLibraryReads.invalidate();}};
  const context=vm.createContext({document:{getElementById:()=>list,createElement:()=>new Node()},currentSceneFile:null,sceneLibraryReads,sceneLibraryDialog:dialog,Blob,File,
    grFetchApi:async(endpoint,{path})=>{
      if(endpoint==='browse')return {entries:['A','B'].map(id=>({name:id+'.kaminos.json'}))};
      if(pending)return new Promise(resolve=>reads.set(path,resolve));
      return {label:path,timestamp:'2026-10-08T15:14:55Z'};
    },
    loadSceneFile:(file,{sceneFile})=>loads.push(sceneFile),
  });
  const start=html.indexOf('async function grBrowseScenes()'),end=html.indexOf('async function grBrowseScratch()',start);
  vm.runInContext(html.slice(start,end),context);await vm.runInContext('grBrowseScenes()',context);
  const rows=list.children.filter(n=>n.className==='gr-entry');
  const button=id=>rows.find(n=>n.children.some(c=>c.children?.some(d=>d.textContent===id+'.kaminos.json'))).children.find(n=>n.textContent==='Load');
  pending=true;
  return {dialog,loads,resolve:(id)=>reads.get(id+'.kaminos.json')({objects:[]}),click:id=>button(id).onclick({stopPropagation(){}})};
}

test('cancelled scene reads cannot load or close a reopened library',async()=>{
  for(const reopen of [false,true]) {
    const f=await pendingReadFixture(),pending=f.click('A');
    f.dialog.close();if(reopen)f.dialog.open=true;
    f.resolve('A');await pending;
    assert.deepEqual(f.loads,[],'a cancelled read must not replace the authored scene');
    assert.equal(f.dialog.open,reopen,'late response must not dismiss a new library session');
  }
});

test('scene selection order wins over reverse read completion, including workbench rows',async()=>{
  for(const open of [true,false]) {
    const f=await pendingReadFixture();f.dialog.open=open;
    const a=f.click('A'),b=f.click('B');
    f.resolve('B');await b;f.resolve('A');await a;
    assert.deepEqual(f.loads,['B.kaminos.json'],'the older choice must not become the latest load');
  }
});
