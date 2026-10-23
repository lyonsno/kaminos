import {Group,Mesh,BoxGeometry,MeshStandardMaterial} from '../lib/three.webgpu.js';

export default {
  id:'surface-lighting-work',title:'Surface lighting work',
  async create({host,inputs,record}){
    const session=await host.scene.open(),document=host.controls.document,win=document.defaultView;
    const beforeGI=host.rendering.readGI(),environment=document.getElementById('env-intensity-slider'),beforeEnvironment=environment.value;
    if(inputs.fixture==='bounce-corner'){
      const root=new Group();root.name='Further bounce comparison corner';
      const box=(name,size,position,color,emissive=0)=>{
        const material=new MeshStandardMaterial({color,roughness:1,metalness:0,emissive,emissiveIntensity:4});
        const mesh=new Mesh(new BoxGeometry(...size),material);mesh.name=name;mesh.position.fromArray(position);root.add(mesh);
      };
      box('Pale floor',[6,.15,5],[0,0,0],0xdddddd);
      box('Pale back wall',[6,3,.15],[0,1.5,-2.5],0xdddddd);
      box('Pale side wall',[.15,3,5],[-3,1.5,0],0xdddddd);
      box('Warm emitting panel',[1.3,1.3,.12],[-1.6,1.1,-2.35],0x000000,0xffa35c);
      box('Unlit receiving block',[1.2,1.8,1.2],[.4,.95,-.4],0xdddddd);
      await session.attach(root,{owned:true,metadata:{label:root.name,source:'fixture:bounce-corner',type:'experiment'}});
      session.setView({position:[7,5,9],target:[0,1,-.4]});
      host.rendering.gi({...host.rendering.readGI(),mode:'combined',view:'incoming',radius:3,thickness:.5});
      environment.value='0';environment.dispatchEvent(new win.Event('input',{bubbles:true}));
      host.scene.select(null);
    }
    const api=()=>{if(!win.kaminosLightingWork)throw Error('Surface lighting comparison is unavailable');return win.kaminosLightingWork;};
    const read=()=>({...api().read(),gi:host.rendering.readGI()});
    let filter,reuse,feedback,status;
    const sync=()=>{
      const state=read();if(!status)return;
      filter.checked=state.filterImplementation==='shared';reuse.checked=state.surfaceLighting.enabled;
      feedback.checked=state.gi.bounceFeedback;feedback.disabled=!state.gi.temporal;
      if(state.effectiveMode!=='combined'){
        status.textContent=`Combined GI is inactive (${state.effectiveMode}). These selections apply when combined GI is enabled; AO/GI filter sharing and source-lighting reuse are not executing.`;return;
      }
      status.textContent=`${state.filtering?(filter.checked?'One shared AO/GI filter pass':'Two separate AO/GI filter passes'):'Spatial filtering bypassed'} · `+
        (state.surfaceLighting.mounted?`${state.surfaceLighting.materials} flame-lit materials; ${reuse.checked?'matching final receivers reuse source lighting':'final receivers evaluate flame lighting directly'}. Source irradiance export is allocated in both comparison modes.`:'No hybrid flame surface-lighting producer is mounted.');
    };
    const change=(kind,value)=>{const result=kind==='filter'?api().setFilter(value):api().setSurfaceReuse(value);record({kind:`lighting-work.${kind}`,phase:'applied',effective:result});sync();return result;};
    const stop=session.onFrame(sync);
    return{
      read,
      operations:{setFilter:value=>change('filter',value),setSurfaceReuse:value=>change('surface-reuse',value),
        setFeedback(value){
          if(typeof value!=='boolean')throw Error('Further bounces must be on or off');
          host.rendering.gi({...host.rendering.readGI(),bounceFeedback:value});
          const effective=read();record({kind:'lighting-work.feedback',phase:'applied',effective});sync();return effective;
        }},
      mount({root,document,invoke}){
        const add=(text,operation,value)=>{
          const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';
          label.append(input,document.createTextNode(` ${text}`));root.append(label);
          input.addEventListener('change',()=>invoke(operation,value(input.checked)).catch(error=>{status.textContent=error.message;}));return input;
        };
        filter=add('Share AO/GI filter work','setFilter',checked=>checked?'shared':'separate');
        reuse=add('Reuse flame lighting between scene draws','setSurfaceReuse',checked=>checked);
        feedback=add('Further bounces (requires Temporal GI)','setFeedback',checked=>checked);
        status=document.createElement('p');status.setAttribute('role','status');root.append(status);sync();
      },
      dispose(){
        stop();session.dispose();
        if(inputs.fixture==='bounce-corner'){
          host.rendering.gi(beforeGI);environment.value=beforeEnvironment;
          environment.dispatchEvent(new win.Event('input',{bubbles:true}));
        }
      },
    };
  },
};
