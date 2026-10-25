// kaminos-test: node
// Request-state regression; transport is substituted. Native model and browser
// conformance are separate witnesses, not claims made by this unit test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(process.argv[2] || new URL('../prompt-expander.html', import.meta.url), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
class Element {
  constructor() { this.value=''; this.children=[]; }
  replaceChildren(...children) { this.children=children; }
  append(...children) { this.children.push(...children); }
  setAttribute() {}
}
class Reader {
  readAsDataURL(file) { file.arrayBuffer().then(data=>{this.result='data:image/png;base64,'+Buffer.from(data).toString('base64');this.onload();}); }
}

for (const [savedCount, unrelated] of [[1,true],[1,false],[0,true]]) {
  const elements=new Map(), posted=[], reference=Buffer.from('original saved reference bytes');
  const get=id=>{ if(!elements.has(id)) elements.set(id,new Element()); return elements.get(id); };
  const context={console, URL, File, Blob, FileReader:Reader, setTimeout, clearTimeout,
    location:{href:'http://127.0.0.1/prompt-expander.html'},window:{history:{replaceState(){}}},
    localStorage:{getItem(){return null;},setItem(){}},navigator:{clipboard:{}},
    Option:class extends Element {constructor(label,value){super();this.textContent=label;this.value=value;}},
    document:{getElementById:get,createElement:()=>new Element()},
    fetch:async(url,options={})=>{
      if(options.method==='POST') {posted.push(JSON.parse(options.body));return {ok:true,json:async()=>({id:'next'})};}
      if(url.endsWith('/references/0')) return {ok:true,blob:async()=>new Blob([reference])};
      if(url.endsWith('/config')) return {ok:true,json:async()=>({available:true})};
      return {ok:true,json:async()=>({id:'saved',prompt:'edit the saved image',images:savedCount?[{name:'saved.png'}]:[],status:'complete',output:'saved caption',submitted_at:Date.now()/1000})};
    },
  };
  vm.createContext(context);
  await vm.runInContext(`(async()=>{${script}\nglobalThis.test={follow,expand,setFiles(value){files=value;paintFiles();},names(){return files.map(x=>x.file.name);}};})()`,context);
  if(unrelated) context.test.setFiles([{file:new File(['wrong image'],'unrelated.png'),url:URL.createObjectURL(new Blob(['wrong image']))}]);
  await context.test.follow('saved',true);
  assert.deepEqual(Array.from(context.test.names()),savedCount?['saved.png']:[],`saved=${savedCount}, unrelated=${unrelated}: reference state`);
  assert.equal(get('mode').textContent,savedCount?'Image edit':'Scene caption');
  await context.test.expand();
  assert.equal(posted.length,1);
  assert.equal(posted[0].prompt,'edit the saved image');
  assert.equal(posted[0].images.length,savedCount);
  if(savedCount) assert.equal(posted[0].images[0].data,reference.toString('base64'));
}
console.log('Saved-run reference restoration and subsequent POST payload: 3 cases passed');
