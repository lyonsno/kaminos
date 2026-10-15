// What a generated mesh's topology looks like before anyone edits it: open,
// non-manifold, creased, flipped and UV-seam edges drawn over the asset the app
// actually loaded. Read-only; it decides which polygon tools can find parts.
import {Box3,BufferGeometry,Float32BufferAttribute,Group,LineBasicMaterial,LineSegments,Vector3} from '../lib/three.core.js';
import {buildPolyMesh,classifyEdges,polyMeshCensus} from '../poly-mesh-core.mjs';
import {EDGE_CLASSES,edgeClassSegments} from '../poly-edge-overlay.mjs';

const VIEWS={'three-quarter':[1,.55,1.25],front:[0,0,1],back:[0,0,-1],left:[-1,0,0],right:[1,0,0],top:[0,1,.35],bottom:[0,-1,.35]};
function angle(value){if(!Number.isFinite(value)||value<0||value>180)throw Error('Crease angle must be between 0 and 180 degrees');return value;}
function className(name){if(!EDGE_CLASSES.some(c=>c.name===name))throw Error(`Unknown edge class ${name}`);return name;}
function compact(attribute,width){
  if(!attribute)return null;
  const out=new Float32Array(attribute.count*width),get=['getX','getY','getZ'];
  for(let i=0;i<attribute.count;i++)for(let k=0;k<width;k++)out[i*width+k]=attribute[get[k]](i);
  return out;
}
function triangleMesh(root){let found=null;root.traverse(o=>{if(!found&&o.isMesh&&o.geometry?.attributes?.position&&(o.geometry.index||o.geometry.attributes.position.count%3===0))found=o;});return found;}

