import {buildShapeGraph,partitionShape,geodesicNeckPartition} from './fracture-shape-partition.mjs';
let graph;
self.onmessage=({data})=>{
 try{
  if(data.geometry)graph=buildShapeGraph(data.geometry);
  const result=data.settings.method==='concavity'?partitionShape(graph,data.settings):geodesicNeckPartition(graph,data.settings);
  self.postMessage({id:data.id,result},[result.labels.buffer]);
 }catch(error){self.postMessage({id:data.id,error:error.message});}
};
