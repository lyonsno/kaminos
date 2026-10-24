import {Group,Mesh,BoxGeometry,PlaneGeometry,MeshStandardMaterial} from '../lib/three.webgpu.js';

export default {
  id:'surface-lighting-work',title:'Surface lighting work',
  async create({host,inputs,record}){
    const session=await host.scene.open(),document=host.controls.document,win=document.defaultView;
    const beforeGI=host.rendering.readGI(),beforeView=session.readView(),environment=document.getElementById('env-intensity-slider'),beforeEnvironment=environment.value;
    const controlledFixture=['bounce-corner','bounce-corridor'].includes(inputs.fixture);
    if(inputs.fixture==='bounce-corridor'){
      const root=new Group();root.name='Light around a corridor bend';
      const box=(name,size,position)=>{
        const mesh=new Mesh(new BoxGeometry(...size),new MeshStandardMaterial({color:0xdddddd,roughness:1,metalness:0}));
        mesh.name=name;mesh.position.fromArray(position);root.add(mesh);
      };
      box('First corridor floor',[6,.15,2],[-1,0,0]);
      box('Sheltered corridor floor',[2,.15,3],[1,0,2.5]);
      box('Back wall',[6.2,1.6,.2],[-1,.8,-1.1]);
      box('First-lit turning wall',[.2,1.6,5.2],[2,.8,1.5]);
      box('Source end wall',[.2,1.6,2],[-4,.8,0]);
      box('Light-blocking inner wall',[4,1.6,.2],[-2,.8,1.1]);
      box('Sheltered side wall',[.2,1.6,3],[0,.8,2.5]);
      box('Corridor end wall',[2.2,1.6,.2],[1,.8,4.1]);
      const emitter=new Mesh(new PlaneGeometry(1.2,1.2),new MeshStandardMaterial({color:0x000000,emissive:0xffa35c,emissiveIntensity:40}));
      emitter.name='Warm emitting panel';emitter.position.set(-3.85,.8,0);emitter.rotation.y=Math.PI/2;root.add(emitter);
      root.scale.x=.5; // Short first leg, with the same occluding bend.
      await session.attach(root,{owned:true,metadata:{label:root.name,source:'fixture:bounce-corridor',type:'experiment'}});
      session.setView({position:[-.4,11,7],target:[-.35,.2,1.3],fov:45,zoom:1});
      host.rendering.gi({...host.rendering.readGI(),mode:'combined',view:'scene',gain:5,radius:8,thickness:.2,slices:3,steps:3,denoise:1,resolutionScale:1,temporal:true,temporalRefine:true,bounceFeedback:false});
      environment.value='0';environment.dispatchEvent(new win.Event('input',{bubbles:true}));
      host.scene.select(null);
    }
    if(inputs.fixture==='bounce-corner'){
      const root=new Group();root.name='Further bounce comparison corner';
      const box=(name,size,position,color,emissive=0)=>{
        const material=new MeshStandardMaterial({color,roughness:1,metalness:0,emissive,emissiveIntensity:4});
        const mesh=new Mesh(new BoxGeometry(...size),material);mesh.name=name;mesh.position.fromArray(position);root.add(mesh);
      };
      box('Pale floor',[6,.15,5],[0,0,0],0xdddddd);
      box('Pale back wall',[6,3,.15],[0,1.5,-2.5],0xdddddd);
      box('Pale side wall',[.15,3,5],[-3,1.5,0],0xdddddd);
      box('Pale opposite wall',[.15,3,5],[3,1.5,0],0xdddddd);
      box('Warm emitting panel',[.12,2,2],[-2.85,1.5,-1],0x000000,0xffa35c);
      await session.attach(root,{owned:true,metadata:{label:root.name,source:'fixture:bounce-corner',type:'experiment'}});
      session.setView({position:[0,4,12],target:[0,1,-.4],fov:55});
      host.rendering.gi({...host.rendering.readGI(),mode:'combined',view:'incoming',radius:6,thickness:.5});
      environment.value='0';environment.dispatchEvent(new win.Event('input',{bubbles:true}));
      host.scene.select(null);
    }
    const api=()=>{if(!win.kaminosLightingWork)throw Error('Surface lighting comparison is unavailable');return win.kaminosLightingWork;};
    const read=()=>({...api().read(),fixture:inputs.fixture??null,gi:host.rendering.readGI()});
    let filter,reuse,feedback,view,status;
    const sync=()=>{
      const state=read();if(!status)return;
      filter.checked=state.filterImplementation==='shared';reuse.checked=state.surfaceLighting.enabled;
      feedback.checked=state.gi.bounceFeedback;feedback.disabled=!state.gi.temporal;
      view.value=state.gi.view;
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
        setView(value){
          if(!['scene','incoming'].includes(value))throw Error('Choose shaded scene or incoming bounce');
          host.rendering.gi({...host.rendering.readGI(),view:value});sync();return read();
        },
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
        const label=document.createElement('label');label.textContent='Lighting view ';
        view=document.createElement('select');
        for(const [value,text] of [['scene','Shaded scene'],['incoming','Incoming bounce']]){const option=document.createElement('option');option.value=value;option.textContent=text;view.append(option);}
        view.addEventListener('change',()=>invoke('setView',view.value).catch(error=>{status.textContent=error.message;}));label.append(view);root.append(label);
        if(controlledFixture){const description=document.createElement('p');description.textContent=inputs.fixture==='bounce-corridor'?'Light around a bend: the warm panel faces the first corridor. Compare Further bounces on/off on the floor beyond the inner wall. Start from this elevated view so the source and reflecting wall remain on screen. Environment lighting is off. Closing restores previous lighting and camera.':'Controlled comparison: warm emitting panel and pale walls, with environment lighting off. Orbit freely; closing this setup restores the previous lighting settings.';root.append(description);}
        status=document.createElement('p');status.setAttribute('role','status');root.append(status);sync();
      },
      dispose(){
        stop();
        if(controlledFixture){
          host.rendering.gi(beforeGI);environment.value=beforeEnvironment;
          environment.dispatchEvent(new win.Event('input',{bubbles:true}));
          session.setView(beforeView);
        }
        return session.dispose();
      },
    };
  },
};
