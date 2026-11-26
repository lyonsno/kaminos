const copy=x=>structuredClone(x);
const finite=(x,n)=>{if(!Number.isFinite(x))throw Error(`Finite ${n} required`);return x;};
const pair=(x,n)=>{if(!Array.isArray(x)||x.length!==2)throw Error(`Two ${n} coordinates required`);return x.map(v=>finite(v,n));};
export function initialPlace(){return {schema:'kaminos.stockroom-place.v1',mode:'establish',realization:'proxy',height:1.2,pitch:.23,selected:'extension',regions:[
 {id:'dock',role:'material',shape:'box',center:[-1.4,0],half:[1.65,1.24]},
 {id:'extension',role:'material',shape:'ellipse',center:[1.12,0],half:[1.55,1.03]},
],insert:{center:[2.15,2.25],half:[.57,.43],fitted:false,angle:0,clearance:.055},stage:'idle'};}
function region(value){
 if(typeof value.id!=='string'||!value.id||!['material','space'].includes(value.role)||!['box','ellipse'].includes(value.shape))throw Error('Identified material or active-space region required');
 const center=pair(value.center,'region center'),half=pair(value.half,'region size');if(half.some(v=>v<=.04))throw Error('Region half extents must exceed four centimetres');
 const r={id:value.id,role:value.role,shape:value.shape,center,half};
 if(value.west!==undefined){
  if(r.role!=='material'||r.shape!=='box'||!Array.isArray(value.west)||value.west.length<2)throw Error('A west profile requires a material box');
  const knots=value.west.map(k=>pair(k,'west profile knot'));
  if(knots[0][0]!==-1||knots.at(-1)[0]!==1||knots.some(([t,dx],i)=>dx>2*half[0]-.08||(i>0&&t<=knots[i-1][0])))throw Error('Invalid west profile');
  r.west=knots;
 }
 return r;
}
export function checkedPlace(value){
 if(value?.schema!=='kaminos.stockroom-place.v1'||!['establish','work'].includes(value.mode)||!['proxy','deck'].includes(value.realization)||!Array.isArray(value.regions))throw Error('A place allocation and explicit activity are required');
 const regions=value.regions.map(region),ids=new Set(regions.map(r=>r.id));if(ids.size!==regions.length)throw Error('Region identities must be unique');
 const height=finite(value.height,'deck height'),pitch=finite(value.pitch,'member pitch');if(height<=.4||pitch<=.06)throw Error('Deck height and member pitch must accommodate construction');
 const insert=copy(value.insert);insert.center=pair(insert.center,'insert center');insert.half=pair(insert.half,'insert size');
 if(insert.half.some(v=>v<=.04)||typeof insert.fitted!=='boolean'||finite(insert.clearance,'clearance')<0||finite(insert.angle,'angle')<0||insert.angle>Math.PI*.92)throw Error('A finite prepared insert and articulation are required');
 return {schema:value.schema,mode:value.mode,realization:value.realization,height,pitch,regions,selected:ids.has(value.selected)?value.selected:null,insert,stage:'idle'};
}
function profileAt(knots,t){
 if(t<=knots[0][0])return knots[0][1];
 for(let i=1;i<knots.length;i++){const [b,y]=knots[i];if(t<=b){const [a,x]=knots[i-1];return x+(y-x)*(t-a)/(b-a);}}
 return knots.at(-1)[1];
}
export function westAt(r,z){return r.center[0]-r.half[0]+(r.west?profileAt(r.west,(z-r.center[1])/r.half[1]):0);}
export function regionDistance(r,x,z){const a=Math.abs(x-r.center[0]),b=Math.abs(z-r.center[1]);if(r.shape==='ellipse')return (Math.hypot(a/r.half[0],b/r.half[1])-1)*Math.min(...r.half);const u=r.west?Math.max(westAt(r,z)-x,x-r.center[0]-r.half[0]):a-r.half[0],v=b-r.half[1];return Math.hypot(Math.max(u,0),Math.max(v,0))+Math.min(Math.max(u,v),0);}
export function receiverRegion(model){const p=model.insert;return {id:'receiver',role:'space',shape:'box',center:p.center,half:p.half.map(v=>v+p.clearance)};}
export function samplePlace(model,x,z,{materialOnly=false}={}){
 let d=1e6;for(const r of model.regions)if(r.role==='material')d=Math.min(d,regionDistance(r,x,z));
 if(!materialOnly){for(const r of model.regions)if(r.role==='space')d=Math.max(d,-regionDistance(r,x,z));if(model.insert.fitted)d=Math.max(d,-regionDistance(receiverRegion(model),x,z));}return d;
}
export function placeBounds(model){const material=model.regions.filter(r=>r.role==='material');if(!material.length)return {min:[-3,-1.5],max:[3,1.5]};return {min:[0,1].map(i=>Math.min(...material.map(r=>r.center[i]-r.half[i]+(!i&&r.west?Math.min(...r.west.map(k=>k[1])):0)))),max:[0,1].map(i=>Math.max(...material.map(r=>r.center[i]+r.half[i])))};}
function merge(intervals){const out=[];for(const a of intervals.sort((a,b)=>a[0]-b[0])){const p=out.at(-1);if(p&&a[0]<=p[1])p[1]=Math.max(p[1],a[1]);else out.push([...a]);}return out;}
function subtract(intervals,hole){return intervals.flatMap(([a,b])=>hole[1]<=a||hole[0]>=b?[[a,b]]:[[a,Math.min(b,hole[0])],[Math.max(a,hole[1]),b]].filter(([x,y])=>y-x>.012));}
// Material uses its narrowest and space its widest section across a strip.
export function stripIntervals(model,z,width){
 const section=(r,empty)=>{const lo=z-width/2,hi=z+width/2,d=empty?Math.max(lo-r.center[1],r.center[1]-hi,0):Math.max(Math.abs(lo-r.center[1]),Math.abs(hi-r.center[1]));if(d>=r.half[1])return null;const x=r.shape==='box'?r.half[0]:r.half[0]*Math.sqrt(1-(d/r.half[1])**2);
  let left=r.center[0]-x;if(r.west){left=Math.max(westAt(r,lo),westAt(r,hi));for(const [t,dx]of r.west){const k=r.center[1]+t*r.half[1];if(k>lo&&k<hi)left=Math.max(left,r.center[0]-x+dx);}}return [left,r.center[0]+x];};
 let spans=merge(model.regions.filter(r=>r.role==='material').map(r=>section(r,false)).filter(Boolean));
 const holes=[...model.regions.filter(r=>r.role==='space'),...(model.insert.fitted?[receiverRegion(model)]:[])];
 for(const r of holes){const cut=section(r,true);if(cut)spans=subtract(spans,cut);}return spans;
}
export function planPlace(model){
 const p=checkedPlace(model),bounds=placeBounds(p),boards=[],frame=[],edges=[],h=p.height;
 const member=(list,id,size,position)=>list.push({id,size,position});
 const rows=Math.ceil((bounds.max[1]-bounds.min[1])/p.pitch),width=p.pitch-.012;
 for(let i=0;i<rows;i++){const z=bounds.min[1]+p.pitch*(i+.5);for(const [j,[a,b]]of stripIntervals(p,z,width).entries()){
  member(boards,`board:${i}:${j}`,[b-a,.075,width],[(a+b)/2,h-.0375,z]);
  const cap=Math.min(.045,(b-a)/2);for(const [k,x]of[a+cap/2,b-cap/2].entries())member(edges,`edge:${i}:${j}:${k}`,[cap,.16,width],[x,h-.11,z]);
 }}
 for(let z=Math.ceil(bounds.min[1]/.82)*.82;z<bounds.max[1];z+=.82)for(const [a,b]of stripIntervals(p,z,.11)){
  member(frame,`beam:${z}:${a}`,[b-a,.18,.11],[(a+b)/2,h-.18,z]);
  const supported=stripIntervals(p,z,.27).filter(([u,v])=>v-u>=.27);
  for(const [u,v]of supported){if(u<a||v>b)continue;const count=Math.max(1,Math.ceil((v-u-.27)/1.7));for(let i=0;i<=count;i++){const x=u+.135+(v-u-.27)*i/count;member(frame,`post:${z}:${u}:${i}`,[.11,h-.3,.11],[x,(h-.3)/2,z]);member(frame,`shoe:${z}:${u}:${i}`,[.27,.055,.27],[x,.0275,z]);}}
 }
 const insert={present:true,...copy(p.insert),height:h+.025,hostSupported:false};
 if(p.insert.fitted){const r=receiverRegion(p);insert.hostSupported=[[-1,-1],[-1,1],[1,-1],[1,1]].every(([x,z])=>samplePlace(p,r.center[0]+x*(r.half[0]+.08),r.center[1]+z*(r.half[1]+.08))<=0);}
 return {bounds,boards,frame,edges,insert};
}
export function westSpan(r,z,reach){
 const c=r.center[1],h=r.half[1];
 return [Math.max(c-h,z-reach),z,Math.min(c+h,z+reach)];
}
function previewWest(p,{id,z,reach},value){
 const r=p.regions.find(r=>r.id===id),[lo,mid,hi]=westSpan(r,z,reach);
 const [a,c,b]=[lo,mid,hi].map(k=>(k-r.center[1])/r.half[1]);
 const shoulder=[[a,0],[(a+c)/2,1],[(b+c)/2,1],[b,0]];
 const ts=[...new Set([...r.west,...shoulder].map(k=>k[0]))].sort((x,y)=>x-y);
 const west=r.center[0]-r.half[0];
 // Keep the prepared deck's opening surrounded. This is not a general edge/void solver.
 let limit=2*r.half[0]-.12;
 for(const hole of [...p.regions.filter(k=>k.role==='space'),...(p.insert.fitted?[receiverRegion(p)]:[])]){
  const hx=hole.center[0]-hole.half[0],hz=hole.center[1];
  if(hz+hole.half[1]>lo&&hz-hole.half[1]<hi&&hx>west&&hx<r.center[0]+r.half[0])limit=Math.min(limit,hx-west-.12);
 }
 if(value===0)return;
 let moved=false;
 const knots=ts.map(t=>{const base=profileAt(r.west,t),weight=profileAt(shoulder,t);
  const next=base+(value<0?value*weight:Math.min(value*weight,Math.max(0,limit-base)));
  moved||=next!==base;return [t,next];});
 if(moved)r.west=knots;
}
export function createPlaceAuthoring(input=initialPlace()){
 const seed=checkedPlace(input);
 let model=copy(seed),gesture=null,history=[];
 const idle=()=>{if(gesture)throw Error('Finish this intervention or return before changing tools');};
 const apply=fn=>{idle();const before=copy(model),next=copy(model);fn(next);model=checkedPlace(next);history.push(before);return read();};
 const read=()=>({...copy(model),stage:gesture?.kind==='fit'?'fitting':gesture?'shaping':'idle',depth:history.length});
 const id=()=>{let n=1;while(model.regions.some(r=>r.id===`region:${n}`))n++;return `region:${n}`;};
 return {read,model:()=>copy(model),
  mode(value){return apply(p=>p.mode=value);},realize(value){return apply(p=>p.realization=value);},height(value){return apply(p=>p.height=value);},
  select(value){idle();if(value!==null&&!model.regions.some(r=>r.id===value))throw Error('Unknown region');model.selected=value;return read();},
  add(role,{center,half,shape='ellipse'}){const name=id();return apply(p=>{p.regions.push(region({id:name,role,center,half,shape}));p.selected=name;});},
  remove(value=model.selected){return apply(p=>{if(!p.regions.some(r=>r.id===value))throw Error('Unknown region');p.regions=p.regions.filter(r=>r.id!==value);p.selected=null;});},
  begin(spec){idle();if(['boundary','move'].includes(spec.kind)&&!model.regions.some(r=>r.id===spec.id))throw Error('Unknown region');if(['boundary','create'].includes(spec.kind)&&(![0,1].includes(spec.axis)||![-1,1].includes(spec.sign)))throw Error('An explicit region boundary is required');if(spec.kind==='create'){if(model.mode!=='establish')throw Error('Enter Establish to allocate a region');region({id:'preview',role:spec.role,shape:'ellipse',center:spec.center,half:[spec.radius,spec.radius]});}if(['fit','fold'].includes(spec.kind)&&model.mode!=='work')throw Error('Enter Work for fitting or articulation');if(spec.kind==='fold'&&!model.insert.fitted)throw Error('Fit the insert before articulating it');
   if(spec.kind==='span'){const r=model.regions.find(r=>r.id===spec.id);if(!r?.west)throw Error('A prepared boundary is required');if(finite(spec.reach,'span reach')<=0)throw Error('Positive span reach required');if(Math.abs(finite(spec.z,'span center')-r.center[1])>=r.half[1])throw Error('Span center must be inside the prepared boundary');}
   if(!['boundary','move','fit','fold','create','span'].includes(spec.kind))throw Error('Unknown intervention');gesture={...copy(spec),id:spec.kind==='create'?id():spec.id,before:copy(model)};return read();},
  preview(value){if(!gesture)throw Error('Take up an intervention first');const p=copy(gesture.before),g=gesture;
   if(g.kind==='create'){finite(value,'allocation displacement');const center=[...g.center],half=[g.radius,g.radius];center[g.axis]+=g.sign*value/2;half[g.axis]+=value/2;p.regions.push(region({id:g.id,role:g.role,shape:'ellipse',center,half}));p.selected=g.id;}
   if(g.kind==='boundary'){finite(value,'boundary displacement');const r=p.regions.find(r=>r.id===g.id);r.half[g.axis]+=value/2;r.center[g.axis]+=g.sign*value/2;p.selected=r.id;}
   if(g.kind==='move'){const offset=pair(value,'move displacement'),r=p.regions.find(r=>r.id===g.id);r.center=r.center.map((v,i)=>v+offset[i]);p.selected=r.id;}
   if(g.kind==='fit'){p.insert.center=pair(value,'fit position');p.insert.fitted=true;p.insert.angle=0;const r=receiverRegion(p);if(![[-1,-1],[-1,1],[1,-1],[1,1]].every(([x,z])=>samplePlace(p,r.center[0]+x*r.half[0],r.center[1]+z*r.half[1],{materialOnly:true})<=0))throw Error('The prepared receiver needs host material around its four corners');}
   if(g.kind==='span')previewWest(p,g,finite(value,'span displacement'));
   if(g.kind==='fold')p.insert.angle=finite(value,'fold angle');model=checkedPlace(p);return read();},
  commit(){if(!gesture)return read();if(gesture.kind!=='span'||JSON.stringify(model.regions)!==JSON.stringify(gesture.before.regions))history.push(gesture.before);gesture=null;return read();},
  cancel(){if(gesture){model=gesture.before;gesture=null;}return read();},
  back(){if(gesture){model=gesture.before;gesture=null;}else if(history.length)model=history.pop();return read();},
  reset(){gesture=null;history=[];model=copy(seed);return read();},
 };
}
