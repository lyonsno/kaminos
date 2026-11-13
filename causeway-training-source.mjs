import {createCausewaySource} from './causeway-source.mjs';
import {periodicSurfaceTriangles} from './periodic-surface-source.mjs';
// Same authored realization as the raster preview. The teacher traverses its
// periodic continuation instead of building increasingly large finite copies.
export function createCausewayTrainingSource(options={}){
 const source=createCausewaySource({...options,contextRadius:1});
 const triangles=periodicSurfaceTriangles(source.triangles.filter(t=>t.tile[0]===0&&t.tile[1]===0),source.config.width,source.config.depth);
 let minY=Infinity,maxY=-Infinity;for(const t of triangles)for(const p of [t.a,t.b,t.c]){minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);}
 return {...source,triangles,periodic:{width:source.config.width,depth:source.config.depth,minY,maxY},boundary:'Canonical cell with periodic ray traversal, including secondary and shadow rays.'};
}
