import {Group,Mesh,BoxGeometry,MeshStandardMaterial} from './lib/three.webgpu.js';

// Disposable analytic geometry on the ordinary Workbench renderer. The floor
// fills the view; the other setup adds a depth edge, thin bars and a bright patch.
export async function openFootprintFixture(host,kind) {
 if(!['plane','light'].includes(kind))throw Error('Unknown GI comparison fixture');
 const session=await host.scene.open(),beforeView=session.readView(),beforeGI=host.rendering.readGI();
 const doc=host.controls.document,environment=doc.getElementById('env-intensity-slider'),beforeEnvironment=environment?.value;
 const root=new Group();root.name=kind==='plane'?'Unoccluded tilted-floor comparison':'Thin blockers and bright-patch comparison';
 const box=(name,size,position,color=0xbcbcbc,emissive=0,intensity=0)=>{
  const mesh=new Mesh(new BoxGeometry(...size),new MeshStandardMaterial({color,roughness:1,metalness:0,emissive,emissiveIntensity:intensity}));
  mesh.name=name;mesh.position.fromArray(position);root.add(mesh);return mesh;
 };
 box('Flat receiving floor',kind==='plane'?[80,.1,80]:[14,.1,12],[0,1.95,0]);
 if(kind==='light'){
  box('Pale reflecting wall',[10,3,.15],[0,3.5,-3.5]);
  box('Raised depth step',[2,.6,3],[2,2.3,-.2],0x899fbb);
  for(const [i,width] of [.025,.08,.25].entries())box('Thin blocker '+(i+1),[width,1.5,.15],[-1.7+i*.8,2.75,-2],0x525252);
  box('Small warm emitting patch',[.4,.4,.04],[-1,3,-3.4],0x000000,0xff6325,12);
 }
 const lights=[];let disposed=false;
 try {
  await session.attach(root,{owned:true,metadata:{label:root.name,source:'fixture:gi-footprint-'+kind,type:'experiment'}});
  let scene=root;while(scene.parent)scene=scene.parent;
  scene.traverse(node=>{if(node.isLight){lights.push([node,node.visible]);node.visible=false;}});
  if(environment){environment.value='0';environment.dispatchEvent(new doc.defaultView.Event('input',{bubbles:true}));}
  session.setView(kind==='plane'?{position:[0,5,7],target:[0,2,-2],fov:45,zoom:1}:{position:[5,7,9],target:[0,2.6,-1.2],fov:45,zoom:1});
  host.rendering.gi({...beforeGI,mode:'combined',view:kind==='plane'?'ao':'scene',gain:1,radius:8,thickness:.1,steps:16,slices:1,resolutionScale:.2,denoise:0,temporal:false,bounceFeedback:false});
  host.scene.select(null);session.redraw();
 }catch(error){for(const [node,visible] of lights)node.visible=visible;await session.dispose();throw error;}
 return {
  read:()=>({kind,source:'analytic-geometry',parts:root.children.map(node=>({name:node.name,size:[node.geometry.parameters.width,node.geometry.parameters.height,node.geometry.parameters.depth],position:node.position.toArray()})),lights:'emissive-patch-only',view:session.readView()}),
  async dispose(){if(disposed)return;disposed=true;for(const [node,visible] of lights)node.visible=visible;
   host.rendering.gi(beforeGI);if(environment){environment.value=beforeEnvironment;environment.dispatchEvent(new doc.defaultView.Event('input',{bubbles:true}));}session.setView(beforeView);await session.dispose();}
 };
}