export default {
  id: 'poly-edge-census',
  title: 'Polygon edge census',
  async create({host, inputs, record}) {
    if(typeof inputs.url!=='string'||!inputs.url.trim())throw Error('Edge census needs a mesh url');
    let sharpAngle=angle(inputs.sharpAngle??60),xray=!!inputs.xray;
    const visible=Object.fromEntries(EDGE_CLASSES.map(c=>[c.name,inputs.visible?.[c.name]??c.name!=='uvSeam']));
    const session=await host.scene.open();
    let asset,target,mesh;
    try{
      asset=await session.loadAsset({url:inputs.url});
      target=triangleMesh(asset.root);
      if(!target)throw Error('The loaded asset has no triangle mesh');
      const g=target.geometry;
      mesh=buildPolyMesh({positions:compact(g.attributes.position,3),normals:compact(g.attributes.normal,3),uvs:compact(g.attributes.uv,2),indices:g.index?Uint32Array.from(g.index.array):null});
    }catch(error){await session.dispose();throw error;}
    const surface=target.material,surfaceState={transparent:surface.transparent,opacity:surface.opacity,depthWrite:surface.depthWrite};
    Object.assign(surface,{polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});surface.needsUpdate=true;
    const overlay=new Group();overlay.name='Polygon edge census';target.add(overlay);
    const lines=Object.fromEntries(EDGE_CLASSES.map(c=>{
      const line=new LineSegments(new BufferGeometry(),new LineBasicMaterial({color:c.color,transparent:true,opacity:.95}));
      line.name=c.label;line.renderOrder=2;overlay.add(line);return [c.name,line];
    }));
    let counts={},census=null,panelSync=()=>{};
    const rebuild=()=>{
      const segments=edgeClassSegments(mesh,classifyEdges(mesh,{sharpAngle}));
      for(const c of EDGE_CLASSES){
        const line=lines[c.name];line.geometry.dispose();
        line.geometry=new BufferGeometry();line.geometry.setAttribute('position',new Float32BufferAttribute(segments[c.name],3));
        line.visible=visible[c.name];line.material.depthTest=!xray;line.material.needsUpdate=true;counts[c.name]=segments[c.name].length/6;
      }
      surface.transparent=xray||surfaceState.transparent;surface.opacity=xray?.22:surfaceState.opacity;surface.depthWrite=xray?false:surfaceState.depthWrite;surface.needsUpdate=true;
      census=polyMeshCensus(mesh,{sharpAngle});session.redraw();panelSync();
    };
    rebuild();
    const read=()=>({objectId:asset.id,source:inputs.url,mesh:target.name||null,sharpAngle,xray,visible:{...visible},counts:{...counts},census,view:session.readView()});
    const applied=(kind,requested)=>{const effective=read();record({kind:`poly-edge-census.${kind}`,phase:'applied',target:asset.id,requested,effective});return effective;};
    return {
      read,
      operations: {
        setSharpAngle(requested){sharpAngle=angle(requested);rebuild();return applied('crease-angle',requested);},
        setVisible(name,on){visible[className(name)]=!!on;lines[name].visible=!!on;session.redraw();panelSync();return applied('visible',{name,on});},
        setXray(on){xray=!!on;rebuild();return applied('xray',on);},
        frame({direction='three-quarter'}={}){
          const dir=VIEWS[direction];if(!dir)throw Error(`Unknown view direction ${direction}`);
          const box=new Box3().setFromObject(asset.root),center=box.getCenter(new Vector3()),radius=box.getSize(new Vector3()).length()/2;
          const fov=session.readView().fov*Math.PI/180,distance=radius/Math.sin(fov/2)*1.08,offset=new Vector3(...dir).normalize().multiplyScalar(distance);
          session.setView({position:center.clone().add(offset).toArray(),target:center.toArray()});
          return applied('view',{direction});
        },
      },
      mount({root:panel,document,invoke}) {
        const heading=document.createElement('div');heading.textContent=`Edges of ${target.name||'mesh'}`;
        const status=document.createElement('div');status.setAttribute('role','status');
        const failed=error=>{panelSync();status.textContent=error.message;};
        const rows=EDGE_CLASSES.map(c=>{
          const label=document.createElement('label'),box=document.createElement('input'),swatch=document.createElement('span'),text=document.createElement('span');
          box.type='checkbox';swatch.style.cssText=`display:inline-block;width:10px;height:10px;margin:0 6px;background:#${c.color.toString(16).padStart(6,'0')}`;
          box.addEventListener('change',()=>invoke('setVisible',c.name,box.checked).catch(failed));
          label.append(box,swatch,text);return {c,box,text,label};
        });
        const angleLabel=document.createElement('label'),grip=document.createElement('span'),angleInput=document.createElement('input');
        grip.textContent='Crease angle ';angleInput.type='number';angleInput.min='0';angleInput.max='180';angleInput.step='1';angleInput.setAttribute('aria-label','Crease angle in degrees');
        angleInput.addEventListener('change',()=>invoke('setSharpAngle',Number(angleInput.value)).catch(failed));
        host.controls.installNumberDrag?.({input:angleInput,grip,step:1});
        const xrayLabel=document.createElement('label'),xrayBox=document.createElement('input');xrayBox.type='checkbox';
        xrayBox.addEventListener('change',()=>invoke('setXray',xrayBox.checked).catch(failed));xrayLabel.append(xrayBox,' X-ray');
        const frame=document.createElement('button');frame.type='button';frame.textContent='Frame';
        frame.addEventListener('click',()=>invoke('frame').catch(failed));
        angleLabel.append(grip,angleInput);
        panel.append(heading,...rows.map(r=>r.label),angleLabel,xrayLabel,frame,status);
        panelSync=()=>{
          for(const r of rows){r.box.checked=visible[r.c.name];r.text.textContent=`${r.c.label} (${counts[r.c.name]})`;}
          angleInput.value=String(sharpAngle);xrayBox.checked=xray;
          status.textContent=`${census.vertices} welded vertices, ${census.faces} faces, ${census.components} edge-connected parts`;
        };
        panelSync();
      },
      async dispose(){
        target.remove(overlay);for(const line of Object.values(lines)){line.geometry.dispose();line.material.dispose();}
        Object.assign(surface,surfaceState,{polygonOffset:false});surface.needsUpdate=true;
        await session.dispose();
      },
    };
  },
};
