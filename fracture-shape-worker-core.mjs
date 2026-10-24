import {buildShapeGraph,partitionShape,geodesicNeckPartition,boundaryAnchor,moveShapeBoundary} from './fracture-shape-partition.mjs';
export function createShapeProcessor(){let graph;return data=>{
  if(data.geometry)graph=buildShapeGraph(data.geometry);
  let result=data.settings.method==='concavity'?partitionShape(graph,data.settings):geodesicNeckPartition(graph,data.settings),motion=null,fixedCuts=data.fixedCuts??[];
  for(const boundary of data.boundaries??(data.boundary?[data.boundary]:[])){
   const {key,anchorFaces,offsetFraction,originalFaces,variantKey,protectedKeys=[]}=boundary;
   motion=moveShapeBoundary(graph,boundaryAnchor(result,key,anchorFaces,{protectedKeys}),offsetFraction);
   const moved=new Set(motion.faces),original=new Set(result.candidateBranches.find(c=>c.key===key).faces);
   const family=result.candidateBranches.filter(c=>{if(c.status!=='included')return false;if(c.key===key||!Array.from(c.faces).every(f=>original.has(f)))return true;const count=Array.from(c.faces).filter(f=>moved.has(f)).length;return count===0||count===c.faces.length;}).map(c=>({key:c.key,faces:c.key===key?motion.faces:Array.from(c.faces)}));
   result=geodesicNeckPartition(graph,{...data.settings,fixedCuts:family});
   fixedCuts=[...fixedCuts.filter(c=>c.key!==key),{key,faces:motion.faces,anchorFaces,originalFaces,variantKey,offsetFraction:motion.offsetFraction,limits:motion.limits,reassignedIslands:motion.reassignedIslands}];
  }
  return {id:data.id,result,motion,fixedCuts};
 };}
