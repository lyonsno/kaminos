import {Group,Mesh,Box3,Vector3,BufferGeometry,Float32BufferAttribute,MeshStandardMaterial,SphereGeometry} from '../lib/three.core.js';
import {AshDeposit} from '../ash/deposit.mjs';
import {ashBlockSurface} from '../ash/surface.mjs';
import {createGpuSceneSolidProducer} from '../scene-solid-gpu.mjs';

const kilnSha='f8e6ce918e3e5cf234d186724dc21b40b3f9cf7cbc9e776000cf55f24801c91b';
const cellSize=.06,grid=64,scale=grid*cellSize/2;
const positive=(n,label)=>{if(!Number.isFinite(n)||n<=0)throw Error(`${label} must be positive`);return n;};
export default {
 id:'ash-deposition',title:'Ash — kiln accumulation',
 async create({host,record}) {
  const session=await host.scene.open();let producer,device,onGpuError;
  try {
   const kiln=await session.loadAsset({url:`/api/read?root=generated-meshes&path=${kilnSha}.glb`,normalize:true,arrival:'append'});
   const groundY=host.scene.ground().height;
   kiln.root.updateMatrixWorld(true);
   let bounds=new Box3().setFromObject(kiln.root),size=bounds.getSize(new Vector3());
   kiln.root.scale.multiplyScalar(2/Math.max(size.x,size.y,size.z));kiln.root.updateMatrixWorld(true);
   bounds=new Box3().setFromObject(kiln.root);const center=bounds.getCenter(new Vector3());
   kiln.root.position.add(new Vector3(-center.x,groundY-bounds.min.y,-center.z));kiln.root.updateMatrixWorld(true);
   host.scene.refreshPresentation(kiln);
   const matrix=kiln.root.matrixWorld.toArray();
   device=host.scene.renderer()?.backend?.device;if(!device)throw Error('Kiln collision setup requires the shared WebGPU renderer');
   const gpuErrors=[];onGpuError=event=>gpuErrors.push(event.error.message);
   device.addEventListener('uncapturederror',onGpuError);
   producer=createGpuSceneSolidProducer(device,{grid,gridHeight:grid});
   const setup=producer.update([{id:kiln.id,object:kiln.root}],{translate:[0,groundY+scale,0],scale},{grid,gridHeight:grid});
   const encoder=device.createCommandEncoder();producer.encode(encoder);device.queue.submit([encoder.finish()]);
   const support=await producer.snapshot();await device.queue.onSubmittedWorkDone();
   if(!support.valid||gpuErrors.length)throw Error(`Kiln collision unavailable: ${gpuErrors.join('; ')||JSON.stringify(support.counts)}`);
   producer.destroy();producer=null;device.removeEventListener('uncapturederror',onGpuError);device=null;
   const solid=([x,y,z])=>y<0||(x+grid/2>=0&&x+grid/2<grid&&y<grid&&z+grid/2>=0&&z+grid/2<grid&&support.cells[x+grid/2+grid*(y+grid*(z+grid/2))]!==0);
   let deposit=new AshDeposit({solid}),playing=true,lastStep=0,statusElement,contactField,pauseButton,fieldDocument,presentedRadius;
   const root=new Group();root.name='Accumulated ash';root.scale.setScalar(cellSize);root.position.y=groundY;
   const material=new MeshStandardMaterial({color:0xb7b0a4,roughness:1,metalness:0});
   const chunks=new Map();let rebuilt=0,visited=0,lastContact=null;
   const ashAsset=await session.attach(root,{owned:true,presentation:true,metadata:{label:root.name,source:'ash:seeded-deposition',type:'experiment'}});
   const marker=new Mesh(new SphereGeometry(1,16,12),new MeshStandardMaterial({color:0xdca76b,roughness:.7,transparent:true,opacity:.45}));
   marker.name='Ash contact — move me';marker.position.set(0,groundY+.06,1.05);marker.scale.setScalar(.18);
   const markerAsset=await session.attach(marker,{owned:true,metadata:{label:marker.name,source:'ash:contact',type:'experiment'}});
   const identity={kilnSha,cellSize,grid,groundY,kilnMatrix:matrix};
   const checkFixture=()=>{if(host.scene.ground().height!==groundY)throw Error('The ground moved. Reopen this experiment to rebuild its support.');kiln.root.updateMatrixWorld(true);if(kiln.root.matrixWorld.toArray().some((v,i)=>v!==matrix[i]))throw Error('The kiln moved. Reopen this experiment to rebuild its collision support.');};
   const render=()=>{for(const id of deposit.takeDirtyBlocks()){
    const old=chunks.get(id);if(old){root.remove(old);old.geometry.dispose();chunks.delete(id);}
    const surface=ashBlockSurface(deposit,id);rebuilt++;
    if(!surface.positions.length)continue;
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(surface.positions,3));geometry.setAttribute('normal',new Float32BufferAttribute(surface.normals,3));geometry.computeBoundingSphere();
    const mesh=new Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);chunks.set(id,mesh);
   }session.redraw();};
   const read=()=>({fixture:'existing kiln; static collision snapshot',source:'seeded loose ash; no combustion coupling',collision:{backend:support.backend,valid:support.valid,dimensions:support.dimensions,counts:support.counts,triangles:setup.triangleCount},identity,...deposit.read(),playing,rebuiltBlocks:rebuilt,visitedCells:visited,visibleBlocks:chunks.size,objectId:ashAsset.id,contactObjectId:markerAsset.id,contact:marker.position.toArray(),contactRadius:marker.scale.x,lastContact,view:session.readView()});
   const sync=(force=false)=>{
    if(statusElement)statusElement.textContent=`${deposit.cells} cells · ${deposit.active.size?(playing?'settling':'paused'):'asleep'} · ${deposit.mass.toFixed(1)} cell volumes retained`;
    if(contactField&&(force||fieldDocument.activeElement!==contactField||contactField.readOnly)){contactField.value=String(marker.scale.x);presentedRadius=marker.scale.x;}
    if(pauseButton)pauseButton.textContent=playing?'Pause settling':'Resume settling';
   };
   const frame=()=>session.setView({position:[3.2,groundY+2.2,4.3],target:[0,groundY+.65,.2]});frame();
   session.onFrame(({timestampMs})=>{
    if(marker.scale.x!==presentedRadius)sync();
    if(!playing||!deposit.active.size||timestampMs-lastStep<50)return;
    try{checkFixture();lastStep=timestampMs;visited+=deposit.step().visited;render();sync();}
    catch(error){playing=false;if(statusElement)statusElement.textContent=error.message;record({kind:'ash.error',phase:'failed',error:error.message});}
   });
   const operations={
    read,
    deposit({amount=600,radius=.55,center:requested}={}){
     checkFixture();positive(amount,'Amount');positive(radius,'Radius');
     const c=requested??marker.position.toArray();if(!Array.isArray(c)||c.length!==3||!c.every(Number.isFinite))throw Error('Expected finite center');
     const cx=Math.floor(c[0]/cellSize),cz=Math.floor(c[2]/cellSize),r=Math.ceil(radius/cellSize),columns=[];
     for(let z=-r;z<=r;z++)for(let x=-r;x<=r;x++)if(Math.hypot(x,z)*cellSize<=radius)columns.push([cx+x,cz+z]);
     const each=amount/columns.length;
     for(const [x,z] of columns){let left=each,y=Math.max(Math.ceil(2.3/cellSize),Math.floor((c[1]-groundY)/cellSize));while(left>0){const p=[x,y++,z];if(solid(p))continue;const n=Math.min(left,1-deposit.amount(p));if(n>0){deposit.add(p,n);left-=n;}}}
     render();sync();const effective=read();record({kind:'ash.deposit',phase:'applied',requested:{amount,radius,center:c},effective});return effective;
    },
    press({radius=marker.scale.x,center:requested}={}){
     checkFixture();positive(radius,'Radius');const c=requested??marker.position.toArray();if(!Array.isArray(c)||c.length!==3||!c.every(Number.isFinite))throw Error('Expected finite center');
     marker.scale.setScalar(radius);host.scene.refreshPresentation(markerAsset);lastContact=deposit.press(c.map((v,i)=>Math.floor((v-(i===1?groundY:0))/cellSize)),radius/cellSize);render();sync();record({kind:'ash.contact',phase:'applied',requested:{radius,center:c},effective:lastContact});return read();
    },
    setContactRadius(radius){positive(radius,'Radius');marker.scale.setScalar(radius);host.scene.refreshPresentation(markerAsset);sync();return read();},
    play(value){playing=Boolean(value);sync();return read();},
    frame,
    checkpoint(){checkFixture();return {schema:'kaminos.kiln-ash.v1',identity,deposit:deposit.snapshot(),contact:marker.position.toArray(),contactRadius:marker.scale.x};},
    restore(checkpoint){
     checkFixture();if(checkpoint?.schema!=='kaminos.kiln-ash.v1'||JSON.stringify(checkpoint.identity)!==JSON.stringify(identity))throw Error('Checkpoint kiln or cell mapping does not match this fixture');
     if(!Array.isArray(checkpoint.contact)||checkpoint.contact.length!==3||!checkpoint.contact.every(Number.isFinite))throw Error('Invalid contact position');
     positive(checkpoint.contactRadius,'Contact radius');const next=AshDeposit.restore(checkpoint.deposit,{solid});
     for(const mesh of chunks.values()){root.remove(mesh);mesh.geometry.dispose();}chunks.clear();deposit=next;marker.position.fromArray(checkpoint.contact);marker.scale.setScalar(checkpoint.contactRadius);host.scene.refreshPresentation(markerAsset);render();sync();record({kind:'ash.restore',phase:'applied',effective:read()});return read();
    },
   };
   return {read,operations,mount({root:panel,document,invoke}){
    fieldDocument=document;
    const intro=document.createElement('p');intro.textContent='Move the amber contact sphere with the scene tools. Add ash above it, or press it into a settled patch. The kiln is fixed for this collision snapshot. Deposits here are seeded, not burn residue.';panel.append(intro);
    const field=(label,value)=>{const row=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=label+' ';input.type='number';input.value=value;input.step='any';input.min='0';input.className='transform-input';input.setAttribute('aria-label',label);row.append(grip,input);panel.append(row);host.controls.installNumberDrag({input,grip,step:value/20});return input;};
    const amount=field('Ash amount (cell volumes)',600),spread=field('Deposit radius',.55),contact=field('Contact radius',marker.scale.x);contactField=contact;
    statusElement=document.createElement('p');statusElement.setAttribute('role','status');
    const failed=error=>{statusElement.textContent=error.message;};
    contact.addEventListener('change',()=>invoke('setContactRadius',Number(contact.value)).catch(failed));
    const button=(label,fn)=>{const b=document.createElement('button');b.textContent=label;b.type='button';b.addEventListener('click',()=>Promise.resolve().then(fn).catch(failed));panel.append(b);return b;};
    button('Add ash',()=>invoke('deposit',{amount:Number(amount.value),radius:Number(spread.value)}));
    button('Press contact',()=>invoke('press'));
    pauseButton=button('Pause settling',()=>invoke('play',!playing));
    button('Frame kiln',()=>invoke('frame'));
    button('Save ash',async()=>{const data=await invoke('checkpoint'),a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));a.href=url;a.download='kiln-ash.json';a.click();URL.revokeObjectURL(url);});
    const file=document.createElement('input');file.type='file';file.accept='.json';file.hidden=true;file.addEventListener('change',async()=>{try{if(file.files[0])await invoke('restore',JSON.parse(await file.files[0].text()));}catch(error){failed(error);}finally{file.value='';}});panel.append(file);
    button('Load ash',()=>file.click());panel.append(statusElement);sync();
   },dispose:async()=>{material.dispose();await session.dispose();}};
  }catch(error){producer?.destroy();device?.removeEventListener('uncapturederror',onGpuError);await session.dispose();throw error;}
 },
};
