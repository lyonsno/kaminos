import {createMicrostructureControl} from '../neural-microstructure.mjs';

export default {
  id:'trellis-microstructure',title:'TRELLIS microstructure',
  async create({host,inputs,record}){
    const url=inputs.source;
    if(typeof url!=='string'||!url)throw Error('A prepared microstructure source URL is required');
    const sourceFile=name=>{const base=new URL(url,location.href);if(base.pathname==='/api/read'){base.searchParams.set('path',(base.searchParams.get('path')??'')+name);return base;}return new URL(name,base);};
    const json=await fetch(sourceFile('report.json'));
    if(!json.ok)throw Error(`Source report HTTP ${json.status}`);const meta=await json.json();
    if(meta.ok!==true||meta.schema!=='kaminos.microstructure-control.v1'||meta.colorEncoding!=='srgb')throw Error('Successful prepared sRGB microstructure field required');
    const arrays={};
    for(const [name,Type]of [['rows.f32',Float32Array],['carriers.f32',Float32Array]]){
      const response=await fetch(sourceFile(name));if(!response.ok)throw Error(`${name}: HTTP ${response.status}`);
      const bytes=await response.arrayBuffer(),expected=meta.files[name];
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      if(bytes.byteLength!==expected.bytes||digest!==expected.sha256)throw Error(`${name}: source bytes differ from report`);
      arrays[name]=new Type(bytes);
    }
    const control=createMicrostructureControl({...meta,rows:arrays['rows.f32'],carriers:arrays['carriers.f32']});
    const session=await host.scene.open();let asset;
    // Position the small selected patch above the workbench floor; native
    // selection and transforms remain the owner of subsequent placement.
    control.root.position.y=.2;
    try{asset=await session.attach(control.root,{owned:true,metadata:{label:control.root.name,source:meta.sourceSHA256,type:'experiment'}});}
    catch(error){control.dispose();await session.dispose();throw error;}
    const read=()=>({...control.read(),source:url,sourceSHA256:meta.sourceSHA256,regionYUp:meta.regionYUp,objectId:asset.id,view:session.readView()});
    let select;
    const frame=()=>session.setView({position:[.22,.34,.25],target:[0,.2,0]});
    frame();control.setMode(inputs.mode??'carrier');
    return {read,operations:{
      mode(value){control.setMode(value);if(select)select.value=value;session.redraw();const effective=read();record({kind:'microstructure.mode',phase:'applied',target:asset.id,requested:value,effective});return effective;},
      frame(){const effective=frame();record({kind:'microstructure.view',phase:'applied',target:asset.id,effective});return effective;},
    },mount({root,document,invoke}){
      const label=document.createElement('label');label.textContent='Surface ';select=document.createElement('select');select.setAttribute('aria-label','Surface representation');select.style.maxWidth='100%';
      for(const [value,text]of [['fine','Fine discs'],['coarse','Coarse discs'],['carrier','Fine detail in coarse carriers']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
      select.value=control.read().mode;select.addEventListener('change',()=>invoke('mode',select.value));label.append(select);
      const status=document.createElement('output');status.textContent=`${meta.count.toLocaleString()} fine samples · ${meta.carrierCount.toLocaleString()} carriers`;
      root.append(label,status);
    },async dispose(){control.dispose();await session.dispose();}};
  },
};
