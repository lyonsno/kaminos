import {ShapeUtils,Vector2} from './lib/three.core.js';
const defaults={seed:19,width:2.4,depth:2.4,patches:6,height:.045,supportMargin:.035,showMask:false};
const linear=c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4;
const color=hex=>[hex>>16&255,hex>>8&255,hex&255].map(v=>linear(v/255));
function layout(options={}){
 const config={...defaults,...options};
 for(const k of ['width','depth','height'])if(!Number.isFinite(config[k])||config[k]<=0)throw Error(`${k} must be positive and finite`);
 if(!Number.isSafeInteger(config.seed)||!Number.isSafeInteger(config.patches)||config.patches<1||!Number.isFinite(config.supportMargin)||config.supportMargin<0||typeof config.showMask!=='boolean')throw Error('Invalid coating source configuration');
 let state=config.seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const columns=Math.ceil(Math.sqrt(config.patches*config.width/config.depth)),rows=Math.ceil(config.patches/columns),patches=[];
 for(let i=0;i<config.patches;i++){
  const cell=Math.min(config.width/columns,config.depth/rows);
  const radius=cell*(.14+.055*random());
  const jitter=[.4+.2*random(),.4+.2*random()];
  const phase=random()*Math.PI*2,supportRadius=radius*1.25+config.supportMargin;
  if(supportRadius>=cell*.5)throw Error('Patch support cannot fit its construction cell; reduce patch count or support margin');
  const cellWidth=config.width/columns,cellDepth=config.depth/rows;
  const fit=(fraction,size)=>Math.max(supportRadius/size,Math.min(1-supportRadius/size,fraction));
  const center=[((i%columns+fit(jitter[0],cellWidth))/columns-.5)*config.width,((Math.floor(i/columns)+fit(jitter[1],cellDepth))/rows-.5)*config.depth];
  patches.push({id:i,center,radius,phase,supportRadius,flakeSeed:Math.floor(random()*4294967296)});
 }
 return {config,patches};
}
export function paintedSteelSupport(options,x,z){
 const {patches}=layout(options);return patches.some(p=>Math.hypot(x-p.center[0],z-p.center[1])<=p.supportRadius);
}
export function paintedSteelSummary(options={}){
 const {config,patches}=layout(options),coverage=patches.reduce((s,p)=>s+Math.PI*p.supportRadius**2,0)/(config.width*config.depth);
 return {patches,geometricSupportFraction:coverage,support:'Authored patch plus geometric collar; not certified shadow/parallax support for all directions',physicalProcess:'Static authored coating specimen; no aging or delamination simulation'};
}
export function createPaintedSteelSource(options={}) {
 const {config,patches}=layout(options),triangles=[];
 const triangle=(a,b,c,materialIndex,identity)=>triangles.push({a,b,c,materialIndex,identity});
 const quad=(a,b,c,d,m,id)=>{triangle(a,b,c,m,id+':0');triangle(a,c,d,m,id+':1');};
 const point=(p,r,angle,y)=>[p.center[0]+r*Math.cos(angle),y,p.center[1]+r*Math.sin(angle)];
 const holeRadius=(p,a)=>p.radius*(1+.12*Math.sin(3*a+p.phase)+.075*Math.sin(7*a-p.phase));
 const sides=40,film=.003;
 quad([-config.width/2,0,-config.depth/2],[-config.width/2,0,config.depth/2],[config.width/2,0,config.depth/2],[config.width/2,0,-config.depth/2],0,'steel');
 const contour=[[-config.width/2,-config.depth/2],[config.width/2,-config.depth/2],[config.width/2,config.depth/2],[-config.width/2,config.depth/2]].map(p=>new Vector2(...p));
 const holes=patches.map(p=>Array.from({length:sides},(_,i)=>{const a=2*Math.PI*i/sides;return new Vector2(p.center[0]+p.supportRadius*Math.cos(a),p.center[1]+p.supportRadius*Math.sin(a));}));
 const vertices=[...contour,...holes.flat()];
 for(const [i,j,k] of ShapeUtils.triangulateShape(contour,holes))triangle(...[i,j,k].map(n=>[vertices[n].x,film,vertices[n].y]),1,'intact-paint');
 for(const p of patches){
  let state=p.flakeSeed;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  for(let i=0;i<sides;i++){
   const a=2*Math.PI*i/sides,b=2*Math.PI*(i+1)/sides;
   const innerA=point(p,holeRadius(p,a),a,film),innerB=point(p,holeRadius(p,b),b,film);
   quad(point(p,p.supportRadius,a,film),point(p,p.supportRadius,b,film),innerB,innerA,5,`collar:${p.id}:${i}`);
   triangle([p.center[0],.0002,p.center[1]],point(p,holeRadius(p,b),b,.0002),point(p,holeRadius(p,a),a,.0002),2,`rust:${p.id}:${i}`);
  }
  // Attached strips peel inward from the hole boundary. Their tops, backs,
  // and thin side walls are actual surfaces; the integrator owns visibility.
  const flakes=1+Math.floor(random()*3);
  for(let f=0;f<flakes;f++){
   const begin=Math.floor(random()*sides),span=8+Math.floor(random()*15),height=config.height*(.45+.55*random()),twist=(random()-.5)*.7;
   const grid=[];
   for(let row=0;row<=8;row++){
    const t=row/8,line=[];
    for(let col=0;col<=span;col++){
     const a=2*Math.PI*(begin+col)/sides,r=holeRadius(p,a)*(1-.62*t);
     line.push(point(p,r,a+twist*t,film+height*Math.pow(t,1.2)*(1-.22*t)));
    }grid.push(line);
   }
   for(let row=1;row<=8;row++)for(let col=0;col<span;col++){
    const a=grid[row-1][col],b=grid[row-1][col+1],c=grid[row][col+1],d=grid[row][col],under=q=>[q[0],q[1]-.0012,q[2]],id=`flake:${p.id}:${f}:${row}:${col}`;
    quad(a,b,c,d,5,id+':top');quad(under(d),under(c),under(b),under(a),3,id+':back');
    if(col===0)quad(a,d,under(d),under(a),3,id+':edge');
    if(col===span-1)quad(c,b,under(b),under(c),3,id+':edge');
    if(row===8)quad(d,c,under(c),under(d),3,id+':tip');
   }
  }
  const bareAngle=random()*Math.PI*2,bareCenter=point(p,p.radius*.28,bareAngle,.0005),bareRadius=p.radius*(.18+.1*random());
  for(let i=0;i<11;i++){
   const at=j=>{const a=j*2*Math.PI/11,r=bareRadius*(1+.18*Math.sin(a*3+p.phase));return [bareCenter[0]+r*Math.cos(a),bareCenter[1],bareCenter[2]+r*Math.sin(a)];};
   triangle(bareCenter,at(i+1),at(i),0,`bare-steel:${p.id}:${i}`);
  }
  for(let i=0;i<36;i++){
   const a=random()*Math.PI*2,r=Math.sqrt(random())*p.radius*.85,center=point(p,r,a,.0003),rad=p.radius*(.025+.07*random()),h=.001+config.height*.13*random();
   const rim=Array.from({length:5},(_,j)=>[center[0]+rad*Math.cos(j*2*Math.PI/5),center[1],center[2]+rad*Math.sin(j*2*Math.PI/5)]);
   for(let j=0;j<5;j++)triangle(rim[j],rim[(j+1)%5],[center[0],h,center[2]],i%3?2:4,`scale:${p.id}:${i}:${j}`);
  }
 }
 const materials=[{color:color(0x666b6c),roughness:.38,metalness:1},{color:color(0x527c82),roughness:.34,metalness:0},{color:color(0x773c23),roughness:.92,metalness:0},{color:color(0x39281e),roughness:.8,metalness:.05},{color:color(0xa66b3c),roughness:.85,metalness:0},{color:color(0x527c82),roughness:.34,metalness:0}];
 materials.push({color:[.9,.015,.55],roughness:.85,metalness:0});
 if(config.showMask)for(const t of triangles)if(t.materialIndex!==1)t.materialIndex=6;
 return {schema:'kaminos.painted-steel-source.v1',config,triangles,patches,materials,referenceHeight:config.height+film+.005,boundary:'Finite backed coating tile; periodic border transport is not implemented',...paintedSteelSummary(config)};
}
