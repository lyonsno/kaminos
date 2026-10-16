// Edit Mode component selection over the welded kernel, with Blender's rules:
// one mode at a time (vertex, edge, face); the selection in that mode is the
// base and the other two flush from it. Every operation returns a new state.
import {NO_EDGE,selectLinkedFaces} from './poly-mesh-core.mjs';

const MODES=['vertex','edge','face'];
const countOf=(mesh,kind)=>kind==='vertex'?mesh.vertexCount:kind==='edge'?mesh.edgeCount:mesh.faceCount;
const key=kind=>kind==='vertex'?'vertices':kind==='edge'?'edges':'faces';

function flush(mesh,mode,base,active=null){
  const vertices=new Uint8Array(mesh.vertexCount),edges=new Uint8Array(mesh.edgeCount),faces=new Uint8Array(mesh.faceCount);
  const {edgeVertices:EV,cornerVertex:CV,cornerEdge:CE}=mesh;
  if(mode==='vertex'){
    vertices.set(base);
    for(let e=0;e<mesh.edgeCount;e++)edges[e]=vertices[EV[2*e]]&vertices[EV[2*e+1]];
    for(let f=0;f<mesh.faceCount;f++)faces[f]=vertices[CV[3*f]]&vertices[CV[3*f+1]]&vertices[CV[3*f+2]];
  }else if(mode==='edge'){
    edges.set(base);
    for(let e=0;e<mesh.edgeCount;e++)if(edges[e]){vertices[EV[2*e]]=1;vertices[EV[2*e+1]]=1;}
    for(let f=0;f<mesh.faceCount;f++){const a=CE[3*f],b=CE[3*f+1],c=CE[3*f+2];faces[f]=a!==NO_EDGE&&b!==NO_EDGE&&c!==NO_EDGE&&edges[a]&&edges[b]&&edges[c]?1:0;}
  }else{
    faces.set(base);
    for(let f=0;f<mesh.faceCount;f++)if(faces[f])for(let c=3*f;c<3*f+3;c++){vertices[CV[c]]=1;if(CE[c]!==NO_EDGE)edges[CE[c]]=1;}
  }
  const keep=active&&({vertices,edges,faces})[key(active.kind)][active.index]?active:null;
  return Object.freeze({mode,vertices,edges,faces,active:keep});
}
function checkedMode(mode){if(!MODES.includes(mode))throw Error(`Select mode must be vertex, edge or face, not ${mode}`);return mode;}

export function createComponentSelection(mesh,{mode='vertex'}={}) {
  return flush(mesh,checkedMode(mode),new Uint8Array(countOf(mesh,mode)));
}

// Switching modes keeps what the flushed selection already holds in the new mode,
// as Blender does: faces fully covered by selected vertices, corners of selected faces.
export function setSelectMode(selection,mesh,mode) {
  checkedMode(mode);
  return flush(mesh,mode,selection[key(mode)],selection.active?.kind===mode?selection.active:null);
}

export function clickComponent(selection,mesh,{kind,index},{extend=false}={}) {
  if(kind!==selection.mode)throw Error(`Click picks ${selection.mode}s in ${selection.mode} mode, not a ${kind}`);
  if(!Number.isInteger(index)||index<0||index>=countOf(mesh,kind))throw Error(`No ${kind} ${index} in this mesh`);
  const component={kind,index};
  if(!extend){const base=new Uint8Array(countOf(mesh,kind));base[index]=1;return flush(mesh,kind,base,component);}
  const base=Uint8Array.from(selection[key(kind)]);
  if(!base[index]){base[index]=1;return flush(mesh,kind,base,component);}
  const isActive=selection.active?.kind===kind&&selection.active.index===index;
  if(isActive){base[index]=0;return flush(mesh,kind,base,null);}
  return flush(mesh,kind,base,component);
}

export function selectAll(selection,mesh,action='toggle') {
  if(!['select','deselect','toggle'].includes(action))throw Error('Select all action must be select, deselect or toggle');
  const any=selection[key(selection.mode)].some(Boolean),on=action==='select'||(action==='toggle'&&!any);
  return flush(mesh,selection.mode,new Uint8Array(countOf(mesh,selection.mode)).fill(on?1:0),on?selection.active:null);
}

// Box select over projected welded vertices (screen x,y pairs). Occluded vertices
// count only when selecting through. Edges need both ends inside; faces their centre.
export function boxSelect(selection,mesh,{projected,visible,rect,through=false,mode='set'}) {
  if(!projected||projected.length!==mesh.vertexCount*2)throw Error('Box select needs one projected point per vertex');
  if(!visible||visible.length!==mesh.vertexCount)throw Error('Box select needs one visibility flag per vertex');
  if(!['set','extend','subtract'].includes(mode))throw Error('Box select mode must be set, extend or subtract');
  const x0=Math.min(rect.x0,rect.x1),x1=Math.max(rect.x0,rect.x1),y0=Math.min(rect.y0,rect.y1),y1=Math.max(rect.y0,rect.y1);
  const inside=(x,y)=>x>=x0&&x<=x1&&y>=y0&&y<=y1,seen=v=>through||visible[v],P=projected;
  const kind=selection.mode,hits=new Uint8Array(countOf(mesh,kind));
  if(kind==='vertex')for(let v=0;v<mesh.vertexCount;v++)hits[v]=seen(v)&&inside(P[2*v],P[2*v+1])?1:0;
  else if(kind==='edge')for(let e=0;e<mesh.edgeCount;e++){const a=mesh.edgeVertices[2*e],b=mesh.edgeVertices[2*e+1];hits[e]=seen(a)&&seen(b)&&inside(P[2*a],P[2*a+1])&&inside(P[2*b],P[2*b+1])?1:0;}
  else for(let f=0;f<mesh.faceCount;f++){
    const [a,b,c]=mesh.cornerVertex.subarray(3*f,3*f+3);
    hits[f]=seen(a)&&seen(b)&&seen(c)&&inside((P[2*a]+P[2*b]+P[2*c])/3,(P[2*a+1]+P[2*b+1]+P[2*c+1])/3)?1:0;
  }
  const base=mode==='set'?hits:Uint8Array.from(selection[key(kind)],(s,i)=>mode==='extend'?s|hits[i]:s&&!hits[i]?1:0);
  return flush(mesh,kind,base,selection.active);
}

// Select Linked (Ctrl+L): everything connected to the current selection.
export function selectLinkedComponents(selection,mesh,{delimit=0,flags=null,barrier=null}={}) {
  // In face mode it grows from the selected faces, as Blender's does; growing from their
  // vertices would leak across a delimit through faces that merely share a corner.
  const seeds=new Set(),fromFaces=selection.mode==='face'&&selection.faces.some(Boolean);
  for(let f=0;f<mesh.faceCount;f++){
    if(fromFaces){if(selection.faces[f])seeds.add(f);continue;}
    for(let c=3*f;c<3*f+3;c++)if(selection.vertices[mesh.cornerVertex[c]])seeds.add(f);
  }
  const linked=selectLinkedFaces(mesh,[...seeds],{delimit,flags,barrier});
  const asFaces=flush(mesh,'face',linked);
  return flush(mesh,selection.mode,asFaces[key(selection.mode)],selection.active);
}

export function selectedFaces(selection) {return selection.faces;}
export function selectionCounts(selection) {
  const count=a=>a.reduce((n,x)=>n+x,0);
  return {vertices:count(selection.vertices),edges:count(selection.edges),faces:count(selection.faces)};
}
