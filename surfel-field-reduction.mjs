// Spatial LOD for the diagnostic's full-material rows. Originals remain intact.
export function reduceSurfelRows(data,meta,factor){
 if(!(data instanceof Float32Array)||meta.stride!==12||data.length!==meta.count*12||!data.every(Number.isFinite)||!(meta.gridSize>0)||!(meta.radius>0))throw Error('Invalid full-material surfel rows');
 if(!Number.isSafeInteger(factor)||factor<1)throw Error('Positive integer reduction factor required');
 const parent=new Uint32Array(meta.count),normalCosine=.75,opacityCutoff=.98;
 const resultMeta={...meta,sourceCount:meta.sourceCount??meta.count,radius:meta.radius*factor,reduction:{factor,normalCosine,opacityCutoff}};
 delete resultMeta.triangles;delete resultMeta.dataSHA256;
 if(factor===1){for(let i=0;i<meta.count;i++)parent[i]=i;return {data:data.slice(),parent,meta:resultMeta};}
 const cells=new Map(),groups=[],cellSize=factor/meta.gridSize;
 for(let i=0;i<meta.count;i++){
  const k=i*12,norm=Math.hypot(data[k+3],data[k+4],data[k+5]);if(norm<1e-10)throw Error('Invalid surfel normal');
  const normal=[data[k+3]/norm,data[k+4]/norm,data[k+5]/norm],glass=data[k+11]<opacityCutoff;
  const key=[0,1,2].map(a=>Math.floor((data[k+a]+.5)/cellSize)).join(',');
  let candidates=cells.get(key);if(!candidates){candidates=[];cells.set(key,candidates);}
  let group=candidates.find(g=>g.glass===glass&&g.normal.reduce((s,n,a)=>s+n*normal[a],0)>=normalCosine);
  if(!group){group={id:groups.length,glass,normal,sum:new Float64Array(12),count:0};groups.push(group);candidates.push(group);}
  parent[i]=group.id;group.count++;
  for(let a=0;a<12;a++)group.sum[a]+=a>=3&&a<6?normal[a-3]:data[k+a];
 }
 const output=new Float32Array(groups.length*12);
 for(const g of groups){
  const k=g.id*12;for(let a=0;a<12;a++)output[k+a]=g.sum[a]/g.count;
  const len=Math.hypot(output[k+3],output[k+4],output[k+5]);for(let a=3;a<6;a++)output[k+a]/=len;
 }
 return {data:output,parent,meta:{...resultMeta,count:groups.length}};
}
